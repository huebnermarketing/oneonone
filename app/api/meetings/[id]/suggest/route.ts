import { NextRequest, NextResponse } from 'next/server'
import { badRequest, notFound, parseBody, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { logMeetingUpdated } from '@/lib/audit'
import { assertAccess, canSuggest, isReceiver } from '@/lib/meeting-access'
import { loadMeeting } from '@/lib/meeting-state'
import { assertNoConflict } from '@/lib/meeting-conflicts'
import { sendMeetingProposalEmail, sendMeetingSuggestionEmail } from '@/lib/email'
import { notifyMeetingSuggested } from '@/lib/notifications'
import { suggestMeetingSchema } from '@/lib/validation/meetings'

export const dynamic = 'force-dynamic'

/**
 * POST /api/meetings/[id]/suggest — a participant (or admin) proposes a different time for a PROPOSED meeting.
 * When the receiver suggests, `proposedById` flips so the other side can accept.
 * When the proposer edits their own proposal, `proposedById` is unchanged.
 */
export const POST = withApiAuth(async (req: NextRequest, { user, params }) => {
  const { meetingDate } = await parseBody(req, suggestMeetingSchema)

  const meeting = await loadMeeting(params.id)
  if (!meeting) throw notFound('Meeting')
  if (meeting.status !== 'PROPOSED') throw badRequest('This meeting is not in a proposed state')
  assertAccess(canSuggest(user, meeting), 'Only meeting participants can change the time')

  await assertNoConflict(meeting.employeeId, meeting.reporterId, meetingDate, meeting.id)

  const receiver = isReceiver(user, meeting)
  const proposerIsThirdParty =
    !!meeting.proposedById && meeting.proposedById !== meeting.reporterId && meeting.proposedById !== meeting.employeeId
  const isProposer = user.id === meeting.proposedById || (proposerIsThirdParty && user.id === meeting.reporterId)

  const updated = await prisma.meeting.update({
    where: { id: meeting.id },
    data: { meetingDate, ...(receiver ? { proposedById: user.id } : {}) },
    include: {
      employee: { select: { id: true, name: true, email: true } },
      reporter: { select: { id: true, name: true, email: true } },
    },
  })

  const otherParty = user.id === meeting.employeeId ? meeting.reporter : meeting.employee
  const suggestor = user.id === meeting.employeeId ? meeting.employee : meeting.reporter
  const sendEmail = isProposer ? sendMeetingProposalEmail : sendMeetingSuggestionEmail

  await Promise.all([
    sendEmail(otherParty.email, otherParty.name, suggestor.name, meetingDate, meeting.id).catch((e) =>
      console.error('Failed to send time change email:', e)
    ),
    notifyMeetingSuggested(otherParty.id, suggestor.name, meetingDate, meeting.id).catch((e) =>
      console.error('Failed to create suggestion notification:', e)
    ),
    logMeetingUpdated(user.id, meeting.id, {
      action: isProposer ? 'updated_proposal' : 'suggested_new_time',
      newMeetingDate: meetingDate.toISOString(),
      suggestedBy: suggestor.name,
    }),
  ])

  return NextResponse.json(updated)
})
