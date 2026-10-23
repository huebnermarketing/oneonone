import { NextRequest, NextResponse } from 'next/server'
import { ApiError, notFound, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { getSignedDownloadUrl, isS3Configured } from '@/lib/s3'
import { assertAccess, canViewRecording } from '@/lib/meeting-access'

export const dynamic = 'force-dynamic'

/** GET — 302 to a signed S3 URL for audio playback. Same visibility rule as GET /recording. */
export const GET = withApiAuth(async (_req: NextRequest, { user, params }) => {
  const meeting = await prisma.meeting.findUnique({
    where: { id: params.id },
    include: { recording: true },
  })
  if (!meeting || !meeting.recording?.audioKey) throw notFound('Recording')
  assertAccess(await canViewRecording(user, meeting))

  if (!(await isS3Configured())) throw new ApiError(503, 'S3 storage is not configured')

  return NextResponse.redirect(await getSignedDownloadUrl(meeting.recording.audioKey))
})
