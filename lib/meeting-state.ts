/**
 * Meeting state machine + the side effects that go with each transition.
 *
 *   PROPOSED ──accept──▶ SCHEDULED ──complete──▶ COMPLETED
 *      │                     │
 *      └──────cancel─────────┴──────▶ CANCELLED
 *
 * Routes call these functions; they must not flip `status` themselves.
 */
import { MeetingStatus, Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { badRequest } from './api-errors'
import { getPolicies } from './settings'
import { logMeetingUpdated } from './audit'
import * as notify from './notify'
import { cancelCalendarOccurrence, deleteCalendarEvent } from './google-calendar'

const TRANSITIONS: Record<MeetingStatus, MeetingStatus[]> = {
  PROPOSED: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

export function assertTransition(from: MeetingStatus, to: MeetingStatus) {
  if (!TRANSITIONS[from].includes(to)) {
    throw badRequest(`A ${from.toLowerCase()} meeting cannot be marked ${to.toLowerCase()}`)
  }
}

export const meetingWithParties = Prisma.validator<Prisma.MeetingDefaultArgs>()({
  include: {
    employee: { select: { id: true, name: true, email: true } },
    reporter: { select: { id: true, name: true, email: true } },
    calendarEvent: true,
    recurringSchedule: { select: { googleRecurringEventId: true } },
  },
})
export type MeetingWithParties = Prisma.MeetingGetPayload<typeof meetingWithParties>

export async function loadMeeting(id: string): Promise<MeetingWithParties | null> {
  return prisma.meeting.findUnique({ where: { id }, ...meetingWithParties })
}

/** Fields that drop a pending reschedule request */
export const CLEAR_RESCHEDULE = {
  rescheduleDate: null,
  rescheduleDuration: null,
  rescheduleRequestedById: null,
  rescheduleRequestedAt: null,
  rescheduleReason: null,
} as const satisfies Prisma.MeetingUpdateInput

/**
 * Complete a meeting. Enforces SCHEDULED → COMPLETED and the requireFormBeforeComplete policy.
 */
export async function completeMeeting(meeting: MeetingWithParties, actorId: string) {
  assertTransition(meeting.status, 'COMPLETED')
  const { requireFormBeforeComplete } = await getPolicies()
  if (requireFormBeforeComplete && !meeting.formSubmittedAt) {
    throw badRequest('Please submit the required meeting form before marking this meeting as completed.')
  }

  const updated = await prisma.meeting.update({
    where: { id: meeting.id },
    data: { status: 'COMPLETED', ...CLEAR_RESCHEDULE },
    ...meetingWithParties,
  })

  await logMeetingUpdated(actorId, meeting.id, { status: 'COMPLETED', employeeName: meeting.employee.name })
  await notify.meetingCompleted({ meetingId: meeting.id, employeeId: meeting.employeeId, reporterName: meeting.reporter.name })
  return updated
}

/**
 * Cancel a single meeting: status → CANCELLED, remove the Google Calendar event, tell the other party.
 * Authorization (cancelPolicy) is the caller's job via lib/meeting-access.canCancel.
 */
export async function cancelMeeting(
  meeting: MeetingWithParties,
  actor: { id: string; name?: string | null },
  reason?: string,
  /** People not to notify (e.g. someone who has left the company) */
  opts: { excludeUserIds?: string[] } = {}
) {
  assertTransition(meeting.status, 'CANCELLED')

  const updated = await prisma.meeting.update({
    where: { id: meeting.id },
    data: { status: 'CANCELLED', ...CLEAR_RESCHEDULE },
    ...meetingWithParties,
  })

  await logMeetingUpdated(actor.id, meeting.id, {
    status: 'CANCELLED',
    reason: reason ?? null,
    employeeName: meeting.employee.name,
  })

  if (meeting.calendarEvent) {
    await deleteCalendarEvent(meeting.calendarEvent.googleEventId, meeting.reporterId).catch((e) =>
      console.error('[meeting-state] deleteCalendarEvent failed', e)
    )
  } else if (meeting.status === 'SCHEDULED' && meeting.recurringSchedule?.googleRecurringEventId) {
    // An occurrence of a recurring series: remove just that day from both calendars
    await cancelCalendarOccurrence(meeting.recurringSchedule.googleRecurringEventId, meeting.reporterId, meeting.meetingDate).catch((e) =>
      console.error('[meeting-state] cancelCalendarOccurrence failed', e)
    )
  }

  // Notify everyone who is not the actor (admin cancelling → both parties hear about it)
  const actorName = actor.name || 'An administrator'
  const skip = new Set([actor.id, ...(opts.excludeUserIds ?? [])])
  const recipients = [meeting.employee, meeting.reporter].filter((p) => !skip.has(p.id))
  await notify.meetingCancelled({ meetingId: meeting.id, date: meeting.meetingDate, recipients, actorName, reason })

  return updated
}
