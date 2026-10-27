import { NextRequest, NextResponse } from 'next/server'
import { notFound, withApiAuth } from '@/lib/api'
import { assertAccess, canViewMeeting } from '@/lib/meeting-access'
import { loadMeeting } from '@/lib/meeting-state'
import { acceptReschedule } from '@/lib/reschedule'

export const dynamic = 'force-dynamic'

/** POST /api/meetings/[id]/reschedule/accept — the other participant accepts the pending new time. */
export const POST = withApiAuth(async (_req: NextRequest, { user, params }) => {
  const meeting = await loadMeeting(params.id)
  if (!meeting) throw notFound('Meeting')
  assertAccess(canViewMeeting(user, meeting))
  return NextResponse.json(await acceptReschedule(meeting, user))
})
