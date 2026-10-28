/**
 * Changing a recurring schedule's day / time / frequency.
 *
 * - Upcoming meetings (PROPOSED/SCHEDULED, in the future) that sit on the OLD pattern move, in order,
 *   onto the NEW pattern's occurrences (1st → 1st new, 2nd → 2nd new …). Meetings someone moved
 *   individually (Reschedule) don't match the old pattern and stay where they are.
 * - Google Calendar: the old series is ended at "now" (past weeks stay on calendars; deleted if it
 *   hadn't started yet) and a new series starts at the first new occurrence. Individually moved
 *   meetings that lived in the old series get their own event so they don't vanish with it.
 * - nextMeetingDate continues after the last moved meeting, so the cron never doubles a week.
 */
import { MeetingStatus } from '@prisma/client'
import { toZonedTime } from 'date-fns-tz'
import { prisma } from './prisma'
import { conflict } from './api-errors'
import { advanceToNextOccurrence, calculateFirstOccurrence } from './recurring-dates'
import { assertNoConflict } from './meeting-conflicts'
import { calendarsConnected, loadPairProfiles } from './availability'
import {
  CalendarUnavailableError,
  createCalendarEvent,
  createRecurringCalendarEvent,
  endRecurringSeries,
  isCalendarEnabled,
  isDateTimeFreeForBoth,
  updateCalendarEvent,
} from './google-calendar'
import { formatMeetingLong } from './dates'
import type { RecurringFrequency } from '@prisma/client'

export interface Pattern {
  dayOfWeek: number
  timeOfDay: string
  frequency: RecurringFrequency
}

export interface UpcomingMeeting {
  id: string
  meetingDate: Date
}

export interface SeriesMovePlan {
  moves: { id: string; from: Date; to: Date }[]
  /** Upcoming meetings off the old pattern (individually rescheduled) — left alone */
  kept: UpcomingMeeting[]
  firstNew: Date
  nextMeetingDate: Date
}

/** Does `date` fall on `pattern`'s weekday and time of day in `tz`? (frequency doesn't matter here) */
export function onPattern(date: Date, pattern: Pick<Pattern, 'dayOfWeek' | 'timeOfDay'>, tz: string): boolean {
  const z = toZonedTime(date, tz)
  const hhmm = `${String(z.getHours()).padStart(2, '0')}:${String(z.getMinutes()).padStart(2, '0')}`
  return z.getDay() === pattern.dayOfWeek && hhmm === pattern.timeOfDay
}

/** Pure: where each upcoming meeting goes, and what the schedule's next generation date becomes. */
export function planSeriesMove(upcoming: UpcomingMeeting[], oldPattern: Pattern, newPattern: Pattern, tz: string, now = new Date()): SeriesMovePlan {
  const sorted = [...upcoming].sort((a, b) => a.meetingDate.getTime() - b.meetingDate.getTime())
  const onOld = sorted.filter((m) => onPattern(m.meetingDate, oldPattern, tz))
  const kept = sorted.filter((m) => !onPattern(m.meetingDate, oldPattern, tz))

  const firstNew = calculateFirstOccurrence(newPattern.dayOfWeek, newPattern.timeOfDay, newPattern.frequency, tz, now)
  const moves: SeriesMovePlan['moves'] = []
  let slot = firstNew
  for (const m of onOld) {
    moves.push({ id: m.id, from: m.meetingDate, to: slot })
    slot = advanceToNextOccurrence(newPattern.dayOfWeek, newPattern.timeOfDay, newPattern.frequency, slot, tz)
  }
  return { moves, kept, firstNew, nextMeetingDate: slot }
}

interface ScheduleForMove {
  id: string
  reporterId: string
  employeeId: string
  dayOfWeek: number
  timeOfDay: string
  frequency: RecurringFrequency
  googleRecurringEventId: string | null
  employee: { id: string; name: string | null; email: string }
  reporter: { id: string; name: string | null; email: string; timeZone: string | null }
}

const ACTIVE = [MeetingStatus.PROPOSED, MeetingStatus.SCHEDULED]

/** Load upcoming meetings and plan the move; throws 409 when the first new slot is taken. */
export async function prepareSeriesMove(schedule: ScheduleForMove, newPattern: Pattern, durationMinutes: number, tz: string, now = new Date()) {
  const upcoming = await prisma.meeting.findMany({
    where: { recurringScheduleId: schedule.id, status: { in: ACTIVE }, meetingDate: { gt: now } },
    select: { id: true, meetingDate: true, status: true, calendarEvent: { select: { googleEventId: true } } },
  })
  const plan = planSeriesMove(upcoming, schedule, newPattern, tz, now)

  // The first new slot must be free: other app meetings (hard rule) and both Google calendars
  const firstMove = plan.moves[0]
  await assertNoConflict(schedule.employeeId, schedule.reporterId, plan.firstNew, {
    durationMinutes,
    ...(firstMove ? { excludeMeetingId: firstMove.id } : {}),
  })
  try {
    if ((await calendarsConnected(schedule.reporterId, schedule.employeeId)).either) {
      const profiles = await loadPairProfiles(schedule.reporterId, schedule.employeeId)
      const free = await isDateTimeFreeForBoth(schedule.reporterId, schedule.employeeId, plan.firstNew, durationMinutes, profiles.options)
      if (!free) {
        throw conflict(`The first new occurrence (${formatMeetingLong(plan.firstNew, tz)}) is busy on a calendar or outside working hours. Pick a different day or time.`)
      }
    }
  } catch (err) {
    if (!(err instanceof CalendarUnavailableError)) throw err
  }
  return { plan, upcoming }
}

/** Best effort after the DB moved: end the old Google series, start the new one, fix one-off events. */
export async function applySeriesMoveToCalendar(
  schedule: ScheduleForMove,
  newPattern: Pattern,
  durationMinutes: number,
  tz: string,
  plan: SeriesMovePlan,
  upcoming: { id: string; meetingDate: Date; status: MeetingStatus; calendarEvent: { googleEventId: string } | null }[],
  now = new Date()
) {
  const log = (msg: string, err: unknown) => console.error(`[recurring-edit] ${msg} (schedule ${schedule.id})`, err)
  const employeeName = schedule.employee.name ?? ''
  const reporterName = schedule.reporter.name ?? ''
  const byId = new Map(upcoming.map((m) => [m.id, m]))

  // Meetings that have their own event (no series yet): move the event with the meeting
  for (const mv of plan.moves) {
    const ev = byId.get(mv.id)?.calendarEvent
    if (ev) await updateCalendarEvent(ev.googleEventId, schedule.reporterId, mv.to, employeeName, reporterName, durationMinutes).catch((e) => log('move event failed', e))
  }

  if (!schedule.googleRecurringEventId) return
  if (!(await isCalendarEnabled(schedule.reporterId))) return

  try {
    await endRecurringSeries(schedule.googleRecurringEventId, schedule.reporterId, now)
  } catch (e) {
    log('ending the old series failed', e)
  }

  // Individually rescheduled meetings were exceptions of the old series — give them their own event
  for (const m of plan.kept) {
    const row = byId.get(m.id)
    if (row?.status === MeetingStatus.SCHEDULED && !row.calendarEvent) {
      await createCalendarEvent(m.id, schedule.employee.email, schedule.reporter.email, schedule.reporterId, m.meetingDate, employeeName, reporterName, durationMinutes).catch((e) =>
        log('standalone event for a rescheduled meeting failed', e)
      )
    }
  }

  // New series from the first new occurrence (only meetings already accepted live on the series)
  const firstScheduled = plan.moves.find((mv) => byId.get(mv.id)?.status === MeetingStatus.SCHEDULED)
  const start = firstScheduled?.to ?? plan.firstNew
  const anchorMeetingId = firstScheduled?.id ?? plan.moves[0]?.id ?? ''
  try {
    await createRecurringCalendarEvent(
      schedule.id,
      anchorMeetingId,
      schedule.reporterId,
      schedule.employee.email,
      schedule.reporter.email,
      start,
      employeeName,
      reporterName,
      newPattern.frequency,
      tz,
      durationMinutes
    )
  } catch (e) {
    log('creating the new series failed', e)
    await prisma.recurringSchedule.update({ where: { id: schedule.id }, data: { googleRecurringEventId: null, googleCalendarLink: null } }).catch(() => {})
  }
}
