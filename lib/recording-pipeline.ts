/**
 * Recording pipeline — combine uploaded chunks → transcribe → analyze, as resumable stages.
 *
 * Every run is a `RecordingJob` row. `MeetingRecording.status` remains the user-facing status
 * (the recorder UI polls it); the job row is the audit trail, the per-recording lock, and what lets
 * a failed or interrupted run be resumed from the stage that broke instead of re-recording.
 *
 * Stages (each skipped when its output already exists, unless the job asks to start there):
 *   COMBINE    chunks in S3 → <session>/final.webm, audioKey repointed, chunks deleted
 *   TRANSCRIBE final.webm → transcript/language/duration
 *   ANALYZE    transcript → summary/keyPoints/todos/sentiment/quality, then notify
 *
 * The run itself is still in-process (single PM2 instance; no queue infra). What makes it safe:
 *   - a heartbeat per stage, so `recoverStaleJobs()` (cron) can spot a run killed by a restart
 *     and re-run it from the stage it was in, up to MAX_ATTEMPTS
 *   - `startJob()` refuses to start while another job on the same recording is QUEUED/RUNNING
 */
import { RecordingJob, RecordingStage, RecordingJobKind, RecordingStatus } from '@prisma/client'
import { prisma } from './prisma'
import { chunkKey, finalRecordingKey, downloadFromS3, uploadToS3, deleteFromS3 } from './s3'
import { transcribeAudio, analyzeTranscript } from './openai'
import { notifyRecordingReady } from './notifications'

export const MAX_ATTEMPTS = 3
/** A job whose heartbeat is older than this is considered dead (process restarted mid-run). */
export const STALE_AFTER_MS = 30 * 60 * 1000
const FINAL_SUFFIX = '/final.webm'

export class PipelineError extends Error {
  constructor(message: string, readonly code: 'BUSY' | 'NO_AUDIO' | 'NO_TRANSCRIPT' | 'NOT_FOUND') {
    super(message)
    this.name = 'PipelineError'
  }
}

export const isFinalKey = (key: string | null | undefined) => !!key && key.endsWith(FINAL_SUFFIX)

/** Whisper returns tokens like "[BLANK_AUDIO]" or bare punctuation for silence; skip GPT analysis in that case. */
export function isSilentTranscript(text: string, durationSeconds: number): boolean {
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

const SILENT_ANALYSIS = {
  summary: 'No speech was detected in this recording. The audio appears to be silent or contain only background noise.',
  keyPoints: [],
  autoTodos: [],
  sentiment: { score: 0, label: 'neutral', employeeMood: 'N/A', reporterEngagement: 'N/A', overallTone: 'No conversation detected' },
  qualityScore: 0,
  qualityDetails: { clarity: 0, actionability: 0, engagement: 0, goalAlignment: 0, followUp: 0, overallFeedback: 'No speech was detected in the recording.' },
}

/**
 * Which stage a job may start from, given what the recording already has.
 * - COMBINE needs chunks (audioKey is still the session prefix) and a chunk count
 * - TRANSCRIBE needs final.webm
 * - ANALYZE needs a transcript
 */
export function resolveStartStage(
  rec: { audioKey: string | null; transcript: string | null },
  requested: RecordingStage | undefined,
  totalChunks: number | null | undefined
): RecordingStage {
  const hasFinal = isFinalKey(rec.audioKey)
  const hasTranscript = !!rec.transcript && rec.transcript.trim().length > 0

  if (requested === 'ANALYZE') {
    if (!hasTranscript) throw new PipelineError('No transcript to analyze. Re-transcribe first.', 'NO_TRANSCRIPT')
    return 'ANALYZE'
  }
  if (requested === 'TRANSCRIBE') {
    if (!hasFinal) throw new PipelineError('No combined audio file for this recording. It must be re-recorded.', 'NO_AUDIO')
    return 'TRANSCRIBE'
  }
  if (requested === 'COMBINE' || (!requested && !hasFinal)) {
    if (hasFinal) return 'TRANSCRIBE'
    if (!rec.audioKey || !totalChunks) throw new PipelineError('No uploaded audio chunks for this recording.', 'NO_AUDIO')
    return 'COMBINE'
  }
  // Not requested, final exists: redo the cheapest stage that is missing output
  return hasTranscript ? 'ANALYZE' : 'TRANSCRIBE'
}

export interface StartJobInput {
  meetingId: string
  kind: RecordingJobKind
  /** Stage to start from. Omit to let the pipeline pick the earliest stage whose output is missing. */
  fromStage?: RecordingStage
  totalChunks?: number
  language?: string
  triggeredById?: string
}

/**
 * Create the job row and kick off the run (not awaited — the caller returns to the client at once).
 * Throws PipelineError('BUSY') when a job for this recording is already queued/running.
 */
export async function startJob(input: StartJobInput): Promise<RecordingJob> {
  const rec = await prisma.meetingRecording.findUnique({
    where: { meetingId: input.meetingId },
    select: { id: true, audioKey: true, transcript: true },
  })
  if (!rec) throw new PipelineError('No recording for this meeting.', 'NOT_FOUND')

  const active = await prisma.recordingJob.findFirst({
    where: { recordingId: rec.id, status: { in: ['QUEUED', 'RUNNING'] } },
    select: { id: true, stage: true },
  })
  if (active) throw new PipelineError(`This recording is already being processed (stage ${active.stage}).`, 'BUSY')

  const fromStage = resolveStartStage(rec, input.fromStage, input.totalChunks)

  const job = await prisma.recordingJob.create({
    data: {
      recordingId: rec.id,
      meetingId: input.meetingId,
      kind: input.kind,
      fromStage,
      stage: fromStage,
      totalChunks: input.totalChunks ?? null,
      language: input.language ?? null,
      triggeredById: input.triggeredById ?? null,
    },
  })

  runJob(job.id).catch((err) => console.error(`[Pipeline] job=${job.id} crashed outside the stage handler:`, err))
  return job
}

const stageToRecordingStatus: Record<RecordingStage, RecordingStatus> = {
  COMBINE: 'TRANSCRIBING', // UI has no "combining" step; it shows this as transcription prep
  TRANSCRIBE: 'TRANSCRIBING',
  ANALYZE: 'ANALYZING',
  DONE: 'COMPLETED',
}

async function enterStage(jobId: string, meetingId: string, stage: RecordingStage) {
  const now = new Date()
  await prisma.$transaction([
    prisma.recordingJob.update({ where: { id: jobId }, data: { stage, heartbeatAt: now } }),
    prisma.meetingRecording.update({ where: { meetingId }, data: { status: stageToRecordingStatus[stage] } }),
  ])
}

/** Execute a job from its current `stage` to DONE. Safe to call again on the same job after an interruption. */
export async function runJob(jobId: string): Promise<void> {
  const job = await prisma.recordingJob.findUnique({
    where: { id: jobId },
    include: {
      recording: {
        include: {
          meeting: {
            select: { employeeId: true, reporterId: true, employee: { select: { name: true } }, reporter: { select: { name: true } } },
          },
        },
      },
    },
  })
  if (!job) throw new Error(`RecordingJob ${jobId} not found`)
  if (job.status === 'DONE') return

  const { meetingId } = job
  const rec = job.recording
  const log = (msg: string) => console.log(`[Pipeline] job=${job.id} meeting=${meetingId} ${msg}`)

  await prisma.recordingJob.update({
    where: { id: jobId },
    data: { status: 'RUNNING', startedAt: job.startedAt ?? new Date(), heartbeatAt: new Date(), error: null },
  })

  try {
    let stage: RecordingStage = job.stage
    let audioKey = rec.audioKey
    let transcript = rec.transcript
    let durationSeconds = rec.duration ?? 0

    // ---- COMBINE ----
    if (stage === 'COMBINE') {
      await enterStage(jobId, meetingId, 'COMBINE')
      if (!audioKey || isFinalKey(audioKey)) throw new Error('COMBINE stage needs a session prefix with uploaded chunks')
      const totalChunks = job.totalChunks ?? 0
      if (totalChunks < 1) throw new Error('COMBINE stage needs totalChunks')

      log(`combining ${totalChunks} chunks under ${audioKey}`)
      const buffers: Buffer[] = []
      for (let i = 0; i < totalChunks; i++) buffers.push(await downloadFromS3(chunkKey(audioKey, i)))
      const combined = Buffer.concat(buffers)
      if (combined.length < 1000) throw new Error('Combined audio is too small or empty')

      const finalKey = finalRecordingKey(audioKey)
      await uploadToS3(combined, finalKey, 'audio/webm')
      await prisma.meetingRecording.update({ where: { meetingId }, data: { audioKey: finalKey, fileSize: combined.length } })
      log(`final file uploaded: ${finalKey} (${(combined.length / 1024 / 1024).toFixed(2)} MB)`)

      // Chunks are now redundant; failure to delete them is cosmetic
      const sessionPrefix = audioKey
      void (async () => {
        for (let i = 0; i < totalChunks; i++) await deleteFromS3(chunkKey(sessionPrefix, i)).catch(() => {})
      })()

      audioKey = finalKey
      stage = 'TRANSCRIBE'
    }

    // ---- TRANSCRIBE ----
    if (stage === 'TRANSCRIBE') {
      await enterStage(jobId, meetingId, 'TRANSCRIBE')
      if (!isFinalKey(audioKey)) throw new Error('TRANSCRIBE stage needs the combined audio file')
      log('downloading final audio')
      const audio = await downloadFromS3(audioKey!)
      log(`transcribing ${(audio.length / 1024 / 1024).toFixed(2)} MB (lang=${job.language || 'auto'})`)
      const t = await transcribeAudio(audio, 'recording.webm', job.language ?? undefined, {
        participantNames: [rec.meeting.employee.name, rec.meeting.reporter.name],
      })
      transcript = t.text
      durationSeconds = Math.round(t.duration)
      log(`transcribed: lang=${t.language} dur=${durationSeconds}s len=${t.text.length}`)

      if (isSilentTranscript(t.text, t.duration)) {
        log('no speech detected — skipping analysis')
        await prisma.meetingRecording.update({
          where: { meetingId },
          data: {
            transcript: t.text.trim() || '(No speech detected)',
            language: t.language,
            duration: durationSeconds,
            ...SILENT_ANALYSIS,
            status: 'COMPLETED',
            errorMessage: null,
            processedAt: new Date(),
          },
        })
        await finish(jobId)
        return
      }

      await prisma.meetingRecording.update({
        where: { meetingId },
        data: { transcript: t.text, language: t.language, duration: durationSeconds },
      })
      stage = 'ANALYZE'
    }

    // ---- ANALYZE ----
    if (stage === 'ANALYZE') {
      await enterStage(jobId, meetingId, 'ANALYZE')
      if (!transcript || !transcript.trim()) throw new Error('ANALYZE stage needs a transcript')
      log('analyzing transcript')
      const a = await analyzeTranscript(transcript, rec.meeting.employee.name, rec.meeting.reporter.name)
      await prisma.meetingRecording.update({
        where: { meetingId },
        data: {
          summary: a.summary,
          keyPoints: a.keyPoints,
          autoTodos: a.suggestedTodos,
          sentiment: a.sentiment,
          qualityScore: a.qualityScore,
          qualityDetails: a.qualityDetails,
          status: 'COMPLETED',
          errorMessage: null,
          processedAt: new Date(),
        },
      })
      log(`analysis complete, quality=${a.qualityScore}`)

      // Only the first successful run notifies; a reprocess is an admin action, not news to the participants
      if (job.kind === 'PROCESS') {
        await notifyRecordingReady([rec.meeting.employeeId, rec.meeting.reporterId], meetingId).catch((err) =>
          console.error('[Pipeline] notification failed:', err)
        )
      }
    }

    await finish(jobId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown processing error'
    console.error(`[Pipeline] job=${jobId} failed:`, error)
    await prisma.$transaction([
      prisma.recordingJob.update({ where: { id: jobId }, data: { status: 'FAILED', error: message, finishedAt: new Date() } }),
      prisma.meetingRecording.update({ where: { meetingId }, data: { status: 'FAILED', errorMessage: message } }),
    ])
  }
}

async function finish(jobId: string) {
  await prisma.recordingJob.update({
    where: { id: jobId },
    data: { stage: 'DONE', status: 'DONE', error: null, finishedAt: new Date(), heartbeatAt: new Date() },
  })
}

/**
 * Cron sweep: jobs that are RUNNING with a stale heartbeat, or QUEUED and never picked up, were
 * interrupted (deploy/restart/crash). Re-run them from their current stage, or fail them for good
 * once MAX_ATTEMPTS is reached. Returns what it did so the cron response can report it.
 */
export async function recoverStaleJobs(now = new Date()): Promise<{ resumed: string[]; failed: string[] }> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS)
  const stale = await prisma.recordingJob.findMany({
    where: {
      OR: [
        { status: 'RUNNING', heartbeatAt: { lt: cutoff } },
        { status: 'RUNNING', heartbeatAt: null, createdAt: { lt: cutoff } },
        { status: 'QUEUED', createdAt: { lt: cutoff } },
      ],
    },
    select: { id: true, meetingId: true, attempt: true, stage: true },
  })

  const resumed: string[] = []
  const failed: string[] = []
  for (const job of stale) {
    if (job.attempt >= MAX_ATTEMPTS) {
      const message = `Processing was interrupted ${job.attempt} times (last at stage ${job.stage}). Use Reprocess to try again.`
      await prisma.$transaction([
        prisma.recordingJob.update({ where: { id: job.id }, data: { status: 'FAILED', error: message, finishedAt: now } }),
        prisma.meetingRecording.update({ where: { meetingId: job.meetingId }, data: { status: 'FAILED', errorMessage: message } }),
      ])
      failed.push(job.id)
      continue
    }
    await prisma.recordingJob.update({
      where: { id: job.id },
      data: { attempt: { increment: 1 }, status: 'QUEUED', heartbeatAt: now, error: `Interrupted at stage ${job.stage}; resuming` },
    })
    console.log(`[Pipeline] resuming interrupted job=${job.id} (attempt ${job.attempt + 1}) from ${job.stage}`)
    runJob(job.id).catch((err) => console.error(`[Pipeline] resume of job=${job.id} crashed:`, err))
    resumed.push(job.id)
  }
  return { resumed, failed }
}

/** Latest job for a recording, shaped for API responses. */
export async function latestJob(recordingId: string) {
  return prisma.recordingJob.findFirst({
    where: { recordingId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, kind: true, fromStage: true, stage: true, status: true, attempt: true, error: true, startedAt: true, finishedAt: true, createdAt: true },
  })
}
