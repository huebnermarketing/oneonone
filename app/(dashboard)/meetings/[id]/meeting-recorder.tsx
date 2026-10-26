'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Mic,
  Square,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Play,
  Pause,
  RefreshCw,
  Globe,
  CloudUpload,
  Sparkles,
} from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-modal'
import { MicTroubleshooting } from './mic-troubleshooting'
import { Select } from '@/components/ui/select'
import { plural } from '@/lib/ui'

// ---------------------------------------------------------------------------
// Types & Constants
// ---------------------------------------------------------------------------

interface MeetingRecorderProps {
  meetingId: string
  hasExistingRecording: boolean
  recordingStatus?: string
  errorMessage?: string | null
  meetingStatus?: string
  maxRecordingMins?: number
  /** Combined audio file exists in S3 (reprocess can re-transcribe without re-recording) */
  hasAudio?: boolean
  /** Transcript exists (reprocess can re-run analysis only) */
  hasTranscript?: boolean
}

interface PipelineJob {
  id: string
  kind: 'PROCESS' | 'REPROCESS'
  stage: string
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'
  attempt: number
  error: string | null
}

const PROCESSING_STAGES = [
  { status: 'UPLOADING', label: 'Uploading audio to S3...', progress: 10 },
  { status: 'UPLOADED', label: 'Preparing for transcription...', progress: 25 },
  { status: 'TRANSCRIBING', label: 'Transcribing audio...', progress: 50 },
  { status: 'ANALYZING', label: 'Analyzing transcript...', progress: 80 },
  { status: 'COMPLETED', label: 'Complete!', progress: 100 },
]

const LANGUAGE_OPTIONS = [
  { code: 'auto', label: 'Auto-detect' },
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi (हिन्दी)' },
  { code: 'gu', label: 'Gujarati (ગુજરાતી) - Auto-detect' },
  { code: 'mr', label: 'Marathi (मराठी)' },
  { code: 'ta', label: 'Tamil (தமிழ்)' },
  { code: 'te', label: 'Telugu (తెలుగు)' },
  { code: 'kn', label: 'Kannada (ಕನ್ನಡ)' },
  { code: 'ml', label: 'Malayalam (മലയാളം)' },
  { code: 'bn', label: 'Bengali (বাংলা)' },
  { code: 'pa', label: 'Punjabi (ਪੰਜਾਬੀ)' },
  { code: 'ur', label: 'Urdu (اردو)' },
]

const DEFAULT_MAX_MINS = 25
const CHUNK_UPLOAD_INTERVAL = 30_000 // Upload chunks every 30 seconds

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MeetingRecorder({
  meetingId,
  hasExistingRecording,
  recordingStatus: initialStatus,
  errorMessage: initialError,
  meetingStatus,
  maxRecordingMins = DEFAULT_MAX_MINS,
  hasAudio = false,
  hasTranscript = false,
}: MeetingRecorderProps) {
  const MAX_DURATION = maxRecordingMins * 60
  const router = useRouter()

  // Recording state
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  /** Object URL for the preview player — created per blob and revoked on change/unmount */
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [selectedLanguage, setSelectedLanguage] = useState('auto')
  const [micBlocked, setMicBlocked] = useState(false)
  const [micPermGranted, setMicPermGranted] = useState(false)
  const [micRetryCount, setMicRetryCount] = useState(0)

  // Chunk upload state
  const [chunksUploaded, setChunksUploaded] = useState(0)
  const [isUploadingChunk, setIsUploadingChunk] = useState(false)
  const [chunkError, setChunkError] = useState<string | null>(null)

  // Finalize / processing state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [currentStatus, setCurrentStatus] = useState(initialStatus)
  const [currentError, setCurrentError] = useState(initialError)
  const [didStartUpload, setDidStartUpload] = useState(false)

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const chunkUploadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [job, setJob] = useState<PipelineJob | null>(null)
  const [isReprocessing, setIsReprocessing] = useState(false)
  const { toastError, toastSuccess } = useToast()
  const confirm = useConfirm()

  // Chunk tracking refs (avoid stale closures)
  const sessionKeyRef = useRef<string | null>(null)
  const chunkSequenceRef = useRef(0)
  const lastUploadedIndexRef = useRef(0)
  const isUploadingChunkRef = useRef(false)
  /** Latest stopRecording — lets the auto-stop effect run without depending on the function identity */
  const stopRecordingRef = useRef<() => void>(() => {})

  // --- helpers ---
  const fmt = (s: number) =>
    `${Math.floor(s / 60)
      .toString()
      .padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`

  const getProgress = useCallback(
    () =>
      PROCESSING_STAGES.find((s) => s.status === currentStatus) ?? {
        status: currentStatus,
        label: 'Processing...',
        progress: 0,
      },
    [currentStatus]
  )

  // --- polling for processing status ---
  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/meetings/${meetingId}/recording`)
      if (!res.ok) return
      const data = await res.json()
      const rec = data.recording
      if (!rec) return
      setCurrentStatus(rec.status)
      setCurrentError(rec.errorMessage)
      setJob(data.job ?? null)
      if (rec.status === 'COMPLETED' || rec.status === 'FAILED') {
        if (pollingRef.current) {
          clearInterval(pollingRef.current)
          pollingRef.current = null
        }
        if (rec.status === 'COMPLETED') router.refresh()
      }
    } catch {
      // ignore
    }
  }, [meetingId, router])

  useEffect(() => {
    const shouldPoll = ['UPLOADING', 'UPLOADED', 'TRANSCRIBING', 'ANALYZING'].includes(
      currentStatus ?? ''
    )
    if (shouldPoll && !pollingRef.current) {
      pollingRef.current = setInterval(pollStatus, 3000)
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [currentStatus, pollStatus])

  // Preview URL lifecycle: one object URL per blob, revoked when the blob changes or we unmount
  useEffect(() => {
    if (!audioBlob) {
      setAudioUrl(null)
      return
    }
    const url = URL.createObjectURL(audioBlob)
    setAudioUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [audioBlob])

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (pollingRef.current) clearInterval(pollingRef.current)
      if (chunkUploadIntervalRef.current) clearInterval(chunkUploadIntervalRef.current)
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // Watch for permission changes when mic is blocked (event + polling fallback)
  useEffect(() => {
    if (!micBlocked) return
    let permStatus: PermissionStatus | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null

    const checkGranted = () => {
      if (permStatus?.state === 'granted') {
        setMicPermGranted(true)
        if (pollTimer) clearInterval(pollTimer)
      }
    }

    navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((status) => {
        permStatus = status
        checkGranted()
        status.addEventListener('change', checkGranted)
        pollTimer = setInterval(checkGranted, 2000)
      })
      .catch(() => { /* not supported */ })

    return () => {
      permStatus?.removeEventListener('change', checkGranted)
      if (pollTimer) clearInterval(pollTimer)
    }
  }, [micBlocked])

  // auto-stop at max duration
  useEffect(() => {
    if (recordingTime >= MAX_DURATION && isRecording) stopRecordingRef.current()
  }, [recordingTime, isRecording, MAX_DURATION])

  // --- chunk upload logic ---
  const uploadPendingChunks = useCallback(async (): Promise<boolean> => {
    if (isUploadingChunkRef.current) return false
    if (!sessionKeyRef.current) return false

    // Snapshot the current length BEFORE any async work so new chunks
    // that arrive during the upload are not accidentally marked as sent.
    const snapshotEnd = chunksRef.current.length
    const startIdx = lastUploadedIndexRef.current
    if (snapshotEnd <= startIdx) return true // nothing to upload

    const newChunks = chunksRef.current.slice(startIdx, snapshotEnd)

    isUploadingChunkRef.current = true
    setIsUploadingChunk(true)
    setChunkError(null)

    try {
      const blob = new Blob(newChunks, { type: 'audio/webm' })
      const form = new FormData()
      form.append('file', blob, `chunk_${chunkSequenceRef.current}.webm`)
      form.append('sequence', chunkSequenceRef.current.toString())

      const res = await fetch(`/api/meetings/${meetingId}/recording/upload`, {
        method: 'POST',
        body: form,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || body.error || `Chunk upload failed (${res.status})`)
      }

      lastUploadedIndexRef.current = snapshotEnd // use snapshot, not live length
      chunkSequenceRef.current++
      setChunksUploaded((n) => n + 1)
      return true
    } catch (err) {
      setChunkError(err instanceof Error ? err.message : 'Chunk upload failed')
      return false
    } finally {
      isUploadingChunkRef.current = false
      setIsUploadingChunk(false)
    }
  }, [meetingId])

  // --- recording controls ---
  const startRecording = async () => {
    try {
      setSubmitError(null)
      setChunkError(null)

      // 1. Check secure context (HTTPS required for microphone in most browsers)
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        throw new Error(
          'Microphone access requires HTTPS. Please access this site via https:// instead of http://.'
        )
      }

      // 2. Check if getUserMedia is available
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'Your browser does not support audio recording. Please use a modern browser like Chrome, Safari, or Firefox.'
        )
      }

      // 3. Request microphone (also handles permission prompt)
      setMicBlocked(false)
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 },
        })
      } catch (micErr: any) {
        console.error('[Recording] Microphone error:', micErr.name, micErr.message)
        if (micErr.name === 'NotAllowedError' || micErr.name === 'PermissionDeniedError') {
          setMicRetryCount((n) => n + 1)
          setMicBlocked(true)
          return
        }
        if (micErr.name === 'NotFoundError' || micErr.name === 'DevicesNotFoundError') {
          throw new Error(
            'No microphone found. Please connect a microphone and try again.'
          )
        }
        if (micErr.name === 'NotReadableError' || micErr.name === 'TrackStartError') {
          throw new Error(
            'Microphone is in use by another application. Close other apps using the mic and try again.'
          )
        }
        throw new Error(micErr.message || 'Could not access microphone. Please check your browser settings.')
      }
      streamRef.current = stream

      // 2. Start server session (creates DB record, returns S3 prefix)
      const sessionRes = await fetch(`/api/meetings/${meetingId}/recording/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: 'audio/webm' }),
      })
      if (!sessionRes.ok) {
        const body = await sessionRes.json().catch(() => ({}))
        stream.getTracks().forEach((t) => t.stop())
        throw new Error(body.detail || body.error || 'Failed to start recording session')
      }
      const { sessionKey } = await sessionRes.json()
      sessionKeyRef.current = sessionKey
      chunkSequenceRef.current = 0
      lastUploadedIndexRef.current = 0
      setChunksUploaded(0)

      // 3. Start MediaRecorder
      chunksRef.current = []
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        setAudioBlob(new Blob(chunksRef.current, { type: 'audio/webm' }))
      }
      mediaRecorderRef.current = recorder
      recorder.start(5000) // fire ondataavailable every 5 seconds

      setIsRecording(true)
      setRecordingTime(0)
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000)

      // 4. Start periodic chunk upload (every 30 s)
      chunkUploadIntervalRef.current = setInterval(() => {
        uploadPendingChunks()
      }, CHUNK_UPLOAD_INTERVAL)
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Could not start recording. Check microphone access.'
      )
    }
  }

  const pauseRecording = () => {
    if (!mediaRecorderRef.current || !isRecording) return
    if (isPaused) {
      mediaRecorderRef.current.resume()
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000)
    } else {
      mediaRecorderRef.current.pause()
      if (timerRef.current) clearInterval(timerRef.current)
    }
    setIsPaused(!isPaused)
  }

  const stopRecording = async () => {
    if (!mediaRecorderRef.current || !isRecording) return

    // Stop recorder & mic
    mediaRecorderRef.current.stop()
    if (timerRef.current) clearInterval(timerRef.current)
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
    if (chunkUploadIntervalRef.current) clearInterval(chunkUploadIntervalRef.current)
    setIsRecording(false)
    setIsPaused(false)

    // Upload any remaining chunks
    // Small delay to let final ondataavailable fire
    await new Promise((r) => setTimeout(r, 500))
    await uploadPendingChunks()
  }
  stopRecordingRef.current = stopRecording

  const discardRecording = async () => {
    setAudioBlob(null)
    setRecordingTime(0)
    chunksRef.current = []
    sessionKeyRef.current = null
    chunkSequenceRef.current = 0
    lastUploadedIndexRef.current = 0
    setChunksUploaded(0)
    setChunkError(null)

    // Delete the session from server (cleans up S3 chunks)
    try {
      await fetch(`/api/meetings/${meetingId}/recording`, { method: 'DELETE' })
    } catch {
      // ignore
    }
  }

  // --- finalize: tell server to combine chunks + transcribe ---
  const submitRecording = async () => {
    setIsSubmitting(true)
    setSubmitError(null)
    setCurrentStatus('UPLOADING')
    setDidStartUpload(true)

    try {
      // Upload any remaining chunks first
      const ok = await uploadPendingChunks()
      if (!ok && chunkSequenceRef.current === 0) {
        throw new Error('No audio chunks were uploaded. Please try recording again.')
      }

      // Call finalize
      const res = await fetch(`/api/meetings/${meetingId}/recording/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          totalChunks: chunkSequenceRef.current,
          duration: recordingTime,
          language: selectedLanguage !== 'auto' ? selectedLanguage : undefined,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to start processing')
      }

      // Clear client state, start polling
      setAudioBlob(null)
      setRecordingTime(0)
      setCurrentStatus('TRANSCRIBING')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setSubmitError(msg)
      setCurrentStatus('FAILED')
      setCurrentError(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  // --- retry ---
  const handleRetry = async () => {
    try {
      await fetch(`/api/meetings/${meetingId}/recording`, { method: 'DELETE' })
    } catch {
      // ignore
    }
    setCurrentStatus(undefined)
    setCurrentError(null)
    setSubmitError(null)
    setDidStartUpload(false)
    sessionKeyRef.current = null
    chunkSequenceRef.current = 0
    lastUploadedIndexRef.current = 0
    setChunksUploaded(0)
    router.refresh()
  }

  /** Re-run the pipeline on the stored audio/transcript — no re-recording. */
  const handleReprocess = async (from: 'TRANSCRIBE' | 'ANALYZE') => {
    const ok = await confirm(
      from === 'TRANSCRIBE'
        ? 'Re-transcribe the stored audio and regenerate the analysis? The current transcript and analysis will be replaced.'
        : 'Regenerate the summary, key points, to-dos and quality score from the existing transcript?',
      { title: from === 'TRANSCRIBE' ? 'Re-transcribe recording' : 'Re-run analysis', confirmText: 'Reprocess' }
    )
    if (!ok) return
    setIsReprocessing(true)
    try {
      const res = await fetch(`/api/meetings/${meetingId}/recording/reprocess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Failed to start reprocessing')
      setDidStartUpload(true)
      setCurrentError(null)
      setCurrentStatus(from === 'TRANSCRIBE' ? 'TRANSCRIBING' : 'ANALYZING')
      toastSuccess(body.message || 'Reprocessing started')
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to start reprocessing')
    } finally {
      setIsReprocessing(false)
    }
  }

  const reprocessButtons = (
    <div className="flex flex-wrap items-center gap-2">
      {hasAudio && (
        <button
          onClick={() => handleReprocess('TRANSCRIBE')}
          disabled={isReprocessing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-orange hover:bg-orange/10 rounded-xl transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isReprocessing ? 'animate-spin' : ''}`} />
          Re-transcribe
        </button>
      )}
      {hasTranscript && (
        <button
          onClick={() => handleReprocess('ANALYZE')}
          disabled={isReprocessing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-orange hover:bg-orange/10 rounded-xl transition-colors disabled:opacity-50"
        >
          <Sparkles className="w-4 h-4" />
          Re-run analysis
        </button>
      )}
    </div>
  )

  // ---------------------------------------------------------------------------
  // Render: stale UPLOADING state (recording was interrupted by navigating away)
  // ---------------------------------------------------------------------------
  const isStaleUpload =
    currentStatus === 'UPLOADING' && !didStartUpload && hasExistingRecording

  if (isStaleUpload) {
    return (
      <div className="rounded-2xl bg-amber-500/5 border border-amber-500/20 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-amber-500" />
            </div>
            <div>
              <p className="font-medium text-dark-gray dark:text-white">Recording Interrupted</p>
              <p className="text-sm text-medium-gray">
                A previous recording session was not completed. Start a new recording to continue.
              </p>
            </div>
          </div>
          <button
            onClick={handleRetry}
            aria-label="Start new recording"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-orange hover:bg-orange/10 rounded-xl transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Start Over
          </button>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render: processing (active upload or server-side processing)
  // ---------------------------------------------------------------------------
  const isProcessing = ['UPLOADING', 'UPLOADED', 'TRANSCRIBING', 'ANALYZING'].includes(
    currentStatus ?? ''
  )

  if ((hasExistingRecording || didStartUpload) && isProcessing) {
    const progress = getProgress()
    return (
      <div className="rounded-2xl bg-blue-500/5 border border-blue-500/20 p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-dark-gray dark:text-white">
              {job?.kind === 'REPROCESS' ? 'Reprocessing Recording' : 'Processing Recording'}
            </p>
            <p className="text-sm text-medium-gray">
              {progress.label}
              {job && job.attempt > 1 && ` (attempt ${job.attempt})`}
            </p>
          </div>
          <p className="text-2xl font-bold text-blue-500">{progress.progress}%</p>
        </div>
        <div className="w-full h-3 bg-blue-500/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress.progress}%` }}
          />
        </div>
        <div className="flex justify-between text-xs">
          {PROCESSING_STAGES.slice(0, 4).map((stage, i) => {
            const active = currentStatus === stage.status
            const past = PROCESSING_STAGES.findIndex((s) => s.status === currentStatus) > i
            return (
              <div
                key={stage.status}
                className={`flex items-center gap-1 ${
                  active
                    ? 'text-blue-500 font-medium'
                    : past
                      ? 'text-green-500'
                      : 'text-medium-gray'
                }`}
              >
                {past ? (
                  <CheckCircle2 className="w-3 h-3" />
                ) : active ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <div className="w-3 h-3 rounded-full border border-current" />
                )}
                <span className="hidden sm:inline">
                  {stage.status === 'UPLOADING' && 'Upload'}
                  {stage.status === 'UPLOADED' && 'Prepare'}
                  {stage.status === 'TRANSCRIBING' && 'Transcribe'}
                  {stage.status === 'ANALYZING' && 'Analyze'}
                </span>
              </div>
            )
          })}
        </div>
        <p className="text-xs text-medium-gray text-center">
          This may take 1–3 minutes depending on the recording length
        </p>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render: completed
  // ---------------------------------------------------------------------------
  if ((hasExistingRecording || didStartUpload) && currentStatus === 'COMPLETED') {
    return (
      <div className="rounded-2xl bg-green-500/5 border border-green-500/20 p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6 text-green-500" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-dark-gray dark:text-white">Recording Complete</p>
            <p className="text-sm text-medium-gray">Transcript and analysis available below</p>
          </div>
          {reprocessButtons}
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render: failed
  // ---------------------------------------------------------------------------
  if ((hasExistingRecording || didStartUpload) && currentStatus === 'FAILED') {
    return (
      <div className="rounded-2xl bg-red-500/5 border border-red-500/20 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-red-500" />
            </div>
            <div>
              <p className="font-medium text-dark-gray dark:text-white">Recording Failed</p>
              <p className="text-sm text-medium-gray">
                {currentError || 'An error occurred while processing'}
              </p>
              {currentError?.includes('API key') && (
                <p className="text-xs text-red-400 mt-1">
                  Configure the AI provider API key in Admin → Settings
                </p>
              )}
              {currentError?.includes('S3') && (
                <p className="text-xs text-red-400 mt-1">
                  Configure AWS S3 in Admin → Settings → Recording Storage
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            {reprocessButtons}
            <button
              onClick={handleRetry}
              aria-label="Discard and record again"
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-medium-gray hover:bg-red-500/10 hover:text-red-500 rounded-xl transition-colors"
            >
              <Mic className="w-4 h-4" />
              {hasAudio || hasTranscript ? 'Discard & record again' : 'Try Again'}
            </button>
          </div>
        </div>
        {job?.status === 'FAILED' && job.attempt > 1 && (
          <p className="text-xs text-medium-gray mt-3">Failed after {job.attempt} attempts at stage {job.stage.toLowerCase()}.</p>
        )}
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render: default (record / preview / submit)
  // ---------------------------------------------------------------------------
  return (
    <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-dark-gray dark:text-white flex items-center gap-2">
          <Mic className="w-5 h-5" />
          Meeting Recording
        </h3>
        {!isRecording && !audioBlob && (
          <span className="text-xs text-medium-gray">Max {maxRecordingMins} minutes</span>
        )}
      </div>

      {meetingStatus === 'PROPOSED' && !isRecording && !audioBlob && !hasExistingRecording && (
        <div className="mb-4 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <p className="text-sm text-blue-600 dark:text-blue-400">
            You can start recording even before the employee accepts the meeting request.
          </p>
        </div>
      )}

      {submitError && !micBlocked && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
          <p className="text-sm text-red-600 dark:text-red-400 font-medium">{submitError}</p>
        </div>
      )}

      {/* ---- Recording in progress ---- */}
      {isRecording && (
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-6">
            <div className="text-center">
              <div
                className={`w-4 h-4 rounded-full mx-auto mb-2 ${
                  isPaused ? 'bg-yellow-500' : 'bg-red-500 animate-pulse'
                }`}
              />
              <p className="text-3xl font-mono font-bold text-dark-gray dark:text-white">
                {fmt(recordingTime)}
              </p>
              <p className="text-xs text-medium-gray mt-1">
                {fmt(MAX_DURATION - recordingTime)} remaining
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full h-2 bg-off-white dark:bg-charcoal rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-red-500 to-orange transition-all duration-1000"
              style={{ width: `${(recordingTime / MAX_DURATION) * 100}%` }}
            />
          </div>

          {/* Chunk backup indicator */}
          <div className="flex items-center justify-center gap-2 text-xs text-medium-gray">
            {isUploadingChunk ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                <span className="text-blue-500">Backing up to server...</span>
              </>
            ) : chunksUploaded > 0 ? (
              <>
                <CloudUpload className="w-3 h-3 text-green-500" />
                <span className="text-green-500">
                  {plural(chunksUploaded, 'backup')} saved to S3
                </span>
              </>
            ) : (
              <>
                <CloudUpload className="w-3 h-3" />
                <span>Audio will back up to S3 every 30s</span>
              </>
            )}
          </div>

          {chunkError && (
            <div className="text-center">
              <p className="text-xs text-yellow-600">
                Backup warning: {chunkError} (will retry)
              </p>
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={pauseRecording}
              aria-label={isPaused ? 'Resume recording' : 'Pause recording'}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-yellow-500/10 text-yellow-600 rounded-xl hover:bg-yellow-500/20 transition-colors"
            >
              {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              {isPaused ? 'Resume' : 'Pause'}
            </button>
            <button
              onClick={stopRecording}
              aria-label="Stop recording"
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors"
            >
              <Square className="w-4 h-4" />
              Stop Recording
            </button>
          </div>
        </div>
      )}

      {/* ---- Preview recorded audio ---- */}
      {!isRecording && audioBlob && (
        <div className="space-y-4">
          <div className="flex items-center justify-center">
            <div className="text-center">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-2" />
              <p className="text-lg font-medium text-dark-gray dark:text-white">
                Recording Complete
              </p>
              <p className="text-sm text-medium-gray">
                Duration: {fmt(recordingTime)} &middot;{' '}
                {(audioBlob.size / 1024 / 1024).toFixed(1)} MB
                {chunksUploaded > 0 && (
                  <span className="text-green-500">
                    {' '}
                    &middot; {plural(chunksUploaded, 'chunk')} already on S3
                  </span>
                )}
              </p>
            </div>
          </div>

          {audioUrl && <audio controls src={audioUrl} className="w-full" aria-label="Recorded audio preview" />}

          <div className="flex items-center justify-center gap-3">
            <button
              onClick={discardRecording}
              disabled={isSubmitting}
              aria-label="Discard recording"
              className="px-4 py-2 text-sm font-medium text-medium-gray hover:text-red-500 transition-colors disabled:opacity-50"
            >
              Discard
            </button>
            <button
              onClick={submitRecording}
              disabled={isSubmitting}
              aria-label="Save and transcribe recording"
              className="flex items-center gap-2 px-6 py-2 text-sm font-medium bg-orange text-white rounded-xl hover:bg-orange/90 disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Finalizing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Save &amp; Transcribe
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ---- Microphone blocked ---- */}
      {!isRecording && !audioBlob && micBlocked && (
        <MicTroubleshooting
          micPermGranted={micPermGranted}
          micRetryCount={micRetryCount}
          onRetry={() => { setMicBlocked(false); setMicPermGranted(false); startRecording() }}
        />
      )}

      {/* ---- Start recording ---- */}
      {!isRecording && !audioBlob && !micBlocked && (
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-2">
            <Globe className="w-4 h-4 text-medium-gray" />
            <Select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              aria-label="Select recording language"
              wrapperClassName="inline-block"
              className="w-auto px-3 py-2 focus:ring-orange/50"
            >
              {LANGUAGE_OPTIONS.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </Select>
          </div>
          <button
            onClick={startRecording}
            aria-label="Start recording"
            className="inline-flex items-center gap-3 px-8 py-4 text-lg font-medium bg-gradient-to-r from-red-500 to-orange text-white rounded-2xl hover:opacity-90 transition-opacity shadow-lg"
          >
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <Mic className="w-5 h-5" />
            </div>
            Start Recording
          </button>
          <p className="text-xs text-medium-gray">
            {selectedLanguage === 'auto'
              ? 'Language will be auto-detected. Select a specific language for better accuracy.'
              : `Recording will be transcribed in ${LANGUAGE_OPTIONS.find((l) => l.code === selectedLanguage)?.label}`}
          </p>
        </div>
      )}
    </div>
  )
}
