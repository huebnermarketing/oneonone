import { NextRequest, NextResponse } from 'next/server'
import { ApiError, REPORTER_OR_ADMIN, badRequest, conflict, notFound, parseBody, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { isAiConfigured } from '@/lib/ai'
import { logRecordingProcessed } from '@/lib/audit'
import { assertAccess, canManageMeeting } from '@/lib/meeting-access'
import { checkRateLimit } from '@/lib/rate-limit'
import { PipelineError, startJob } from '@/lib/recording-pipeline'
import { processRecordingSchema } from '@/lib/validation/meetings'

export const dynamic = 'force-dynamic'

/**
 * POST /api/meetings/[id]/recording/process — finalize a recording: combine chunks, transcribe, analyze.
 * Returns immediately with the job; the pipeline runs in the background and `recording.status` tracks progress.
 */
export const POST = withApiAuth(REPORTER_OR_ADMIN, async (req: NextRequest, { user, params }) => {
  const { allowed } = checkRateLimit(req, 'recordings')
  if (!allowed) throw new ApiError(429, 'Too many requests')

  const { totalChunks, duration, language } = await parseBody(req, processRecordingSchema)

  if (!(await isAiConfigured())) throw badRequest('AI provider API key not configured. Set it in Admin → Settings → AI Provider.')

  const meeting = await prisma.meeting.findUnique({
    where: { id: params.id },
    select: { id: true, employeeId: true, reporterId: true },
  })
  if (!meeting) throw notFound('Meeting')
  assertAccess(canManageMeeting(user, meeting), 'Only the reporter or an admin can process this recording')

  const recording = await prisma.meetingRecording.findUnique({
    where: { meetingId: meeting.id },
    select: { id: true, audioKey: true },
  })
  if (!recording?.audioKey) throw badRequest('No recording session found. Start a recording first.')

  await prisma.meetingRecording.update({
    where: { meetingId: meeting.id },
    data: { duration, status: 'UPLOADED', errorMessage: null },
  })

  let job
  try {
    job = await startJob({ meetingId: meeting.id, kind: 'PROCESS', totalChunks, language, triggeredById: user.id })
  } catch (err) {
    if (err instanceof PipelineError) throw err.code === 'BUSY' ? conflict(err.message) : badRequest(err.message)
    throw err
  }

  await logRecordingProcessed(user.id, meeting.id, { recordingId: recording.id, jobId: job.id, language: language ?? null, totalChunks })

  return NextResponse.json({ message: 'Processing started', recordingId: recording.id, jobId: job.id })
})
