/**
 * Scheduling availability shared by the availability routes and recurring-schedule creation:
 * who is free when, on both Google Calendars, inside both people's working hours, minus Keka
 * holidays/leave and meetings already in the app. Calendar I/O lives in lib/google-calendar.ts and
 * the interval arithmetic in lib/free-slots.ts — this module composes them.
 */
import { MeetingStatus } from '@prisma/client'
import { prisma } from './prisma'
import { getMutualFreeSlots, isCalendarEnabled, isDateTimeFreeForBoth, type MutualFreeSlotsOptions } from './google-calendar'
import { isDateUnavailableForEitherUser } from './keka'
import { DEFAULT_WORK_END, DEFAULT_WORK_START, formatWorkHoursLabel } from './timezones'
import { DEFAULT_TIMEZONE } from './constants'
import { MAX_MEETING_DURATION } from './meeting-duration'
import { startOfDayInTz, toDateKey } from './dates'
import { isIntervalFree, type Interval } from './free-slots'
import { addDaysToKey } from './slots'

export interface WorkProfile {
  timeZone: string
  workStart: string
  workEnd: string
}

export interface PairProfiles {
  reporter: WorkProfile
  employee: WorkProfile
  /** Ready to pass to getMutualFreeSlots / isDateTimeFreeForBoth */
  options: MutualFreeSlotsOptions
}

type RawProfile = { timeZone: string | null; workDayStart: string | null; workDayEnd: string | null } | null | undefined

/** Resolve stored profile fields to usable values (app defaults for anything unset). */
export function toWorkProfile(p: RawProfile): WorkProfile {
  return {
    timeZone: p?.timeZone ?? DEFAULT_TIMEZONE,
    workStart: p?.workDayStart ?? DEFAULT_WORK_START,
    workEnd: p?.workDayEnd ?? DEFAULT_WORK_END,
  }
}

export function pairProfiles(reporterRaw: RawProfile, employeeRaw: RawProfile): PairProfiles {
  const reporter = toWorkProfile(reporterRaw)
  const employee = toWorkProfile(employeeRaw)
  return {
    reporter,
    employee,
    options: {
      reporterTimeZone: reporter.timeZone,
      reporterWorkStart: reporter.workStart,
      reporterWorkEnd: reporter.workEnd,
      employeeTimeZone: employee.timeZone,
      employeeWorkStart: employee.workStart,
      employeeWorkEnd: employee.workEnd,
    },
  }
}

/** Load and resolve both people's timezone + working hours. */
export async function loadPairProfiles(reporterId: string, employeeId: string): Promise<PairProfiles> {
  const select = { timeZone: true, workDayStart: true, workDayEnd: true } as const
  const [reporter, employee] = await Promise.all([
    prisma.user.findUnique({ where: { id: reporterId }, select }),
    prisma.user.findUnique({ where: { id: employeeId }, select }),
  ])
  return pairProfiles(reporter, employee)
}

/**
 * Whose Google Calendar is connected. Availability needs only `either`: the connected calendar reads
 * the other person's free/busy (lib/google-calendar.getPairBusy).
 */
export async function calendarsConnected(reporterId: string, employeeId: string): Promise<{ reporter: boolean; employee: boolean; both: boolean; either: boolean }> {
  const [reporter, employee] = await Promise.all([isCalendarEnabled(reporterId), isCalendarEnabled(employeeId)])
  return { reporter, employee, both: reporter && employee, either: reporter || employee }
}

/**
 * "Free on both calendars (09:00 – 19:00 your time)" when both share hours and zone, otherwise the
 * per-person breakdown from formatWorkHoursLabel.
 */
export function workingHoursLabel({ reporter, employee }: PairProfiles, viewerIsReporter = true): string {
  const same = reporter.timeZone === employee.timeZone && reporter.workStart === employee.workStart && reporter.workEnd === employee.workEnd
  if (!same) {
    return formatWorkHoursLabel({ start: reporter.workStart, end: reporter.workEnd }, reporter.timeZone, { start: employee.workStart, end: employee.workEnd }, employee.timeZone)
  }
  return `Free on both calendars (${reporter.workStart} – ${reporter.workEnd}${viewerIsReporter ? ' your time' : ''})`
}

/** App meetings (PROPOSED/SCHEDULED) involving either person, as busy intervals, for the reporter's calendar day. */
export async function appMeetingsBusy(reporterId: string, employeeId: string, date: Date, reporterTimeZone: string, excludeMeetingId?: string): Promise<Interval[]> {
  const dayKey = toDateKey(date, reporterTimeZone)
  const dayStart = startOfDayInTz(dayKey, reporterTimeZone)
  const dayEnd = startOfDayInTz(addDaysToKey(dayKey, 1), reporterTimeZone) // exact local day, DST-safe
  const meetings = await prisma.meeting.findMany({
    where: {
      ...(excludeMeetingId ? { id: { not: excludeMeetingId } } : {}),
      status: { in: [MeetingStatus.PROPOSED, MeetingStatus.SCHEDULED] },
      // a meeting that starts just before midnight still blocks the start of the day
      meetingDate: { gte: new Date(dayStart.getTime() - MAX_MEETING_DURATION * 60_000), lt: dayEnd },
      OR: [{ employeeId }, { reporterId }, { employeeId: reporterId }, { reporterId: employeeId }],
    },
    select: { meetingDate: true, durationMinutes: true },
  })
  return meetings.map((m) => ({ start: m.meetingDate.getTime(), end: m.meetingDate.getTime() + m.durationMinutes * 60_000 }))
}

/**
 * Mutual free slots of `durationMinutes` on a date: free on both Google Calendars, inside both
 * people's working hours, and not overlapping an existing PROPOSED/SCHEDULED meeting of either person.
 */
/** `excludeMeetingId`: the meeting being moved doesn't block its own new time. */
export async function freeSlotsForDay(reporterId: string, employeeId: string, date: Date, profiles: PairProfiles, durationMinutes: number, excludeMeetingId?: string) {
  const [calendarSlots, busy] = await Promise.all([
    getMutualFreeSlots(reporterId, employeeId, date, durationMinutes, profiles.options),
    appMeetingsBusy(reporterId, employeeId, date, profiles.reporter.timeZone, excludeMeetingId),
  ])
  return calendarSlots.filter((s) => isIntervalFree(new Date(s.start).getTime(), new Date(s.end).getTime(), busy))
}

/** How many upcoming occurrences a recurring slot is checked against (one-off leave shouldn't block the series). */
export const MAX_OCCURRENCES_TO_CHECK = 6

/**
 * First of `candidates` that is not a Keka holiday/leave day for either person and is free on both
 * calendars; null when every candidate is blocked. Callers decide what to do when calendars aren't connected.
 */
export async function firstFreeOccurrence(reporterId: string, employeeId: string, candidates: Date[], profiles: PairProfiles, durationMinutes: number): Promise<Date | null> {
  for (const date of candidates) {
    if (await isDateUnavailableForEitherUser(reporterId, employeeId, date)) continue
    if (await isDateTimeFreeForBoth(reporterId, employeeId, date, durationMinutes, profiles.options)) return date
  }
  return null
}
