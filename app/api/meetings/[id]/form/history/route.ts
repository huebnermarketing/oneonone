import { NextRequest, NextResponse } from 'next/server'
import { notFound, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { assertAccess, canViewMeeting } from '@/lib/meeting-access'

export const dynamic = 'force-dynamic'

/** GET /api/meetings/[id]/form/history — every submit / edit of the check-in answers, newest first. */
export const GET = withApiAuth(async (_req: NextRequest, { user, params }) => {
  const meeting = await prisma.meeting.findUnique({ where: { id: params.id }, select: { id: true, employeeId: true, reporterId: true, formSubmittedAt: true } })
  if (!meeting) throw notFound('Meeting')
  assertAccess(canViewMeeting(user, meeting))
  // Before submission the answers are the employee's private draft
  if (!meeting.formSubmittedAt && user.id !== meeting.employeeId) return NextResponse.json([])
  const revisions = await prisma.meetingFormRevision.findMany({
    where: { meetingId: meeting.id },
    orderBy: { createdAt: 'desc' },
    include: { editedBy: { select: { id: true, name: true } } },
  })
  return NextResponse.json(revisions)
})
