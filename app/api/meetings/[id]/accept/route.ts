import { NextRequest, NextResponse } from 'next/server'
import { badRequest, notFound, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { logMeetingUpdated } from '@/lib/audit'
import { assertAccess, canAccept } from '@/lib/meeting-access'
import { assertTransition, loadMeeting } from '@/lib/meeting-state'
import * as notify from '@/lib/notify'
import { createNextOccurrence, syncBookedMeetingToCalendar } from '@/lib/meeting-booking'

export const dynamic = 'force-dynamic'

/**
 * POST /api/meetings/[id]/accept — confirm a PROPOSED meeting (only meetings proposed before booking
 * replaced proposing; new meetings are SCHEDULED on creation and the cron confirms old proposals).
 * PROPOSED → SCHEDULED, next recurring occurrence created, calendar event + employee RSVP, proposer told.
 */
export const POST = withApiAuth(async (_req: NextRequest, { user, params }) => {
  const meeting = await loadMeeting(params.id)
  if (!meeting) throw notFound('Meeting')

  assertTransition(meeting.status, 'SCHEDULED')
  if (meeting.meetingDate.getTime() < Date.now()) {
    throw badRequest('The proposed meeting time has already passed. Please suggest a new time instead.')
  }
  assertAccess(canAccept(user, meeting), 'Only the meeting receiver can accept this proposal')

  // Status flip + next recurring occurrence are one atomic unit
  const updated = await prisma.$transaction(async (tx) => {
    const accepted = await tx.meeting.update({
      where: { id: meeting.id },
      data: { status: 'SCHEDULED' },
      include: {
        employee: { select: { id: true, name: true, email: true } },
        reporter: { select: { id: true, name: true, email: true } },
      },
    })
    if (meeting.recurringScheduleId) await createNextOccurrence(tx, meeting.recurringScheduleId)
    return accepted
  })

  // Side effects are best effort
  await syncBookedMeetingToCalendar(meeting.id)

  const proposer = meeting.proposedById === meeting.reporterId ? meeting.reporter : meeting.employee
  const acceptor = user.id === meeting.employeeId ? meeting.employee : meeting.reporter

  await Promise.all([
    notify.meetingAccepted({ meetingId: meeting.id, date: meeting.meetingDate, to: proposer, acceptorName: acceptor.name, durationMinutes: meeting.durationMinutes }),
    logMeetingUpdated(user.id, params.id, { action: 'accepted', acceptedBy: acceptor.name, status: 'SCHEDULED' }),
  ])

  return NextResponse.json(updated)
})
