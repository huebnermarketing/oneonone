/**
 * Time-conflict check shared by POST /api/meetings, suggest and reschedule.
 *
 * A proposed time conflicts when either party (employee or reporter) already has an active
 * (PROPOSED or SCHEDULED) meeting, in any role, whose [start, start + its length) overlaps
 * [date, date + durationMinutes). Back-to-back meetings (one ends as the next starts) are fine.
 */
import { MeetingStatus } from '@prisma/client'
import { prisma } from './prisma'
import { conflict } from './api-errors'
import { MAX_MEETING_DURATION } from './meeting-duration'

const ACTIVE_STATUSES: MeetingStatus[] = [MeetingStatus.PROPOSED, MeetingStatus.SCHEDULED]

export interface ConflictOptions {
  /** Length of the meeting being placed */
  durationMinutes: number
  /** When re-timing an existing meeting, so it does not conflict with itself */
  excludeMeetingId?: string
}

/** Pure: do [aStart, aStart + aMin) and [bStart, bStart + bMin) overlap? */
export function overlaps(aStart: Date, aMinutes: number, bStart: Date, bMinutes: number): boolean {
  return aStart.getTime() < bStart.getTime() + bMinutes * 60_000 && bStart.getTime() < aStart.getTime() + aMinutes * 60_000
}

/** Throw a 409 if `employeeId` or `reporterId` already has an active meeting overlapping the new one. */
export async function assertNoConflict(employeeId: string, reporterId: string, date: Date, { durationMinutes, excludeMeetingId }: ConflictOptions): Promise<void> {
  // Any overlapping meeting starts after (date - longest length) and before the new one ends
  const candidates = await prisma.meeting.findMany({
    where: {
      ...(excludeMeetingId ? { id: { not: excludeMeetingId } } : {}),
      status: { in: ACTIVE_STATUSES },
      meetingDate: { gt: new Date(date.getTime() - MAX_MEETING_DURATION * 60_000), lt: new Date(date.getTime() + durationMinutes * 60_000) },
      OR: [{ employeeId }, { reporterId }, { employeeId: reporterId }, { reporterId: employeeId }],
    },
    select: {
      meetingDate: true,
      durationMinutes: true,
      employeeId: true,
      reporterId: true,
      employee: { select: { name: true } },
      reporter: { select: { name: true } },
    },
  })
  const conflicting = candidates.find((m) => overlaps(m.meetingDate, m.durationMinutes, date, durationMinutes))
  if (!conflicting) return

  const employeeInvolved = conflicting.employeeId === employeeId || conflicting.reporterId === employeeId
  const busyPersonId = employeeInvolved ? employeeId : reporterId
  const busyPerson = conflicting.employeeId === busyPersonId ? conflicting.employee : conflicting.reporter
  const otherPerson = conflicting.employeeId === busyPersonId ? conflicting.reporter : conflicting.employee

  throw conflict(
    `${busyPerson?.name || 'This person'} already has a meeting with ${otherPerson?.name || 'someone'} at this time. Please choose a different time slot.`
  )
}
