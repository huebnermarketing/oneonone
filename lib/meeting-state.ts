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
import { badRequest } from './api'
import { getPolicies } from './settings'
import { logMeetingUpdated } from './audit'
import { notifyMeetingCancelled, notifyMeetingCompleted } from './notifications'
import { sendMeetingCancelledEmail } from './email'
import { deleteCalendarEvent } from './google-calendar'

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

const meetingWithParties = Prisma.validator<Prisma.MeetingDefaultArgs>()({
  include: {
    employee: { select: { id: true, name: true, email: true } },
    reporter: { select: { id: true, name: true, email: true } },
    calendarEvent: true,
  },
})
export type MeetingWithParties = Prisma.MeetingGetPayload<typeof meetingWithParties>

export async function loadMeeting(id: string): Promise<MeetingWithParties | null> {
  return prisma.meeting.findUnique({ where: { id }, ...meetingWithParties })
}

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
    data: { status: 'COMPLETED' },
    ...meetingWithParties,
  })

  await logMeetingUpdated(actorId, meeting.id, { status: 'COMPLETED', employeeName: meeting.employee.name })
  await notifyMeetingCompleted(meeting.employeeId, meeting.reporter.name, meeting.id).catch((e) =>
    console.error('[meeting-state] notifyMeetingCompleted failed', e)
  )
  return updated
}

/**
 * Cancel a single meeting: status → CANCELLED, remove the Google Calendar event, tell the other party.
 * Authorization (cancelPolicy) is the caller's job via lib/meeting-access.canCancel.
 */
export async function cancelMeeting(
  meeting: MeetingWithParties,
  actor: { id: string; name?: string | null },
  reason?: string
) {
  assertTransition(meeting.status, 'CANCELLED')

  const updated = await prisma.meeting.update({
    where: { id: meeting.id },
    data: { status: 'CANCELLED' },
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
  }

  // Notify everyone who is not the actor (admin cancelling → both parties hear about it)
  const actorName = actor.name || 'An administrator'
  const recipients = [meeting.employee, meeting.reporter].filter((p) => p.id !== actor.id)
  await Promise.all(
    recipients.flatMap((p) => [
      notifyMeetingCancelled(p.id, actorName, meeting.meetingDate, meeting.id).catch((e) =>
        console.error('[meeting-state] notifyMeetingCancelled failed', e)
      ),
      sendMeetingCancelledEmail(p.email, p.name, actorName, meeting.meetingDate, reason).catch((e) =>
        console.error('[meeting-state] sendMeetingCancelledEmail failed', e)
      ),
    ])
  )

  return updated
}
