/**
 * Transcription + analysis on top of the provider-aware client in lib/ai.ts.
 * The file keeps its historical name; it is not OpenAI-specific any more.
 */
import OpenAI from 'openai'
import { getAiClient, chatJson, type AiConfig } from './ai'
import {
  TranscriptionContext,
  buildTranscriptionPrompt,
  collapseRepetitions,
  detectLanguageByScript,
  isGpt4oTranscribe,
  modelSegmentCap,
  preferredResponseFormat,
} from './transcription-quality'

async function getOpenAIClient(): Promise<OpenAI> {
  return (await getAiClient()).client
}

async function getModels(): Promise<{ gptModel: string; fastModel: string; whisperModel: string; sttSegmentSeconds: number }> {
  const { config } = await getAiClient()
  return {
    gptModel: config.chatModel,
    fastModel: config.fastModel,
    whisperModel: config.sttModel,
    sttSegmentSeconds: config.sttSegmentSeconds,
  }
}

export type { AiConfig }

export interface TranscriptionResult {
  text: string
  language: string
  duration: number
}

export interface AnalysisResult {
  summary: string
  keyPoints: string[]
  suggestedTodos: Array<{
    title: string
    description: string
    assignTo: 'employee' | 'reporter'
    priority: 'HIGH' | 'MEDIUM' | 'LOW'
  }>
  sentiment: {
    score: number // -1 to 1
    label: 'positive' | 'neutral' | 'negative'
    employeeMood: string
    reporterEngagement: string
    overallTone: string
  }
  qualityScore: number // 1-100
  qualityDetails: {
    clarity: number // 1-10
    actionability: number // 1-10
    engagement: number // 1-10
    goalAlignment: number // 1-10
    followUp: number // 1-10
    overallFeedback: string
  }
  commonThemes: string[]
}

const WHISPER_MAX_SIZE = 24 * 1024 * 1024 // 24 MB (Whisper limit is 25 MB, leave buffer)
// Default ~40 min at 48 kbps mono keeps each segment under 25 MB; OpenRouter needs shorter segments (60 s upstream timeout)
const DEFAULT_SEGMENT_SECONDS = 40 * 60

const WHISPER_SUPPORTED_LANGUAGES = [
  'af','ar','hy','az','be','bs','bg','ca','zh','hr','cs','da','nl','en','et',
  'fi','fr','gl','de','el','he','hi','hu','is','id','it','ja','kk','ko','lv',
  'lt','mk','ms','mr','mi','ne','no','fa','pl','pt','ro','ru','sr','sk','sl',
  'es','sw','sv','tl','ta','th','tr','uk','ur','vi','cy',
]

/** Resolve ffmpeg: bundled ffmpeg-static first (reliable in production), then system PATH. */
async function resolveFfmpegPath(): Promise<string | null> {
  const fs = await import('fs')

  try {
    const staticPath = require('ffmpeg-static') as string | null
    if (staticPath && fs.existsSync(staticPath)) {
      return staticPath
    }
  } catch {
    // ffmpeg-static not installed
  }

  try {
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const { stdout } = await promisify(execFile)('which', ['ffmpeg'])
    const systemPath = stdout.toString().trim()
    if (systemPath && fs.existsSync(systemPath)) {
      return systemPath
    }
  } catch {
    // system ffmpeg not found
  }

  return null
}

export async function runFfmpeg(args: string[], timeoutMs = 180_000): Promise<void> {
  const ffmpegPath = await resolveFfmpegPath()
  if (!ffmpegPath) {
    throw new Error('ffmpeg not available')
  }

  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  await promisify(execFile)(ffmpegPath, args, { timeout: timeoutMs })
}

/** Audio duration in seconds via ffmpeg (parses the "Duration:" line); 0 if unavailable. */
async function probeDurationSeconds(inputPath: string): Promise<number> {
  const ffmpegPath = await resolveFfmpegPath()
  if (!ffmpegPath) return 0
  const { execFile } = await import('child_process')
  return new Promise((resolve) => {
    execFile(ffmpegPath, ['-i', inputPath, '-f', 'null', '-'], { timeout: 60_000 }, (_err, _stdout, stderr) => {
      const m = String(stderr).match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0)
    })
  })
}

/**
 * Compress audio to MP3 via ffmpeg (mono, 16 kHz) for Whisper.
 * Returns the path to the compressed file, or null if compression is unavailable.
 */
async function compressAudioForWhisper(
  inputPath: string,
  bitrate = '48k'
): Promise<string | null> {
  const fs = await import('fs')
  const outputPath = inputPath.replace(/\.\w+$/, '') + `_compressed_${bitrate}.mp3`

  try {
    await runFfmpeg([
      '-i', inputPath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-b:a', bitrate,
      '-f', 'mp3',
      '-y',
      outputPath,
    ])

    const stats = await fs.promises.stat(outputPath)
    console.log(
      `[OpenAI] Compressed audio: ${inputPath} → ${outputPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB, ${bitrate})`
    )
    return outputPath
  } catch (err) {
    console.error('[OpenAI] ffmpeg compression failed:', err)
    try { await fs.promises.unlink(outputPath) } catch { /* ignore */ }
    return null
  }
}

/** Split a large MP3 into time-based segments for multi-part Whisper transcription. */
async function splitAudioForWhisper(inputPath: string, segmentSeconds = DEFAULT_SEGMENT_SECONDS): Promise<string[]> {
  const fs = await import('fs')
  const path = await import('path')

  const base = inputPath.replace(/\.\w+$/, '')
  const outputPattern = `${base}_seg_%03d.mp3`

  await runFfmpeg([
    '-i', inputPath,
    '-f', 'segment',
    '-segment_time', String(segmentSeconds),
    '-segment_format', 'mp3',
    '-reset_timestamps', '1',
    '-ac', '1',
    '-ar', '16000',
    '-b:a', '48k',
    '-y',
    outputPattern,
  ], 300_000)

  const dir = path.dirname(inputPath)
  const prefix = path.basename(base) + '_seg_'
  const segments = (await fs.promises.readdir(dir))
    .filter((name) => name.startsWith(prefix) && name.endsWith('.mp3'))
    .sort()
    .map((name) => path.join(dir, name))

  if (segments.length === 0) {
    throw new Error('Failed to split audio for transcription')
  }

  console.log(`[OpenAI] Split audio into ${segments.length} segment(s)`)
  return segments
}

async function transcribeWhisperFile(
  openai: OpenAI,
  whisperModel: string,
  filePath: string,
  uploadFilename: string,
  language?: string,
  prompt?: string
): Promise<TranscriptionResult & { detected: boolean }> {
  const fs = await import('fs')
  const fileStream = fs.createReadStream(filePath)

  const transcriptionOptions: {
    file: typeof fileStream
    model: string
    response_format: 'verbose_json' | 'json'
    language?: string
    prompt?: string
    temperature?: number
  } = {
    file: fileStream,
    model: whisperModel,
    response_format: preferredResponseFormat(whisperModel),
    temperature: 0,
  }
  if (prompt) transcriptionOptions.prompt = prompt

  // whisper-1 400s on codes outside its documented list (notably "gu" — Gujarati); gpt-4o-transcribe takes any ISO code.
  // Dropping the code here (rather than failing) keeps auto-detect as the fallback, and the prompt still steers the script.
  if (language && language !== 'auto') {
    const accepted = isGpt4oTranscribe(whisperModel) ? /^[a-z]{2}$/.test(language) : WHISPER_SUPPORTED_LANGUAGES.includes(language)
    if (accepted) transcriptionOptions.language = language
    else console.warn(`[OpenAI] ${whisperModel} does not accept language="${language}"; relying on auto-detect + prompt`)
  }

  type SttResponse = { text: string; language?: string; duration?: number; usage?: { seconds?: number } }
  let response: SttResponse
  try {
    response = (await openai.audio.transcriptions.create(transcriptionOptions)) as SttResponse
  } catch (err) {
    // Some providers behind OpenRouter (gpt-4o-transcribe, MAI) reject verbose_json with a 400 — fall back to json
    const e = err as { status?: number; message?: string }
    if (e?.status !== 400 || !/verbose_json|response_format/i.test(e.message || '')) throw err
    console.warn(`[OpenAI] ${whisperModel} rejected verbose_json; retrying with json`)
    const retryStream = fs.createReadStream(filePath)
    response = (await openai.audio.transcriptions.create({ ...transcriptionOptions, file: retryStream, response_format: 'json' })) as SttResponse
  }
  // OpenRouter's plain json shape carries duration under usage.seconds
  if (response.duration === undefined && response.usage?.seconds !== undefined) response.duration = response.usage.seconds

  console.log(
    `[OpenAI] Segment transcribed (${uploadFilename}): text length ${response.text?.length || 0}`
  )

  const reported = normalizeLanguage(response.language)
  return {
    text: response.text,
    language: reported || language || '',
    detected: !!reported,
    duration: response.duration || 0,
  }
}

/** Ask the fast model for an ISO-639-1 code when the script heuristic cannot decide. Never throws. */
async function classifyLanguage(openai: OpenAI, fastModel: string, text: string): Promise<string | undefined> {
  const sample = text.slice(0, 1500)
  if (!sample.trim()) return undefined
  try {
    const r = await chatJson<{ language?: string }>(openai, {
      model: fastModel,
      system: 'You identify the dominant spoken language of a meeting transcript. Reply with JSON {"language": "<ISO 639-1 code>"} only.',
      user: sample,
      temperature: 0,
      maxTokens: 20,
    })
    const code = normalizeLanguage(r.language)
    return code && code.length === 2 ? code : undefined
  } catch (err) {
    console.warn('[OpenAI] Language classification failed:', err instanceof Error ? err.message : err)
    return undefined
  }
}

const LANGUAGE_NAMES: Record<string, string> = {
  english: 'en', hindi: 'hi', gujarati: 'gu', marathi: 'mr', tamil: 'ta', telugu: 'te', kannada: 'kn', malayalam: 'ml',
  bengali: 'bn', punjabi: 'pa', urdu: 'ur', spanish: 'es', french: 'fr', german: 'de', portuguese: 'pt', italian: 'it',
  dutch: 'nl', russian: 'ru', japanese: 'ja', chinese: 'zh', korean: 'ko', arabic: 'ar', turkish: 'tr', indonesian: 'id',
}

/** OpenAI returns ISO-639-1 codes; some providers behind OpenRouter return full names ("english"). Store codes. */
export function normalizeLanguage(value: string | undefined | null): string | undefined {
  if (!value) return undefined
  const v = value.trim().toLowerCase()
  if (v.length <= 3) return v
  return LANGUAGE_NAMES[v] || v
}

/** Prepare a Whisper-ready MP3 from any input; compresses and retries at lower bitrates. */
async function prepareAudioForWhisper(
  inputPath: string,
  tempFiles: string[]
): Promise<string> {
  const fs = await import('fs')

  for (const bitrate of ['48k', '32k', '24k'] as const) {
    const compressedPath = await compressAudioForWhisper(inputPath, bitrate)
    if (!compressedPath) continue

    tempFiles.push(compressedPath)
    const stats = await fs.promises.stat(compressedPath)
    if (stats.size <= WHISPER_MAX_SIZE) {
      return compressedPath
    }
    console.log(
      `[OpenAI] Compressed file still ${(stats.size / 1024 / 1024).toFixed(2)} MB at ${bitrate}, trying lower bitrate or split`
    )
  }

  // Last resort: compress at 24k and split if still too large
  const lastCompressed = tempFiles.filter((f) => f.endsWith('.mp3')).pop()
  if (!lastCompressed) {
    throw new Error(
      'Could not prepare audio for transcription. ffmpeg is required — the bundled ffmpeg-static package should provide it.'
    )
  }

  return lastCompressed
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
  language?: string,
  context?: TranscriptionContext
): Promise<TranscriptionResult> {
  const fs = await import('fs')
  const path = await import('path')
  const os = await import('os')
  const tempDir = os.tmpdir()
  const tempFiles: string[] = []

  try {
    const openai = await getOpenAIClient()
    const models = await getModels()
    const sizeMB = (audioBuffer.length / 1024 / 1024).toFixed(2)
    const ext = path.extname(filename) || '.webm'

    console.log(`[OpenAI] Starting transcription with model: ${models.whisperModel}, language: ${language || 'auto-detect'}`)
    console.log(`[OpenAI] Audio buffer size: ${sizeMB} MB`)

    const originalPath = path.join(tempDir, `recording_${Date.now()}${ext}`)
    await fs.promises.writeFile(originalPath, audioBuffer)
    tempFiles.push(originalPath)

    let whisperPath: string

    if (audioBuffer.length <= WHISPER_MAX_SIZE && ext !== '.webm') {
      // Small non-webm file — send directly
      whisperPath = originalPath
      console.log('[OpenAI] File is under 25 MB, sending directly to Whisper')
    } else {
      // Always compress browser WebM recordings (often 1–2 MB/min) and any file over 25 MB
      console.log('[OpenAI] Compressing audio for Whisper...')
      whisperPath = await prepareAudioForWhisper(originalPath, tempFiles)
    }

    const whisperStats = await fs.promises.stat(whisperPath)
    console.log(`[OpenAI] Whisper input: ${(whisperStats.size / 1024 / 1024).toFixed(2)} MB`)

    let result: TranscriptionResult

    // Per-request cap: the provider's (OpenRouter: 60 s processing timeout) or the model's (gpt-4o-transcribe: ~25 min)
    const segmentSeconds = Math.min(models.sttSegmentSeconds, modelSegmentCap(models.whisperModel) ?? Infinity)
    const needsSplit =
      whisperStats.size > WHISPER_MAX_SIZE ||
      (segmentSeconds < DEFAULT_SEGMENT_SECONDS && (await probeDurationSeconds(whisperPath)) > segmentSeconds)

    const requested = language && language !== 'auto' ? language : undefined

    if (!needsSplit) {
      const r = await transcribeWhisperFile(
        openai,
        models.whisperModel,
        whisperPath,
        path.basename(whisperPath),
        requested,
        buildTranscriptionPrompt(requested, context)
      )
      result = { text: r.text, language: r.language, duration: r.duration }
    } else {
      console.log(`[OpenAI] Splitting audio into ${segmentSeconds}s segments for transcription`)
      const segments = await splitAudioForWhisper(whisperPath, segmentSeconds)
      tempFiles.push(...segments)

      const texts: string[] = []
      let totalDuration = 0
      // Language is pinned after the first segment so later segments can't switch script mid-recording
      let pinned = requested

      for (let i = 0; i < segments.length; i++) {
        const segmentResult = await transcribeWhisperFile(
          openai,
          models.whisperModel,
          segments[i],
          `segment_${i}.mp3`,
          pinned,
          buildTranscriptionPrompt(pinned, context)
        )
        texts.push(segmentResult.text)
        totalDuration += segmentResult.duration
        if (!pinned && segmentResult.detected && segmentResult.language) {
          pinned = segmentResult.language
          console.log(`[OpenAI] Language pinned to "${pinned}" from segment ${i}`)
        }
      }

      result = { text: texts.join(' '), language: pinned || '', duration: totalDuration }
    }

    // Hallucination guard: collapse "phrase phrase phrase…" loops
    const cleaned = collapseRepetitions(result.text)
    if (cleaned.removed > 0) {
      console.warn(`[OpenAI] Removed ${cleaned.removed} words of repeated phrases from the transcript`)
      result.text = cleaned.text
    }

    // Language fallback when the model reports none (gpt-4o-transcribe): script heuristic, then the fast model
    if (!result.language) {
      result.language = detectLanguageByScript(result.text) || (await classifyLanguage(openai, models.fastModel, result.text)) || requested || 'en'
      console.log(`[OpenAI] Language inferred as "${result.language}"`)
    }

    console.log(`[OpenAI] Transcription successful. Text length: ${result.text?.length || 0}`)
    return result
  } catch (error: unknown) {
    console.error('[OpenAI] Transcription error:', error)
    const err = error as { message?: string; status?: number; code?: string; type?: string; error?: { message?: string } }
    console.error('[OpenAI] Error details:', JSON.stringify({
      message: err.message,
      status: err.status,
      code: err.code,
      type: err.type,
    }))

    if (err.message?.includes('API key')) {
      throw new Error('AI provider API key is invalid or not configured. Please check Admin > Settings.')
    }
    if (err.status === 401) {
      throw new Error('AI provider authentication failed. Please verify your API key in Admin > Settings.')
    }
    if (err.status === 429) {
      throw new Error('AI provider rate limit exceeded. Please try again later.')
    }
    if (err.status === 413 || err.message?.includes('size') || err.message?.includes('large')) {
      throw new Error(
        'Recording file is too large for transcription. The server will retry with compression and splitting — if this persists, ensure ffmpeg is available (bundled via ffmpeg-static or system install).'
      )
    }
    if (err.status === 400) {
      const details = err.message || err.error?.message || 'Unknown error'
      throw new Error(`Invalid audio file: ${details}`)
    }

    throw error
  } finally {
    // Clean up all temp files
    for (const f of tempFiles) {
      try { await fs.promises.unlink(f) } catch { /* ignore */ }
    }
  }
}

export async function analyzeTranscript(
  transcript: string,
  employeeName: string,
  reporterName: string
): Promise<AnalysisResult> {
  const systemPrompt = `You are an expert at analyzing one-on-one meeting transcripts. 
Your task is to extract insights, action items, and assess meeting quality.
The transcript may be in English, Hindi, or Gujarati. Provide analysis in English.

Employee: ${employeeName}
Reporter/Manager: ${reporterName}

CRITICAL RULES:
- ONLY analyze what is actually said in the transcript. NEVER fabricate, invent, or assume content that is not explicitly present.
- If the transcript is empty, contains only silence markers, or has no meaningful conversation, return a quality score of 0 and a summary stating "No meaningful conversation detected."
- If the transcript is very short or unclear, base your analysis strictly on what was actually said. Do not fill in gaps with imagined content.

Analyze the transcript and provide:
1. A concise summary (2-3 sentences)
2. Key points discussed (bullet points)
3. Suggested action items/todos with assignee and priority
4. Sentiment analysis
5. Meeting quality score and detailed breakdown

Be thorough but concise. Focus on actionable insights.`

  const userPrompt = `Analyze this one-on-one meeting transcript:

---
${transcript}
---

Provide your analysis in the following JSON format:
{
  "summary": "Brief 2-3 sentence summary",
  "keyPoints": ["point 1", "point 2", ...],
  "suggestedTodos": [
    {
      "title": "Task title",
      "description": "Brief description",
      "assignTo": "employee" or "reporter",
      "priority": "HIGH", "MEDIUM", or "LOW"
    }
  ],
  "sentiment": {
    "score": number between -1 and 1,
    "label": "positive", "neutral", or "negative",
    "employeeMood": "description of employee's mood/attitude",
    "reporterEngagement": "description of reporter's engagement",
    "overallTone": "description of overall meeting tone"
  },
  "qualityScore": number between 1-100,
  "qualityDetails": {
    "clarity": number 1-10,
    "actionability": number 1-10,
    "engagement": number 1-10,
    "goalAlignment": number 1-10,
    "followUp": number 1-10,
    "overallFeedback": "brief feedback on meeting quality"
  },
  "commonThemes": ["theme1", "theme2", ...]
}

Only respond with valid JSON, no additional text.`

  const openai = await getOpenAIClient()
  const models = await getModels()
  return chatJson<AnalysisResult>(openai, { model: models.gptModel, system: systemPrompt, user: userPrompt, temperature: 0.3 })
}

export async function searchTranscripts(
  transcripts: Array<{ id: string; text: string; meetingId: string }>,
  query: string
): Promise<Array<{ id: string; meetingId: string; relevance: number; snippet: string }>> {
  const systemPrompt = `You are a search assistant. Given a search query and a list of meeting transcripts, 
find the most relevant transcripts and return their IDs with relevance scores and relevant snippets.
Transcripts may be in English, Hindi, or Gujarati. Search across all languages.`

  const userPrompt = `Search query: "${query}"

Transcripts:
${transcripts.map((t, i) => `[${i}] ID: ${t.id}, Meeting: ${t.meetingId}\n${t.text.slice(0, 500)}...`).join('\n\n')}

Return results as JSON array:
[
  {
    "index": number,
    "relevance": number 0-100,
    "snippet": "relevant excerpt from transcript"
  }
]
Only include transcripts with relevance > 30. Sort by relevance descending.`

  const openai = await getOpenAIClient()
  const models = await getModels()
  const parsed = await chatJson<{ results?: unknown[] } | unknown[]>(openai, {
    model: models.fastModel,
    system: systemPrompt,
    user: userPrompt,
    temperature: 0.1,
  })
  const results = (Array.isArray(parsed) ? parsed : parsed.results || []) as Array<{ index: number; relevance: number; snippet: string }>

  return results.map((r) => ({
    id: transcripts[r.index]?.id,
    meetingId: transcripts[r.index]?.meetingId,
    relevance: r.relevance,
    snippet: r.snippet,
  })).filter((r: { id?: string }) => r.id)
}

export async function generateOrganizationInsights(
  transcriptSummaries: Array<{
    department: string
    sentiment: { score: number; label: string } | null
    keyPoints: string[]
    commonThemes: string[]
    qualityScore: number
  }>
): Promise<{
  overallScore: number
  topIssues: string[]
  topStrengths: string[]
  departmentScores: Record<string, number>
  recommendations: string[]
  trendAnalysis: string
}> {
  const systemPrompt = `You are an organizational analyst. Analyze aggregated one-on-one meeting data 
to provide organization-wide insights, identify common issues, and make recommendations.`

  const userPrompt = `Analyze these aggregated meeting summaries from across the organization:

${JSON.stringify(transcriptSummaries, null, 2)}

Provide organization-wide insights in JSON format:
{
  "overallScore": number 1-100,
  "topIssues": ["issue1", "issue2", ...] (max 5),
  "topStrengths": ["strength1", "strength2", ...] (max 5),
  "departmentScores": { "dept1": score, "dept2": score, ... },
  "recommendations": ["recommendation1", "recommendation2", ...] (max 5),
  "trendAnalysis": "Brief analysis of trends and patterns"
}

Only respond with valid JSON.`

  const openai = await getOpenAIClient()
  const models = await getModels()
  return chatJson(openai, { model: models.gptModel, system: systemPrompt, user: userPrompt, temperature: 0.3 })
}
