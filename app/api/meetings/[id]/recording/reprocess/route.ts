import { NextRequest, NextResponse } from 'next/server'
import { ApiError, REPORTER_OR_ADMIN, badRequest, conflict, notFound, parseBody, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { isAiConfigured } from '@/lib/ai'
import { createAuditLog } from '@/lib/audit'
import { assertAccess, canManageMeeting } from '@/lib/meeting-access'
import { checkRateLimit } from '@/lib/rate-limit'
import { PipelineError, startJob } from '@/lib/recording-pipeline'
import { reprocessRecordingSchema } from '@/lib/validation/meetings'

export const dynamic = 'force-dynamic'

/**
 * POST /api/meetings/[id]/recording/reprocess — re-run the pipeline on an existing recording
 * without re-recording. `from: "TRANSCRIBE"` redoes transcription + analysis from the stored audio;
 * `from: "ANALYZE"` redoes analysis only from the stored transcript; omitted = cheapest missing stage.
 * Reporter of the meeting or admin. 409 while a run is already in progress.
 */
export const POST = withApiAuth(REPORTER_OR_ADMIN, async (req: NextRequest, { user, params }) => {
  const { allowed } = checkRateLimit(req, 'recordings')
  if (!allowed) throw new ApiError(429, 'Too many requests')

  const { from, language } = await parseBody(req, reprocessRecordingSchema)
  if (!(await isAiConfigured())) throw badRequest('AI provider API key not configured. Set it in Admin → Settings → AI Provider.')

  const meeting = await prisma.meeting.findUnique({
    where: { id: params.id },
    select: { id: true, employeeId: true, reporterId: true, recording: { select: { id: true, status: true } } },
  })
  if (!meeting) throw notFound('Meeting')
  assertAccess(canManageMeeting(user, meeting), 'Only the reporter or an admin can reprocess this recording')
  if (!meeting.recording) throw notFound('Recording')
  if (meeting.recording.status === 'UPLOADING') throw badRequest('Recording is still being uploaded. Finish or discard it first.')

  let job
  try {
    job = await startJob({ meetingId: meeting.id, kind: 'REPROCESS', fromStage: from, language, triggeredById: user.id })
  } catch (err) {
    if (err instanceof PipelineError) throw err.code === 'BUSY' ? conflict(err.message) : badRequest(err.message)
    throw err
  }

  await createAuditLog({
    userId: user.id,
    action: 'UPDATE',
    entityType: 'Recording',
    entityId: meeting.id,
    details: { recordingId: meeting.recording.id, jobId: job.id, action: 'reprocess', fromStage: job.fromStage, language: language ?? null },
  })

  return NextResponse.json({ message: `Reprocessing started from ${job.fromStage}`, jobId: job.id, fromStage: job.fromStage })
})
