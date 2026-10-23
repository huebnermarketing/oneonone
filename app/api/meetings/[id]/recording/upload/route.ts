import { NextRequest, NextResponse } from 'next/server'
import { ApiError, REPORTER_OR_ADMIN, badRequest, notFound, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { assertAccess, canManageMeeting } from '@/lib/meeting-access'
import { checkRateLimit } from '@/lib/rate-limit'
import { chunkKey, uploadToS3 } from '@/lib/s3'

export const dynamic = 'force-dynamic'

export const maxDuration = 300

/** Read the multipart chunk. Oversized bodies surface as 413, anything else unparsable as 400. */
async function readChunk(req: NextRequest): Promise<{ buffer: Buffer; sequence: number }> {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : ''
    const tooLarge = /body|size|limit|413/i.test(msg)
    throw tooLarge ? new ApiError(413, 'Chunk too large') : badRequest('Invalid request')
  }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) throw badRequest('No chunk data provided')

  const sequenceRaw = formData.get('sequence')
  const sequence = typeof sequenceRaw === 'string' ? parseInt(sequenceRaw, 10) : 0
  if (!Number.isInteger(sequence) || sequence < 0) throw badRequest('Invalid chunk sequence')

  return { buffer: Buffer.from(await file.arrayBuffer()), sequence }
}

/** POST /api/meetings/[id]/recording/upload — upload one audio chunk of an active recording session. */
export const POST = withApiAuth(REPORTER_OR_ADMIN, async (req: NextRequest, { user, params }) => {
  // Chunks arrive every 30s for the whole recording, so the per-hour 'recordings' bucket (10/h)
  // would cut a session off after 5 minutes; the per-minute 'api' bucket throttles abuse without that.
  const { allowed } = checkRateLimit(req, 'api')
  if (!allowed) throw new ApiError(429, 'Too many requests')

  const meeting = await prisma.meeting.findUnique({
    where: { id: params.id },
    select: { id: true, employeeId: true, reporterId: true },
  })
  if (!meeting) throw notFound('Meeting')
  assertAccess(canManageMeeting(user, meeting), 'Only the reporter or an admin can record this meeting')

  // Recording session must already exist (started via /presign)
  const recording = await prisma.meetingRecording.findUnique({
    where: { meetingId: meeting.id },
    select: { audioKey: true, fileSize: true },
  })
  if (!recording?.audioKey) throw badRequest('No active recording session. Call start first.')

  const { buffer, sequence } = await readChunk(req)

  // {sessionKey}/chunk_0000.webm
  const key = chunkKey(recording.audioKey, sequence)
  await uploadToS3(buffer, key, 'audio/webm')

  await prisma.meetingRecording.update({
    where: { meetingId: meeting.id },
    data: { fileSize: { increment: buffer.length } },
  })

  console.log(`[Recording] Chunk ${sequence} uploaded: ${(buffer.length / 1024).toFixed(1)} KB, key=${key}`)
  return NextResponse.json({ success: true, chunkKey: key, sequence })
})
