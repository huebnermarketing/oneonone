import { NextRequest, NextResponse } from 'next/server'
import { ApiError, REPORTER_OR_ADMIN, badRequest, notFound, parseBody, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { chunkKey, finalRecordingKey, downloadFromS3, uploadToS3, deleteFromS3 } from '@/lib/s3'
import { transcribeAudio, analyzeTranscript } from '@/lib/openai'
import { getSettings } from '@/lib/settings'
import { logRecordingProcessed } from '@/lib/audit'
import { assertAccess, canManageMeeting } from '@/lib/meeting-access'
import { checkRateLimit } from '@/lib/rate-limit'
import { notifyRecordingReady } from '@/lib/notifications'
import { processRecordingSchema } from '@/lib/validation/meetings'

export const dynamic = 'force-dynamic'

export const maxDuration = 900

/**
 * POST /api/meetings/[id]/recording/process — finalize a recording: combine chunks, transcribe, analyze.
 * Returns immediately; the pipeline runs in the background and the row's `status` tracks progress.
 */
export const POST = withApiAuth(REPORTER_OR_ADMIN, async (req: NextRequest, { user, params }) => {
  const { allowed } = checkRateLimit(req, 'recordings')
  if (!allowed) throw new ApiError(429, 'Too many requests')

  const { totalChunks, duration, language } = await parseBody(req, processRecordingSchema)

  const settings = await getSettings()
  if (!settings.openaiApiKey) throw badRequest('OpenAI API key not configured. Set it in Admin → Settings.')

  const meeting = await prisma.meeting.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      employeeId: true,
      reporterId: true,
      employee: { select: { name: true } },
      reporter: { select: { name: true } },
    },
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
    data: { duration, status: 'UPLOADED' },
  })

  // Kick off background processing (not awaited)
  processRecording(meeting.id, recording.audioKey, totalChunks, meeting.employee.name, meeting.reporter.name, language).catch(
    (err) => console.error('[Recording] Background processing error:', err)
  )

  await logRecordingProcessed(user.id, meeting.id, { recordingId: recording.id, language: language ?? null, totalChunks })

  return NextResponse.json({ message: 'Processing started', recordingId: recording.id })
})

/** Whisper returns tokens like "[BLANK_AUDIO]" or bare punctuation for silence; skip GPT analysis in that case. */
function isSilentTranscript(text: string, durationSeconds: number): boolean {
  const trimmed = text.trim()
  return (
    trimmed.length === 0 ||
    trimmed === '.' ||
    trimmed === '...' ||
    /^\[.*\]$/.test(trimmed) ||
    /^[\s.,!?\-–—…]*$/.test(trimmed) ||
    (trimmed.length < 15 && durationSeconds < 30)
  )
}

async function processRecording(
  meetingId: string,
  sessionKey: string,
  totalChunks: number,
  employeeName: string,
  reporterName: string,
  language?: string
) {
  try {
    console.log(
      `[Recording] Finalizing meeting=${meetingId}, session=${sessionKey}, chunks=${totalChunks}, lang=${language || 'auto'}`
    )

    // Step 1: Download all chunks from S3 and combine
    await prisma.meetingRecording.update({ where: { meetingId }, data: { status: 'TRANSCRIBING' } })

    const buffers: Buffer[] = []
    for (let i = 0; i < totalChunks; i++) {
      const key = chunkKey(sessionKey, i)
      console.log(`[Recording] Downloading chunk ${i}/${totalChunks}: ${key}`)
      buffers.push(await downloadFromS3(key))
    }
    const combined = Buffer.concat(buffers)
    console.log(`[Recording] Combined ${totalChunks} chunks → ${(combined.length / 1024 / 1024).toFixed(2)} MB`)

    if (combined.length < 1000) throw new Error('Combined audio is too small or empty')

    // Step 2: Upload final combined file to S3 and point audioKey at it
    const finalKey = finalRecordingKey(sessionKey)
    await uploadToS3(combined, finalKey, 'audio/webm')
    console.log(`[Recording] Final file uploaded: ${finalKey}`)
    await prisma.meetingRecording.update({
      where: { meetingId },
      data: { audioKey: finalKey, fileSize: combined.length },
    })

    // Step 3: Clean up individual chunks (non-blocking)
    cleanupChunks(sessionKey, totalChunks).catch((err) => console.warn('[Recording] Chunk cleanup failed:', err))

    // Step 4: Transcribe with Whisper
    console.log('[Recording] Starting Whisper transcription...')
    const transcription = await transcribeAudio(combined, 'recording.webm', language)
    console.log(
      `[Recording] Transcription done. Lang=${transcription.language}, dur=${transcription.duration}s, textLen=${transcription.text.length}`
    )

    if (isSilentTranscript(transcription.text, transcription.duration)) {
      console.log('[Recording] No meaningful speech detected. Skipping analysis.')
      await prisma.meetingRecording.update({
        where: { meetingId },
        data: {
          transcript: transcription.text.trim() || '(No speech detected)',
          language: transcription.language,
          duration: Math.round(transcription.duration),
          summary: 'No speech was detected in this recording. The audio appears to be silent or contain only background noise.',
          keyPoints: [],
          autoTodos: [],
          sentiment: { score: 0, label: 'neutral', employeeMood: 'N/A', reporterEngagement: 'N/A', overallTone: 'No conversation detected' },
          qualityScore: 0,
          qualityDetails: { clarity: 0, actionability: 0, engagement: 0, goalAlignment: 0, followUp: 0, overallFeedback: 'No speech was detected in the recording.' },
          status: 'COMPLETED',
          processedAt: new Date(),
        },
      })
      return
    }

    await prisma.meetingRecording.update({
      where: { meetingId },
      data: {
        transcript: transcription.text,
        language: transcription.language,
        duration: Math.round(transcription.duration),
        status: 'ANALYZING',
      },
    })

    // Step 5: Analyze with GPT
    console.log('[Recording] Starting GPT analysis...')
    const analysis = await analyzeTranscript(transcription.text, employeeName, reporterName)
    console.log(`[Recording] Analysis complete. Quality=${analysis.qualityScore}`)

    await prisma.meetingRecording.update({
      where: { meetingId },
      data: {
        summary: analysis.summary,
        keyPoints: analysis.keyPoints,
        autoTodos: analysis.suggestedTodos,
        sentiment: analysis.sentiment,
        qualityScore: analysis.qualityScore,
        qualityDetails: analysis.qualityDetails,
        status: 'COMPLETED',
        processedAt: new Date(),
      },
    })

    // Notify both parties that the recording is ready (best effort)
    try {
      const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
        select: { employeeId: true, reporterId: true },
      })
      if (meeting) await notifyRecordingReady([meeting.employeeId, meeting.reporterId], meetingId)
    } catch (notifError) {
      console.error('[Recording] Failed to create notification:', notifError)
    }

    console.log(`[Recording] Processing complete for meeting=${meetingId}`)
  } catch (error) {
    console.error('[Recording] Processing error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown processing error'
    await prisma.meetingRecording.update({ where: { meetingId }, data: { status: 'FAILED', errorMessage } })
  }
}

async function cleanupChunks(sessionKey: string, totalChunks: number) {
  for (let i = 0; i < totalChunks; i++) {
    try {
      await deleteFromS3(chunkKey(sessionKey, i))
    } catch {
      // ignore individual chunk delete failures
    }
  }
  console.log(`[Recording] Cleaned up ${totalChunks} chunks`)
}
