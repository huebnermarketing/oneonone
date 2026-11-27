import { prisma } from './prisma'
import { absenceLabel, absencesForMeetings, blockingAbsence, blocks, type DayAbsence } from './absences'
import { cancelCalendarOccurrence } from './google-calendar'
import * as notify from './notify'

/**
 * Hourly Keka checks (called from /api/cron/meetings):
 *  - watchLeaveConflicts: booked meetings in the next LEAVE_WATCH_DAYS days where a participant is now on
 *    approved leave / holiday → the manager is alerted once (Meeting.leaveAlertedAt), cleared when it no
 *    longer applies (leave withdrawn, meeting moved).
 *  - recurringOccurrenceSkip: the cron asks before booking a recurring occurrence; on leave / holiday the
 *    occurrence is not booked, it is removed from the Google series, and both people are told.
 */

export const LEAVE_WATCH_DAYS = 14

/** "Holiday" / "On leave" / "Half-day leave" — for messages. */
export const reasonOf = (a: DayAbsence) => absenceLabel(a)

export interface LeaveWatchResult {
  checked: number
  alerted: number
  cleared: number
}

export async function watchLeaveConflicts(now = new Date()): Promise<LeaveWatchResult> {
  const result: LeaveWatchResult = { checked: 0, alerted: 0, cleared: 0 }
  const meetings = await prisma.meeting.findMany({
    where: {
      status: 'SCHEDULED',
      meetingDate: { gte: now, lte: new Date(now.getTime() + LEAVE_WATCH_DAYS * 86_400_000) },
      employee: { isActive: true },
      reporter: { isActive: true },
    },
    select: {
      id: true,
      meetingDate: true,
      durationMinutes: true,
      employeeId: true,
      reporterId: true,
      leaveAlertedAt: true,
      employee: { select: { id: true, name: true, email: true } },
      reporter: { select: { id: true, name: true, email: true } },
    },
    orderBy: { meetingDate: 'asc' },
  })
  if (meetings.length === 0) return result
  const absences = await absencesForMeetings(meetings, now)

  for (const m of meetings) {
    result.checked++
    const a = absences[m.id]
    const away = blocks(a?.employee)
      ? { personName: m.employee.name || 'Your team member', absence: a!.employee! }
      : blocks(a?.reporter)
        ? { personName: 'You', absence: a!.reporter! }
        : null

    if (away && !m.leaveAlertedAt) {
      const marked = await prisma.meeting.updateMany({ where: { id: m.id, leaveAlertedAt: null }, data: { leaveAlertedAt: now } })
      if (marked.count > 0) {
        result.alerted++
        await notify.leaveConflict({ meetingId: m.id, date: m.meetingDate, manager: m.reporter, personName: away.personName, reason: reasonOf(away.absence) })
      }
    } else if (!away && m.leaveAlertedAt) {
      await prisma.meeting.update({ where: { id: m.id }, data: { leaveAlertedAt: null } })
      result.cleared++
    }
  }
  return result
}

interface ScheduleForSkip {
  id: string
  reporterId: string
  employeeId: string
  durationMinutes: number
  googleRecurringEventId: string | null
  reporter: { id: string; name: string | null; email: string }
  employee: { id: string; name: string | null; email: string }
}

/**
 * Should this recurring occurrence be skipped (approved leave / holiday for either person)? When yes, it is
 * removed from the Google series (best effort) and both people are told; the caller then advances the
 * schedule without booking it.
 */
export async function recurringOccurrenceSkip(schedule: ScheduleForSkip, at: Date): Promise<{ skipped: boolean; reason?: string }> {
  const away = await blockingAbsence(schedule.reporterId, schedule.employeeId, at, schedule.durationMinutes)
  if (!away) return { skipped: false }
  const who = away.who === 'employee' ? schedule.employee.name || 'Employee' : schedule.reporter.name || 'Manager'
  const reason = `${who}: ${reasonOf(away.absence)}`
  if (schedule.googleRecurringEventId) {
    await cancelCalendarOccurrence(schedule.googleRecurringEventId, schedule.reporterId, at).catch((err) =>
      console.warn(`[leave-watch] could not remove skipped occurrence from Google (schedule ${schedule.id}):`, err instanceof Error ? err.message : err)
    )
  }
  await notify.meetingSkipped({ scheduleId: schedule.id, date: at, reporter: schedule.reporter, employee: schedule.employee, reason })
  return { skipped: true, reason }
}
