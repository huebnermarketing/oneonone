import { Prisma, RecurringFrequency } from '@prisma/client'
import { prisma } from './prisma'
import {
  acceptInvitationAs,
  createCalendarEvent,
  createRecurringCalendarEvent,
  getAttendeeRsvp,
  isCalendarEnabled,
} from './google-calendar'
import { advanceToNextOccurrence } from './recurring-dates'
import { DEFAULT_TIMEZONE } from './constants'
import { DAY_NAMES } from './ui'
import * as notify from './notify'

/**
 * Meetings are booked, not proposed: a new meeting (or a new recurring schedule's first meeting) is
 * SCHEDULED straight away, goes onto both Google Calendars with the employee's RSVP set to accepted,
 * and the hourly cron keeps it that way:
 *  - confirmPendingProposals: old PROPOSED meetings still in the future are confirmed
 *  - watchCalendarRsvps: next RSVP_WATCH_DAYS days — a decline in Google alerts the manager once,
 *    a still-pending RSVP is accepted again, a missing calendar event is created
 */

type Tx = Prisma.TransactionClient

export const RSVP_WATCH_DAYS = 7

const FREQUENCY_LABEL: Record<RecurringFrequency, string> = {
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Every 2 weeks',
  MONTHLY: 'Monthly',
}

/** "Weekly on Monday" — shown in the booking email for a new recurring schedule. */
export function recurringLabel(frequency: RecurringFrequency, dayOfWeek: number): string {
  return `${FREQUENCY_LABEL[frequency]} on ${DAY_NAMES[dayOfWeek] ?? ''}`.trim()
}

/**
 * Create the schedule's next occurrence now (SCHEDULED) and advance nextMeetingDate, inside the
 * caller's transaction. No-op when the schedule is inactive or that occurrence already exists.
 */
export async function createNextOccurrence(tx: Tx, scheduleId: string): Promise<string | null> {
  const schedule = await tx.recurringSchedule.findUnique({
    where: { id: scheduleId },
    include: { reporter: { select: { timeZone: true } } },
  })
  if (!schedule?.isActive || !schedule.nextMeetingDate) return null
  const nextDate = schedule.nextMeetingDate
  const exists = await tx.meeting.findFirst({
    where: { recurringScheduleId: schedule.id, meetingDate: nextDate, status: { not: 'CANCELLED' } },
    select: { id: true },
  })
  if (exists) return null
  const created = await tx.meeting.create({
    data: {
      employeeId: schedule.employeeId,
      reporterId: schedule.reporterId,
      meetingDate: nextDate,
      durationMinutes: schedule.durationMinutes,
      meetingType: schedule.meetingType,
      meetingLink: schedule.meetingLink,
      recurringScheduleId: schedule.id,
      status: 'SCHEDULED',
      proposedById: schedule.reporterId,
    },
    select: { id: true },
  })
  await tx.recurringSchedule.update({
    where: { id: schedule.id },
    data: {
      nextMeetingDate: advanceToNextOccurrence(
        schedule.dayOfWeek,
        schedule.timeOfDay,
        schedule.frequency,
        nextDate,
        schedule.reporter?.timeZone || DEFAULT_TIMEZONE
      ),
      lastGeneratedAt: new Date(),
    },
  })
  return created.id
}

const bookingSelect = {
  id: true,
  status: true,
  meetingDate: true,
  durationMinutes: true,
  employeeId: true,
  reporterId: true,
  recurringScheduleId: true,
  calendarDeclinedAt: true,
  employee: { select: { id: true, name: true, email: true } },
  reporter: { select: { id: true, name: true, email: true } },
  calendarEvent: { select: { googleEventId: true } },
  recurringSchedule: {
    select: { googleRecurringEventId: true, frequency: true, reporter: { select: { timeZone: true } } },
  },
} satisfies Prisma.MeetingSelect

type BookedMeeting = Prisma.MeetingGetPayload<{ select: typeof bookingSelect }>

/** The Google event that carries this meeting: its own event, else its schedule's series. */
export function calendarEventFor(m: Pick<BookedMeeting, 'calendarEvent' | 'recurringSchedule'>): { eventId: string; occurrence: boolean } | null {
  if (m.calendarEvent?.googleEventId) return { eventId: m.calendarEvent.googleEventId, occurrence: false }
  if (m.recurringSchedule?.googleRecurringEventId) return { eventId: m.recurringSchedule.googleRecurringEventId, occurrence: true }
  return null
}

export type RsvpResult = 'accepted' | 'declined' | 'missing' | 'skipped' | 'failed'

/** Mark the employee's RSVP accepted with their own Google connection. Never throws. */
export async function acceptAsEmployee(employeeId: string, employeeEmail: string, eventId: string): Promise<RsvpResult> {
  try {
    if (!(await isCalendarEnabled(employeeId))) return 'skipped'
    return await acceptInvitationAs(employeeId, employeeEmail, eventId)
  } catch (err) {
    console.error(`[booking] auto-accept failed for event ${eventId}:`, err instanceof Error ? err.message : err)
    return 'failed'
  }
}

export interface CalendarSyncResult {
  calendar: 'created' | 'exists' | 'no-calendar' | 'failed'
  rsvp: RsvpResult
}

/**
 * Put a SCHEDULED meeting on both calendars: a single event, or its schedule's series (created when it
 * doesn't exist yet), on the reporter's calendar with the employee invited, then the employee's RSVP set
 * to accepted. Best effort — never throws; the meeting is booked either way.
 */
export async function syncBookedMeetingToCalendar(meetingId: string): Promise<CalendarSyncResult> {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, select: bookingSelect })
  if (!meeting) return { calendar: 'failed', rsvp: 'skipped' }
  try {
    if (!(await isCalendarEnabled(meeting.reporterId))) return { calendar: 'no-calendar', rsvp: 'skipped' }

    let calendar: CalendarSyncResult['calendar'] = 'exists'
    let eventId = calendarEventFor(meeting)?.eventId
    if (!eventId) {
      if (meeting.recurringScheduleId && meeting.recurringSchedule) {
        const created = await createRecurringCalendarEvent(
          meeting.recurringScheduleId,
          meeting.id,
          meeting.reporterId,
          meeting.employee.email,
          meeting.reporter.email,
          meeting.meetingDate,
          meeting.employee.name ?? 'Team member',
          meeting.reporter.name ?? 'Manager',
          meeting.recurringSchedule.frequency,
          meeting.recurringSchedule.reporter?.timeZone ?? DEFAULT_TIMEZONE,
          meeting.durationMinutes
        )
        eventId = created?.eventId
      } else {
        const created = await createCalendarEvent(
          meeting.id,
          meeting.employee.email,
          meeting.reporter.email,
          meeting.reporterId,
          meeting.meetingDate,
          meeting.employee.name ?? 'Team member',
          meeting.reporter.name ?? 'Manager',
          meeting.durationMinutes
        )
        eventId = created?.eventId
      }
      calendar = 'created'
    }
    if (!eventId) return { calendar, rsvp: 'skipped' }
    return { calendar, rsvp: await acceptAsEmployee(meeting.employeeId, meeting.employee.email, eventId) }
  } catch (err) {
    console.error(`[booking] calendar sync failed for meeting ${meetingId}:`, err instanceof Error ? err.message : err)
    return { calendar: 'failed', rsvp: 'skipped' }
  }
}

/**
 * Confirm meetings still waiting for an accept from before booking replaced proposing: every PROPOSED
 * meeting in the future becomes SCHEDULED (+ next recurring occurrence), goes on the calendars, and both
 * sides are told. Idempotent; past-dated proposals are left alone.
 */
export async function confirmPendingProposals(now = new Date()): Promise<{ confirmed: number; failed: number }> {
  const pending = await prisma.meeting.findMany({
    where: { status: 'PROPOSED', meetingDate: { gte: now }, employee: { isActive: true }, reporter: { isActive: true } },
    select: {
      id: true,
      meetingDate: true,
      durationMinutes: true,
      recurringScheduleId: true,
      proposedById: true,
      employeeId: true,
      employee: { select: { id: true, name: true, email: true } },
      reporter: { select: { id: true, name: true, email: true } },
    },
    orderBy: { meetingDate: 'asc' },
  })

  let confirmed = 0
  let failed = 0
  for (const m of pending) {
    try {
      const flipped = await prisma.$transaction(async (tx) => {
        const r = await tx.meeting.updateMany({ where: { id: m.id, status: 'PROPOSED' }, data: { status: 'SCHEDULED' } })
        if (r.count === 0) return false
        if (m.recurringScheduleId) await createNextOccurrence(tx, m.recurringScheduleId)
        return true
      })
      if (!flipped) continue
      await syncBookedMeetingToCalendar(m.id)
      const employeeProposed = m.proposedById === m.employeeId
      await notify.meetingBooked({ meetingId: m.id, date: m.meetingDate, to: m.employee, scheduledBy: m.reporter, durationMinutes: m.durationMinutes })
      if (employeeProposed) {
        await notify.meetingBooked({ meetingId: m.id, date: m.meetingDate, to: m.reporter, scheduledBy: m.employee, durationMinutes: m.durationMinutes })
      }
      confirmed++
    } catch (err) {
      failed++
      console.error(`[booking] failed to confirm proposal ${m.id}:`, err instanceof Error ? err.message : err)
    }
  }
  return { confirmed, failed }
}

export interface RsvpWatchResult {
  checked: number
  declined: number
  reaccepted: number
  eventsCreated: number
  errors: number
}

/**
 * Hourly: for SCHEDULED meetings in the next RSVP_WATCH_DAYS days, read the employee's RSVP on Google
 * (as the organizer sees it). Declined → alert the manager once (calendarDeclinedAt); accepted/tentative
 * again → clear it; still pending → accept again with the employee's token; no event → create it.
 */
export async function watchCalendarRsvps(now = new Date()): Promise<RsvpWatchResult> {
  const result: RsvpWatchResult = { checked: 0, declined: 0, reaccepted: 0, eventsCreated: 0, errors: 0 }
  const meetings = await prisma.meeting.findMany({
    where: {
      status: 'SCHEDULED',
      meetingDate: { gte: now, lte: new Date(now.getTime() + RSVP_WATCH_DAYS * 86_400_000) },
      employee: { isActive: true },
      reporter: { isActive: true },
    },
    select: bookingSelect,
    orderBy: { meetingDate: 'asc' },
  })

  const calendarOn = new Map<string, boolean>()
  const enabled = async (userId: string) => {
    if (!calendarOn.has(userId)) calendarOn.set(userId, await isCalendarEnabled(userId))
    return calendarOn.get(userId)!
  }
  const acceptedEvents = new Set<string>()

  for (const m of meetings) {
    try {
      if (!(await enabled(m.reporterId))) continue
      const event = calendarEventFor(m)
      if (!event) {
        const sync = await syncBookedMeetingToCalendar(m.id)
        if (sync.calendar === 'created') result.eventsCreated++
        continue
      }
      result.checked++
      const rsvp = await getAttendeeRsvp(m.reporterId, event.eventId, m.employee.email, event.occurrence ? m.meetingDate : undefined)

      if (rsvp === 'declined') {
        if (!m.calendarDeclinedAt) {
          const marked = await prisma.meeting.updateMany({ where: { id: m.id, calendarDeclinedAt: null }, data: { calendarDeclinedAt: now } })
          if (marked.count > 0) {
            result.declined++
            await notify.calendarDeclined({ meetingId: m.id, date: m.meetingDate, manager: m.reporter, employeeName: m.employee.name })
          }
        }
      } else if (rsvp === 'accepted' || rsvp === 'tentative') {
        if (m.calendarDeclinedAt) await prisma.meeting.update({ where: { id: m.id }, data: { calendarDeclinedAt: null } })
      } else if (rsvp === 'needsAction' && !acceptedEvents.has(event.eventId)) {
        acceptedEvents.add(event.eventId)
        if ((await acceptAsEmployee(m.employeeId, m.employee.email, event.eventId)) === 'accepted') result.reaccepted++
      }
    } catch (err) {
      result.errors++
      console.error(`[booking] RSVP check failed for meeting ${m.id}:`, err instanceof Error ? err.message : err)
    }
  }
  return result
}
