/**
 * Provider-aware AI client. One API key; a model per job.
 *
 *   OPENAI      → https://api.openai.com/v1       models: gpt-4o, gpt-4o-mini, whisper-1
 *   OPENROUTER  → https://openrouter.ai/api/v1    models: openai/gpt-4o, openai/gpt-4o-mini, openai/whisper-1, anthropic/…, google/…
 *
 * Both speak the OpenAI wire protocol (chat completions + audio/transcriptions), so the official `openai`
 * SDK is used for both with a different baseURL. Provider, key and models come from SystemSettings
 * (Admin → Settings → AI Provider) with env fallbacks (AI_PROVIDER, OPENAI_API_KEY / OPENROUTER_API_KEY).
 */
import OpenAI from 'openai'
import { AiProvider } from '@prisma/client'
import { getSettings } from './settings'
import { APP_NAME } from './constants'

export interface ProviderSpec {
  label: string
  baseURL: string
  defaults: { chat: string; fast: string; stt: string }
  /** Max audio seconds per transcription request. OpenRouter enforces a 60 s upstream processing timeout. */
  sttSegmentSeconds: number
  keyHint: string
  keyUrl: string
}

export const PROVIDERS: Record<AiProvider, ProviderSpec> = {
  OPENAI: {
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaults: { chat: 'gpt-4o', fast: 'gpt-4o-mini', stt: 'gpt-4o-transcribe' },
    sttSegmentSeconds: 40 * 60,
    keyHint: 'sk-…',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  OPENROUTER: {
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    defaults: { chat: 'openai/gpt-4o', fast: 'openai/gpt-4o-mini', stt: 'openai/gpt-4o-transcribe' },
    sttSegmentSeconds: 10 * 60,
    keyHint: 'sk-or-v1-…',
    keyUrl: 'https://openrouter.ai/keys',
  },
}

export interface AiConfig {
  provider: AiProvider
  apiKey: string | null
  baseURL: string
  chatModel: string
  fastModel: string
  sttModel: string
  sttSegmentSeconds: number
}

/**
 * OpenRouter model ids are `vendor/model`. A bare OpenAI id saved before the provider switch
 * (e.g. "gpt-4o") is mapped to "openai/gpt-4o" so nothing breaks the moment the provider changes.
 * Going the other way, "openai/gpt-4o" on OpenAI becomes "gpt-4o"; non-OpenAI vendors are left as-is
 * (they will fail at call time with a clear model-not-found error).
 */
export function normalizeModelId(provider: AiProvider, model: string | null | undefined, fallback: string): string {
  const id = (model || '').trim()
  if (!id) return fallback
  if (provider === 'OPENROUTER') return id.includes('/') ? id : `openai/${id}`
  return id.startsWith('openai/') ? id.slice('openai/'.length) : id
}

export async function getAiConfig(): Promise<AiConfig> {
  const s = await getSettings()
  const spec = PROVIDERS[s.aiProvider]
  return {
    provider: s.aiProvider,
    apiKey: s.openaiApiKey,
    baseURL: spec.baseURL,
    chatModel: normalizeModelId(s.aiProvider, s.openaiModel, spec.defaults.chat),
    fastModel: normalizeModelId(s.aiProvider, s.aiFastModel, spec.defaults.fast),
    sttModel: normalizeModelId(s.aiProvider, s.whisperModel, spec.defaults.stt),
    sttSegmentSeconds: spec.sttSegmentSeconds,
  }
}

export async function isAiConfigured(): Promise<boolean> {
  return !!(await getAiConfig()).apiKey
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super('AI provider API key not configured. Please configure it in Admin > Settings.')
    this.name = 'AiNotConfiguredError'
  }
}

export function buildClient(provider: AiProvider, apiKey: string): OpenAI {
  const spec = PROVIDERS[provider]
  return new OpenAI({
    apiKey,
    baseURL: spec.baseURL,
    // OpenRouter uses these for its dashboard attribution; harmless elsewhere.
    defaultHeaders:
      provider === 'OPENROUTER'
        ? { 'HTTP-Referer': process.env.NEXTAUTH_URL || 'http://localhost:3000', 'X-Title': APP_NAME }
        : undefined,
  })
}

export async function getAiClient(): Promise<{ client: OpenAI; config: AiConfig }> {
  const config = await getAiConfig()
  if (!config.apiKey) throw new AiNotConfiguredError()
  return { client: buildClient(config.provider, config.apiKey), config }
}

// ---------------------------------------------------------------------------
// JSON chat helper
// ---------------------------------------------------------------------------

/**
 * Pull a JSON value out of a model reply that may be wrapped in ```json fences or prose.
 * Throws if nothing parseable is found.
 */
export function extractJson<T = unknown>(content: string): T {
  const trimmed = content.trim()
  try {
    return JSON.parse(trimmed) as T
  } catch {
    /* fall through */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim()) as T
    } catch {
      /* fall through */
    }
  }
  const firstBrace = trimmed.search(/[{[]/)
  const lastBrace = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'))
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T
  }
  throw new Error('Model did not return JSON')
}

function isResponseFormatRejection(err: unknown): boolean {
  const e = err as { status?: number; message?: string }
  if (e?.status !== 400 && e?.status !== 404 && e?.status !== 422) return false
  const msg = (e.message || '').toLowerCase()
  return msg.includes('response_format') || msg.includes('json_object') || msg.includes('json mode') || msg.includes('not support')
}

export interface ChatJsonOptions {
  model: string
  system: string
  user: string
  temperature?: number
  maxTokens?: number
}

/**
 * Chat completion that must return JSON. Asks for `response_format: json_object`; if the provider/model
 * rejects that (some non-OpenAI models behind OpenRouter), retries without it and extracts JSON from the text.
 */
export async function chatJson<T>(client: OpenAI, opts: ChatJsonOptions): Promise<T> {
  const messages = [
    { role: 'system' as const, content: opts.system },
    { role: 'user' as const, content: opts.user },
  ]
  const base = { model: opts.model, messages, temperature: opts.temperature ?? 0.3, max_tokens: opts.maxTokens }

  let content: string | null | undefined
  try {
    const res = await client.chat.completions.create({ ...base, response_format: { type: 'json_object' } })
    content = res.choices[0]?.message?.content
  } catch (err) {
    if (!isResponseFormatRejection(err)) throw err
    console.warn(`[ai] ${opts.model} rejected response_format=json_object; retrying without it`)
    const res = await client.chat.completions.create(base)
    content = res.choices[0]?.message?.content
  }
  if (!content) throw new Error('No response from AI model')
  return extractJson<T>(content)
}

// ---------------------------------------------------------------------------
// Model discovery (Admin → Settings → Refresh Models)
// ---------------------------------------------------------------------------

export interface ModelOption {
  id: string
  name: string
  description: string
}

/** Curated OpenAI chat models; the raw /models list is 100+ entries incl. embeddings, TTS, etc. */
const OPENAI_CHAT_ALLOWLIST: Record<string, { name: string; description: string }> = {
  'gpt-4.1': { name: 'GPT-4.1', description: 'Latest flagship' },
  'gpt-4.1-mini': { name: 'GPT-4.1 Mini', description: 'Fast & affordable' },
  'gpt-4o': { name: 'GPT-4o', description: 'Recommended for analysis' },
  'gpt-4o-mini': { name: 'GPT-4o Mini', description: 'Fast & affordable' },
  'gpt-4-turbo': { name: 'GPT-4 Turbo', description: 'Previous generation' },
  'o1': { name: 'o1', description: 'Advanced reasoning (slow)' },
  'o3-mini': { name: 'o3-mini', description: 'Fast reasoning' },
  'o4-mini': { name: 'o4-mini', description: 'Fast reasoning' },
}
const OPENAI_STT_ALLOWLIST: Record<string, { name: string; description: string }> = {
  'whisper-1': { name: 'Whisper-1', description: 'Multilingual, 50+ languages' },
  'gpt-4o-transcribe': { name: 'GPT-4o Transcribe', description: 'Higher accuracy' },
  'gpt-4o-mini-transcribe': { name: 'GPT-4o Mini Transcribe', description: 'Fast & affordable' },
}

/** Vendors worth surfacing from OpenRouter's catalogue (hundreds of models otherwise). */
const OPENROUTER_VENDORS = ['openai', 'anthropic', 'google', 'deepseek', 'mistralai', 'meta-llama', 'x-ai']

type OpenRouterModel = {
  id: string
  name?: string
  description?: string
  supported_parameters?: string[]
  architecture?: { output_modalities?: string[]; modality?: string }
  pricing?: { prompt?: string; completion?: string; audio?: string }
}

export async function listModels(kind: 'chat' | 'transcription'): Promise<ModelOption[]> {
  const { client, config } = await getAiClient()

  if (config.provider === 'OPENAI') {
    const allow = kind === 'chat' ? OPENAI_CHAT_ALLOWLIST : OPENAI_STT_ALLOWLIST
    const page = await client.models.list()
    const ids = new Set(page.data.map((m) => m.id))
    return Object.entries(allow)
      .filter(([id]) => ids.has(id))
      .map(([id, meta]) => ({ id, ...meta }))
  }

  // OpenRouter: filter server-side by modality, then keep well-known vendors and JSON-capable chat models
  const url = new URL(`${config.baseURL}/models`)
  if (kind === 'transcription') url.searchParams.set('output_modalities', 'transcription')
  else url.searchParams.set('supported_parameters', 'response_format')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${config.apiKey}` } })
  if (!res.ok) throw new Error(`OpenRouter models request failed (${res.status})`)
  const body = (await res.json()) as { data?: OpenRouterModel[] }
  const models = (body.data || []).filter((m) => OPENROUTER_VENDORS.some((v) => m.id.startsWith(`${v}/`)))

  const perMillion = (v?: string) => (v ? `$${(parseFloat(v) * 1_000_000).toFixed(2)}/M` : null)
  return models
    .map((m) => {
      const price =
        kind === 'chat'
          ? [perMillion(m.pricing?.prompt), perMillion(m.pricing?.completion)].filter(Boolean).join(' in / ') + (m.pricing?.completion ? ' out' : '')
          : m.pricing?.audio
            ? `$${(parseFloat(m.pricing.audio) * 60).toFixed(4)}/min`
            : ''
      return { id: m.id, name: m.name || m.id, description: price || (m.description || '').slice(0, 80) }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 60)
}
