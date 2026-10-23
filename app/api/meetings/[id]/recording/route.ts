import { NextRequest, NextResponse } from 'next/server'
import { notFound, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { getSignedDownloadUrl, deleteS3Prefix, isS3Configured } from '@/lib/s3'
import { assertAccess, canManageMeeting, canViewRecording } from '@/lib/meeting-access'
import { createAuditLog } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/** GET — recording status + signed playback URL. Reporter/admin always; employee when the policy allows. */
export const GET = withApiAuth(async (_req: NextRequest, { user, params }) => {
  const meeting = await prisma.meeting.findUnique({
    where: { id: params.id },
    include: { recording: true },
  })
  if (!meeting) throw notFound('Meeting')
  assertAccess(await canViewRecording(user, meeting))

  if (!meeting.recording) return NextResponse.json({ recording: null })

  let audioPlaybackUrl: string | null = null
  if (meeting.recording.audioKey && meeting.recording.status === 'COMPLETED' && (await isS3Configured())) {
    audioPlaybackUrl = await getSignedDownloadUrl(meeting.recording.audioKey).catch(() => null)
  }

  return NextResponse.json({ recording: { ...meeting.recording, audioPlaybackUrl } })
})

/** DELETE — remove S3 objects (chunks + final) and the DB row. Reporter/admin only. */
export const DELETE = withApiAuth(async (_req: NextRequest, { user, params }) => {
  const meeting = await prisma.meeting.findUnique({
    where: { id: params.id },
    include: { recording: true },
  })
  if (!meeting) throw notFound('Meeting')
  assertAccess(canManageMeeting(user, meeting), 'Only the reporter or an admin can delete a recording')
  if (!meeting.recording) throw notFound('Recording')

  if (meeting.recording.audioKey && (await isS3Configured())) {
    // audioKey is either the session prefix or <prefix>/final.webm
    const prefix = meeting.recording.audioKey.replace(/\/final\.webm$/, '')
    await deleteS3Prefix(prefix)
      .then((n) => console.log(`[Recording] Deleted ${n} S3 objects under ${prefix}`))
      .catch((err) => console.warn('[Recording] Failed to delete from S3:', err))
  }

  await prisma.meetingRecording.delete({ where: { id: meeting.recording.id } })
  await createAuditLog({
    userId: user.id,
    action: 'DELETE',
    entityType: 'MeetingRecording',
    entityId: meeting.recording.id,
    details: { meetingId: meeting.id },
  })

  return NextResponse.json({ message: 'Recording deleted' })
})
