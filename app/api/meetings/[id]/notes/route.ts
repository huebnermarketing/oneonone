import { NextRequest, NextResponse } from 'next/server'
import { notFound, parseBody, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { assertAccess, canManageMeeting, canViewNotes } from '@/lib/meeting-access'
import { logMeetingUpdated } from '@/lib/audit'
import { meetingNotesSchema } from '@/lib/validation/meetings'

export const dynamic = 'force-dynamic'

const select = { id: true, notes: true, employeeId: true, reporterId: true } as const

/** GET — reporter/admin always; employee when the employeeCanViewNotes policy allows. */
export const GET = withApiAuth(async (_req: NextRequest, { user, params }) => {
  const meeting = await prisma.meeting.findUnique({ where: { id: params.id }, select })
  if (!meeting) throw notFound('Meeting')
  assertAccess(await canViewNotes(user, meeting))
  return NextResponse.json({ notes: meeting.notes })
})

/** PATCH — reporter/admin only. */
export const PATCH = withApiAuth(async (req: NextRequest, { user, params }) => {
  const { notes } = await parseBody(req, meetingNotesSchema)

  const meeting = await prisma.meeting.findUnique({ where: { id: params.id }, select })
  if (!meeting) throw notFound('Meeting')
  assertAccess(canManageMeeting(user, meeting), 'Only the reporter or an admin can edit notes')

  const updated = await prisma.meeting.update({
    where: { id: params.id },
    data: { notes },
    select: { id: true, notes: true },
  })
  await logMeetingUpdated(user.id, params.id, { notes: 'updated' })
  return NextResponse.json(updated)
})
