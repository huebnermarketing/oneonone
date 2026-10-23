import { NextRequest, NextResponse } from 'next/server'
import { ApiError, REPORTER_OR_ADMIN, badRequest, notFound, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit'
import { assertAccess, canManageMeeting } from '@/lib/meeting-access'
import { generateSessionKey, isS3Configured } from '@/lib/s3'

export const dynamic = 'force-dynamic'

/** POST /api/meetings/[id]/recording/presign — start a recording session (DB row + S3 session key). */
export const POST = withApiAuth(REPORTER_OR_ADMIN, async (_req: NextRequest, { user, params }) => {
  const meeting = await prisma.meeting.findUnique({
    where: { id: params.id },
    select: { id: true, employeeId: true, reporterId: true, status: true },
  })
  if (!meeting) throw notFound('Meeting')
  assertAccess(canManageMeeting(user, meeting), 'Only the reporter or an admin can record this meeting')

  if (meeting.status === 'CANCELLED') throw badRequest('Cannot record a cancelled meeting')

  if (!(await isS3Configured())) {
    throw new ApiError(503, 'S3 is not configured. Configure AWS S3 in Admin → Settings → Recording Storage before recording.')
  }

  const existing = await prisma.meetingRecording.findUnique({ where: { meetingId: meeting.id }, select: { status: true } })
  if (existing?.status === 'COMPLETED') throw badRequest('A completed recording already exists for this meeting.')

  // Session key = S3 prefix for this recording's chunks
  const sessionKey = generateSessionKey(meeting.id)
  const sessionData = { audioKey: sessionKey, duration: 0, fileSize: 0, status: 'UPLOADING' as const, recordedAt: new Date() }

  const recording = await prisma.meetingRecording.upsert({
    where: { meetingId: meeting.id },
    create: { meetingId: meeting.id, ...sessionData },
    update: { ...sessionData, errorMessage: null },
  })

  await createAuditLog({
    userId: user.id,
    action: existing ? 'UPDATE' : 'CREATE',
    entityType: 'MeetingRecording',
    entityId: recording.id,
    details: { meetingId: meeting.id, action: 'session_started', sessionKey },
  })

  console.log(`[Recording] Session started: meeting=${meeting.id}, sessionKey=${sessionKey}`)
  return NextResponse.json({ sessionKey })
})
