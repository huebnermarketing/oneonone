/**
 * Time-conflict check shared by POST /api/meetings and POST /api/meetings/[id]/suggest.
 *
 * A proposed time conflicts when either party (employee or reporter) already has an active
 * (PROPOSED or SCHEDULED) meeting, in any role, that starts within one meeting length of it.
 */
import { MeetingStatus } from '@prisma/client'
import { prisma } from './prisma'
import { conflict } from './api-errors'
import { MEETING_DURATION_MINUTES } from './constants'

const ACTIVE_STATUSES: MeetingStatus[] = [MeetingStatus.PROPOSED, MeetingStatus.SCHEDULED]

/** Two 30-minute meetings may start exactly 30 minutes apart, so the window is one minute short of the duration. */
const CONFLICT_WINDOW_MS = (MEETING_DURATION_MINUTES - 1) * 60 * 1000

/**
 * Throw a 409 if `employeeId` or `reporterId` already has an active meeting overlapping `date`.
 * Pass `excludeMeetingId` when re-timing an existing meeting so it does not conflict with itself.
 */
export async function assertNoConflict(
  employeeId: string,
  reporterId: string,
  date: Date,
  excludeMeetingId?: string
): Promise<void> {
  const windowStart = new Date(date.getTime() - CONFLICT_WINDOW_MS)
  const windowEnd = new Date(date.getTime() + CONFLICT_WINDOW_MS)

  const conflicting = await prisma.meeting.findFirst({
    where: {
      ...(excludeMeetingId ? { id: { not: excludeMeetingId } } : {}),
      status: { in: ACTIVE_STATUSES },
      meetingDate: { gte: windowStart, lte: windowEnd },
      OR: [{ employeeId }, { reporterId }, { employeeId: reporterId }, { reporterId: employeeId }],
    },
    select: {
      employeeId: true,
      reporterId: true,
      employee: { select: { name: true } },
      reporter: { select: { name: true } },
    },
  })
  if (!conflicting) return

  const employeeInvolved = conflicting.employeeId === employeeId || conflicting.reporterId === employeeId
  const busyPersonId = employeeInvolved ? employeeId : reporterId
  const busyPerson = conflicting.employeeId === busyPersonId ? conflicting.employee : conflicting.reporter
  const otherPerson = conflicting.employeeId === busyPersonId ? conflicting.reporter : conflicting.employee

  throw conflict(
    `${busyPerson?.name || 'This person'} already has a meeting with ${otherPerson?.name || 'someone'} at this time. Please choose a different time slot.`
  )
}
