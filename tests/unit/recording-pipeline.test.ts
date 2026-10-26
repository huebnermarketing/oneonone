import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'

vi.mock('@/lib/s3', () => ({
  chunkKey: (p: string, i: number) => `${p}/chunk_${String(i).padStart(4, '0')}.webm`,
  finalRecordingKey: (p: string) => `${p}/final.webm`,
  downloadFromS3: vi.fn(async () => Buffer.alloc(2000, 1)),
  uploadToS3: vi.fn(async (_b: Buffer, key: string) => ({ url: `https://s3/${key}`, key })),
  deleteFromS3: vi.fn(async () => undefined),
}))
vi.mock('@/lib/openai', () => ({
  transcribeAudio: vi.fn(async () => ({ text: 'We discussed the roadmap and agreed on two action items.', language: 'en', duration: 600 })),
  analyzeTranscript: vi.fn(async () => ({
    summary: 'Roadmap discussion',
    keyPoints: ['roadmap'],
    suggestedTodos: [],
    sentiment: { score: 0.5, label: 'positive' },
    qualityScore: 80,
    qualityDetails: { clarity: 8 },
  })),
}))
vi.mock('@/lib/notifications', () => ({ notifyRecordingReady: vi.fn(async () => undefined) }))

import * as s3 from '@/lib/s3'
import * as openai from '@/lib/openai'
import { notifyRecordingReady } from '@/lib/notifications'
import {
  resolveStartStage,
  isSilentTranscript,
  isFinalKey,
  startJob,
  runJob,
  recoverStaleJobs,
  PipelineError,
  MAX_ATTEMPTS,
  STALE_AFTER_MS,
} from '@/lib/recording-pipeline'

const SESSION = 'recordings/m1/123'
const FINAL = `${SESSION}/final.webm`

function recordingRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'rec1',
    meetingId: 'm1',
    audioKey: FINAL,
    transcript: null,
    duration: null,
    meeting: { employeeId: 'e1', reporterId: 'r1', employee: { name: 'Emp' }, reporter: { name: 'Rep' } },
    ...over,
  }
}

function jobRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'job1',
    meetingId: 'm1',
    recordingId: 'rec1',
    kind: 'PROCESS',
    fromStage: 'COMBINE',
    stage: 'COMBINE',
    status: 'QUEUED',
    attempt: 1,
    totalChunks: 3,
    language: null,
    startedAt: null,
    recording: recordingRow({ audioKey: SESSION }),
    ...over,
  }
}

beforeEach(() => {
  vi.mocked(s3.downloadFromS3).mockImplementation(async () => Buffer.alloc(2000, 1))
  vi.mocked(s3.uploadToS3).mockImplementation(async (_b: Buffer, key: string) => ({ url: `https://s3/${key}`, key }))
  vi.mocked(s3.deleteFromS3).mockImplementation(async () => undefined)
  vi.mocked(openai.transcribeAudio).mockImplementation(async () => ({ text: 'We discussed the roadmap and agreed on two action items.', language: 'en', duration: 600 }))
  vi.mocked(openai.analyzeTranscript).mockImplementation(async () => ({
    summary: 'Roadmap discussion',
    keyPoints: ['roadmap'],
    suggestedTodos: [],
    sentiment: { score: 0.5, label: 'positive', employeeMood: 'ok', reporterEngagement: 'ok', overallTone: 'ok' },
    qualityScore: 80,
    qualityDetails: { clarity: 8, actionability: 8, engagement: 8, goalAlignment: 8, followUp: 8, overallFeedback: 'fine' },
  }))
  vi.mocked(notifyRecordingReady).mockImplementation(async () => undefined)
  prismaMock.recordingJob.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'job1', ...data }))
  prismaMock.meetingRecording.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'rec1', ...data }))
})

describe('helpers', () => {
  it('isFinalKey', () => {
    expect(isFinalKey(FINAL)).toBe(true)
    expect(isFinalKey(SESSION)).toBe(false)
    expect(isFinalKey(null)).toBe(false)
  })
  it.each([
    ['', 100, true],
    ['[BLANK_AUDIO]', 100, true],
    ['...', 100, true],
    ['hi', 10, true],
    ['hi', 60, false],
    ['We talked about many things today.', 10, false],
  ])('isSilentTranscript(%j, %i) → %s', (text, dur, expected) => {
    expect(isSilentTranscript(text, dur)).toBe(expected)
  })
})

describe('resolveStartStage', () => {
  const chunksOnly = { audioKey: SESSION, transcript: null }
  const finalNoTranscript = { audioKey: FINAL, transcript: null }
  const finalWithTranscript = { audioKey: FINAL, transcript: 'hello there' }

  it('fresh upload starts at COMBINE', () => {
    expect(resolveStartStage(chunksOnly, undefined, 3)).toBe('COMBINE')
  })
  it('COMBINE without chunk count is NO_AUDIO', () => {
    expect(() => resolveStartStage(chunksOnly, undefined, undefined)).toThrow(PipelineError)
    expect(() => resolveStartStage({ audioKey: null, transcript: null }, undefined, 3)).toThrow(/No uploaded audio/)
  })
  it('final file present, no transcript → TRANSCRIBE; with transcript → ANALYZE', () => {
    expect(resolveStartStage(finalNoTranscript, undefined, undefined)).toBe('TRANSCRIBE')
    expect(resolveStartStage(finalWithTranscript, undefined, undefined)).toBe('ANALYZE')
  })
  it('explicit TRANSCRIBE needs final audio', () => {
    expect(resolveStartStage(finalWithTranscript, 'TRANSCRIBE', undefined)).toBe('TRANSCRIBE')
    expect(() => resolveStartStage(chunksOnly, 'TRANSCRIBE', 3)).toThrow(/re-recorded/)
  })
  it('explicit ANALYZE needs a transcript', () => {
    expect(resolveStartStage(finalWithTranscript, 'ANALYZE', undefined)).toBe('ANALYZE')
    expect(() => resolveStartStage(finalNoTranscript, 'ANALYZE', undefined)).toThrow(/Re-transcribe/)
  })
  it('requested COMBINE on an already-combined recording degrades to TRANSCRIBE', () => {
    expect(resolveStartStage(finalNoTranscript, 'COMBINE', 3)).toBe('TRANSCRIBE')
  })
})

describe('startJob', () => {
  it('rejects when a job is already active for the recording', async () => {
    prismaMock.meetingRecording.findUnique.mockResolvedValue({ id: 'rec1', audioKey: FINAL, transcript: 'x' })
    prismaMock.recordingJob.findFirst.mockResolvedValue({ id: 'j0', stage: 'TRANSCRIBE' })
    await expect(startJob({ meetingId: 'm1', kind: 'REPROCESS' })).rejects.toMatchObject({ code: 'BUSY' })
    expect(prismaMock.recordingJob.create).not.toHaveBeenCalled()
  })
  it('NOT_FOUND without a recording row', async () => {
    prismaMock.meetingRecording.findUnique.mockResolvedValue(null)
    await expect(startJob({ meetingId: 'm1', kind: 'PROCESS', totalChunks: 2 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
  it('creates the job at the resolved stage and kicks off the run', async () => {
    prismaMock.meetingRecording.findUnique.mockResolvedValue({ id: 'rec1', audioKey: FINAL, transcript: 'hello there' })
    prismaMock.recordingJob.findFirst.mockResolvedValue(null)
    prismaMock.recordingJob.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'jobX', ...data }))
    // runJob will look the job up; make it a no-op already-DONE job so the background run exits quietly
    prismaMock.recordingJob.findUnique.mockResolvedValue({ id: 'jobX', status: 'DONE' })

    const job = await startJob({ meetingId: 'm1', kind: 'REPROCESS', triggeredById: 'u1' })
    expect(job.fromStage).toBe('ANALYZE')
    expect(prismaMock.recordingJob.create.mock.calls[0][0].data).toMatchObject({ recordingId: 'rec1', kind: 'REPROCESS', fromStage: 'ANALYZE', stage: 'ANALYZE', triggeredById: 'u1' })
    await new Promise((r) => setTimeout(r, 0))
    expect(prismaMock.recordingJob.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'jobX' } }))
  })
})

describe('runJob', () => {
  it('full PROCESS run: combine → transcribe → analyze → notify', async () => {
    prismaMock.recordingJob.findUnique.mockResolvedValue(jobRow())
    await runJob('job1')

    expect(s3.downloadFromS3).toHaveBeenCalledTimes(4) // 3 chunks + final
    expect(s3.uploadToS3).toHaveBeenCalledWith(expect.any(Buffer), FINAL, 'audio/webm')
    expect(openai.transcribeAudio).toHaveBeenCalledTimes(1)
    expect(openai.analyzeTranscript).toHaveBeenCalledWith(expect.stringContaining('roadmap'), 'Emp', 'Rep')
    expect(notifyRecordingReady).toHaveBeenCalledWith(['e1', 'r1'], 'm1')

    const recUpdates = prismaMock.meetingRecording.update.mock.calls.map((c) => c[0].data)
    expect(recUpdates.some((d) => d.audioKey === FINAL)).toBe(true)
    expect(recUpdates.some((d) => d.transcript && d.language === 'en' && d.duration === 600)).toBe(true)
    expect(recUpdates.at(-1)).toMatchObject({ status: 'COMPLETED', summary: 'Roadmap discussion', qualityScore: 80 })

    const jobUpdates = prismaMock.recordingJob.update.mock.calls.map((c) => c[0].data)
    expect(jobUpdates.map((d) => d.stage).filter(Boolean)).toEqual(['COMBINE', 'TRANSCRIBE', 'ANALYZE', 'DONE'])
    expect(jobUpdates.at(-1)).toMatchObject({ status: 'DONE' })
  })

  it('REPROCESS from ANALYZE touches neither S3 nor Whisper and does not notify', async () => {
    prismaMock.recordingJob.findUnique.mockResolvedValue(
      jobRow({ kind: 'REPROCESS', fromStage: 'ANALYZE', stage: 'ANALYZE', totalChunks: null, recording: recordingRow({ transcript: 'old transcript text' }) })
    )
    await runJob('job1')
    expect(s3.downloadFromS3).not.toHaveBeenCalled()
    expect(openai.transcribeAudio).not.toHaveBeenCalled()
    expect(openai.analyzeTranscript).toHaveBeenCalledWith('old transcript text', 'Emp', 'Rep')
    expect(notifyRecordingReady).not.toHaveBeenCalled()
    expect(prismaMock.meetingRecording.update.mock.calls.at(-1)![0].data).toMatchObject({ status: 'COMPLETED' })
  })

  it('REPROCESS from TRANSCRIBE re-downloads final.webm and skips COMBINE', async () => {
    prismaMock.recordingJob.findUnique.mockResolvedValue(
      jobRow({ kind: 'REPROCESS', fromStage: 'TRANSCRIBE', stage: 'TRANSCRIBE', totalChunks: null, language: 'hi', recording: recordingRow() })
    )
    await runJob('job1')
    expect(s3.downloadFromS3).toHaveBeenCalledTimes(1)
    expect(s3.downloadFromS3).toHaveBeenCalledWith(FINAL)
    expect(s3.uploadToS3).not.toHaveBeenCalled()
    expect(openai.transcribeAudio).toHaveBeenCalledWith(expect.any(Buffer), 'recording.webm', 'hi')
  })

  it('silent audio completes without analysis', async () => {
    vi.mocked(openai.transcribeAudio).mockImplementation(async () => ({ text: '[BLANK_AUDIO]', language: 'en', duration: 20 }))
    prismaMock.recordingJob.findUnique.mockResolvedValue(jobRow({ fromStage: 'TRANSCRIBE', stage: 'TRANSCRIBE', recording: recordingRow() }))
    await runJob('job1')
    expect(openai.analyzeTranscript).not.toHaveBeenCalled()
    const last = prismaMock.meetingRecording.update.mock.calls.at(-1)![0].data
    expect(last).toMatchObject({ status: 'COMPLETED', qualityScore: 0, transcript: '[BLANK_AUDIO]' })
    expect(prismaMock.recordingJob.update.mock.calls.at(-1)![0].data).toMatchObject({ status: 'DONE' })
  })

  it('a stage failure marks job + recording FAILED with the error', async () => {
    vi.mocked(openai.analyzeTranscript).mockImplementation(async () => {
      throw new Error('429 rate limited')
    })
    prismaMock.recordingJob.findUnique.mockResolvedValue(jobRow({ fromStage: 'ANALYZE', stage: 'ANALYZE', recording: recordingRow({ transcript: 'some words here' }) }))
    await runJob('job1')
    expect(prismaMock.recordingJob.update.mock.calls.at(-1)![0].data).toMatchObject({ status: 'FAILED', error: '429 rate limited' })
    expect(prismaMock.meetingRecording.update.mock.calls.at(-1)![0].data).toMatchObject({ status: 'FAILED', errorMessage: '429 rate limited' })
    expect(notifyRecordingReady).not.toHaveBeenCalled()
  })

  it('tiny combined audio fails COMBINE', async () => {
    vi.mocked(s3.downloadFromS3).mockImplementation(async () => Buffer.alloc(10))
    prismaMock.recordingJob.findUnique.mockResolvedValue(jobRow())
    await runJob('job1')
    expect(s3.uploadToS3).not.toHaveBeenCalled()
    expect(prismaMock.recordingJob.update.mock.calls.at(-1)![0].data).toMatchObject({ status: 'FAILED', error: expect.stringMatching(/too small/) })
  })

  it('is a no-op on a DONE job', async () => {
    prismaMock.recordingJob.findUnique.mockResolvedValue(jobRow({ status: 'DONE', stage: 'DONE' }))
    await runJob('job1')
    expect(prismaMock.recordingJob.update).not.toHaveBeenCalled()
  })
})

describe('recoverStaleJobs', () => {
  const now = new Date('2026-10-26T12:00:00Z')

  it('queries RUNNING-with-stale-heartbeat and stuck QUEUED jobs', async () => {
    await recoverStaleJobs(now)
    const where = prismaMock.recordingJob.findMany.mock.calls[0][0].where
    const cutoff = new Date(now.getTime() - STALE_AFTER_MS)
    expect(where.OR).toContainEqual({ status: 'RUNNING', heartbeatAt: { lt: cutoff } })
    expect(where.OR).toContainEqual({ status: 'QUEUED', createdAt: { lt: cutoff } })
  })

  it('resumes an interrupted job from its current stage, bumping attempt', async () => {
    prismaMock.recordingJob.findMany.mockResolvedValue([{ id: 'j1', meetingId: 'm1', attempt: 1, stage: 'TRANSCRIBE' }])
    prismaMock.recordingJob.findUnique.mockResolvedValue(
      jobRow({ id: 'j1', attempt: 2, fromStage: 'COMBINE', stage: 'TRANSCRIBE', recording: recordingRow() })
    )
    const res = await recoverStaleJobs(now)
    expect(res).toEqual({ resumed: ['j1'], failed: [] })
    expect(prismaMock.recordingJob.update.mock.calls[0][0]).toMatchObject({ where: { id: 'j1' }, data: { attempt: { increment: 1 }, status: 'QUEUED' } })
    await new Promise((r) => setTimeout(r, 0))
    expect(s3.uploadToS3).not.toHaveBeenCalled() // COMBINE skipped
    expect(openai.transcribeAudio).toHaveBeenCalledTimes(1)
  })

  it('gives up after MAX_ATTEMPTS and fails the recording', async () => {
    prismaMock.recordingJob.findMany.mockResolvedValue([{ id: 'j2', meetingId: 'm1', attempt: MAX_ATTEMPTS, stage: 'ANALYZE' }])
    const res = await recoverStaleJobs(now)
    expect(res).toEqual({ resumed: [], failed: ['j2'] })
    expect(prismaMock.meetingRecording.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { meetingId: 'm1' }, data: expect.objectContaining({ status: 'FAILED', errorMessage: expect.stringMatching(/interrupted 3 times/) }) })
    )
    expect(prismaMock.recordingJob.findUnique).not.toHaveBeenCalled()
  })
})
