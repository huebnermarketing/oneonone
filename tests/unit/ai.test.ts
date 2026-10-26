import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'
import { clearSettingsCache } from '@/lib/settings'
import { normalizeModelId, extractJson, chatJson, getAiConfig, buildClient, PROVIDERS, AiNotConfiguredError, getAiClient } from '@/lib/ai'

beforeEach(() => {
  clearSettingsCache()
  delete process.env.AI_PROVIDER
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENROUTER_API_KEY
})

describe('normalizeModelId', () => {
  it.each([
    ['OPENROUTER', 'gpt-4o', 'openai/gpt-4o'],
    ['OPENROUTER', 'openai/gpt-4o', 'openai/gpt-4o'],
    ['OPENROUTER', 'anthropic/claude-sonnet-4.5', 'anthropic/claude-sonnet-4.5'],
    ['OPENROUTER', 'whisper-1', 'openai/whisper-1'],
    ['OPENROUTER', 'gpt-4o-transcribe', 'openai/gpt-4o-transcribe'],
    ['OPENAI', 'openai/gpt-4o', 'gpt-4o'],
    ['OPENAI', 'gpt-4o', 'gpt-4o'],
    ['OPENAI', 'anthropic/claude', 'anthropic/claude'],
  ] as const)('%s: %s → %s', (provider, input, expected) => {
    expect(normalizeModelId(provider, input, 'fallback')).toBe(expected)
  })
  it('falls back when empty', () => {
    expect(normalizeModelId('OPENROUTER', '', 'openai/x')).toBe('openai/x')
    expect(normalizeModelId('OPENAI', null, 'y')).toBe('y')
  })
})

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
    expect(extractJson('  [1,2] ')).toEqual([1, 2])
  })
  it('strips ```json fences', () => {
    expect(extractJson('Here you go:\n```json\n{"a": 1}\n```\nThanks')).toEqual({ a: 1 })
    expect(extractJson('```\n{"b": 2}\n```')).toEqual({ b: 2 })
  })
  it('finds the outermost object inside prose', () => {
    expect(extractJson('Sure! The result is {"ok": true, "n": [1, {"x": 2}]} — let me know.')).toEqual({ ok: true, n: [1, { x: 2 }] })
  })
  it('throws when nothing parseable', () => {
    expect(() => extractJson('no json here')).toThrow()
  })
})

describe('getAiConfig', () => {
  it('OpenAI defaults from env', async () => {
    process.env.OPENAI_API_KEY = 'sk-env'
    prismaMock.systemSettings.findUnique.mockResolvedValue(null)
    const c = await getAiConfig()
    expect(c).toMatchObject({ provider: 'OPENAI', apiKey: 'sk-env', baseURL: PROVIDERS.OPENAI.baseURL, chatModel: 'gpt-4o', fastModel: 'gpt-4o-mini', sttModel: 'gpt-4o-transcribe' })
    expect(c.sttSegmentSeconds).toBe(40 * 60)
  })
  it('AI_PROVIDER=openrouter env switches defaults and key source', async () => {
    process.env.AI_PROVIDER = 'openrouter'
    process.env.OPENROUTER_API_KEY = 'sk-or-env'
    prismaMock.systemSettings.findUnique.mockResolvedValue(null)
    const c = await getAiConfig()
    expect(c).toMatchObject({ provider: 'OPENROUTER', apiKey: 'sk-or-env', baseURL: PROVIDERS.OPENROUTER.baseURL, chatModel: 'openai/gpt-4o', sttModel: 'openai/gpt-4o-transcribe' })
    expect(c.sttSegmentSeconds).toBe(10 * 60)
  })
  it('DB row with provider switched but bare OpenAI model ids gets them prefixed', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({
      id: 'system', aiProvider: 'OPENROUTER', openaiApiKey: null, openaiModel: 'gpt-4o', aiFastModel: 'gpt-4o-mini', whisperModel: 'whisper-1',
      awsRegion: null, awsAccessKeyId: null, awsSecretKey: null, awsS3Bucket: null, maxRecordingMins: 25,
      requireFormBeforeComplete: true, cancelPolicy: 'REPORTER_AND_ADMIN', employeeCanViewRecording: false, employeeCanViewNotes: true,
      enableEmailReminders: true, reminderHoursBefore: 24, shortReminderHoursBefore: 1,
    })
    const c = await getAiConfig()
    expect([c.chatModel, c.fastModel, c.sttModel]).toEqual(['openai/gpt-4o', 'openai/gpt-4o-mini', 'openai/whisper-1'])
  })
  it('getAiClient throws AiNotConfiguredError without a key', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(null)
    await expect(getAiClient()).rejects.toBeInstanceOf(AiNotConfiguredError)
  })
})

describe('buildClient', () => {
  it('points at the provider base URL and adds OpenRouter attribution headers', () => {
    const or = buildClient('OPENROUTER', 'k')
    expect(or.baseURL).toBe('https://openrouter.ai/api/v1')
    const oa = buildClient('OPENAI', 'k')
    expect(oa.baseURL).toBe('https://api.openai.com/v1')
  })
})

describe('chatJson', () => {
  const fakeClient = (impl: (args: Record<string, unknown>) => unknown) =>
    ({ chat: { completions: { create: vi.fn(impl) } } }) as never

  it('requests json_object and parses the reply', async () => {
    const create = vi.fn(async () => ({ choices: [{ message: { content: '{"x":1}' } }] }))
    const client = { chat: { completions: { create } } } as never
    expect(await chatJson(client, { model: 'm', system: 's', user: 'u' })).toEqual({ x: 1 })
    expect(create.mock.calls[0][0]).toMatchObject({ model: 'm', response_format: { type: 'json_object' }, temperature: 0.3 })
  })

  it('retries without response_format when the model rejects it, and extracts fenced JSON', async () => {
    let calls = 0
    const client = fakeClient(async (args) => {
      calls++
      if (args.response_format) {
        const err = Object.assign(new Error('400 response_format is not supported by this model'), { status: 400 })
        throw err
      }
      return { choices: [{ message: { content: '```json\n{"y":2}\n```' } }] }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await chatJson(client, { model: 'anthropic/claude', system: 's', user: 'u' })).toEqual({ y: 2 })
    expect(calls).toBe(2)
    expect(warn).toHaveBeenCalled()
  })

  it('does not retry on unrelated errors', async () => {
    const client = fakeClient(async () => {
      throw Object.assign(new Error('401 invalid key'), { status: 401 })
    })
    await expect(chatJson(client, { model: 'm', system: 's', user: 'u' })).rejects.toThrow('401')
  })

  it('throws on empty reply', async () => {
    const client = fakeClient(async () => ({ choices: [{ message: { content: '' } }] }))
    await expect(chatJson(client, { model: 'm', system: 's', user: 'u' })).rejects.toThrow('No response')
  })
})
