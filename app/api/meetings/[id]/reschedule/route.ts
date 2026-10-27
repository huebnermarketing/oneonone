import { NextRequest, NextResponse } from 'next/server'
import { notFound, parseBody, withApiAuth } from '@/lib/api'
import { assertAccess, canViewMeeting } from '@/lib/meeting-access'
import { loadMeeting } from '@/lib/meeting-state'
import { dropReschedule, requestReschedule } from '@/lib/reschedule'
import { rescheduleMeetingSchema } from '@/lib/validation/meetings'

export const dynamic = 'force-dynamic'

/**
 * POST /api/meetings/[id]/reschedule {meetingDate, durationMinutes?, reason?}
 * A participant asks to move a SCHEDULED meeting; the other participant must accept
 * (POST …/reschedule/accept). Replaces any pending request.
 */
export const POST = withApiAuth(async (req: NextRequest, { user, params }) => {
  const body = await parseBody(req, rescheduleMeetingSchema)
  const meeting = await loadMeeting(params.id)
  if (!meeting) throw notFound('Meeting')
  assertAccess(canViewMeeting(user, meeting))
  return NextResponse.json(await requestReschedule(meeting, user, body))
})

/** DELETE /api/meetings/[id]/reschedule — requester withdraws, or the other participant declines. */
export const DELETE = withApiAuth(async (_req: NextRequest, { user, params }) => {
  const meeting = await loadMeeting(params.id)
  if (!meeting) throw notFound('Meeting')
  assertAccess(canViewMeeting(user, meeting))
  const { withdrawn } = await dropReschedule(meeting, user)
  return NextResponse.json({ success: true, withdrawn })
})
