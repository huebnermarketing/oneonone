import { NextRequest, NextResponse } from 'next/server'
import { notFound, parseBody, withApiAuth } from '@/lib/api'
import { assertAccess, canCancel } from '@/lib/meeting-access'
import { cancelMeeting, loadMeeting } from '@/lib/meeting-state'
import { cancelMeetingSchema } from '@/lib/validation/meetings'

export const dynamic = 'force-dynamic'

/**
 * POST /api/meetings/[id]/cancel  { reason? }
 * Cancels a single PROPOSED or SCHEDULED meeting. Who may do this is governed by the
 * "cancelPolicy" setting (Admin → Settings → Policies); Super Admins always can.
 */
export const POST = withApiAuth(async (req: NextRequest, { user, params }) => {
  const { reason } = await parseBody(req, cancelMeetingSchema)

  const meeting = await loadMeeting(params.id)
  if (!meeting) throw notFound('Meeting')

  assertAccess(await canCancel(user, meeting), 'You are not allowed to cancel this meeting')

  const updated = await cancelMeeting(meeting, user, reason)
  return NextResponse.json(updated)
})
