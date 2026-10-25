import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'
import { encrypt } from '@/lib/encryption'
import { getSettings, updateSettings, clearSettingsCache, DEFAULT_POLICIES } from '@/lib/settings'

const row = (over: Record<string, unknown> = {}) => ({
  id: 'system',
  openaiApiKey: null,
  openaiModel: 'gpt-4o',
  whisperModel: 'whisper-1',
  awsRegion: null,
  awsAccessKeyId: null,
  awsSecretKey: null,
  awsS3Bucket: null,
  maxRecordingMins: 25,
  ...DEFAULT_POLICIES,
  ...over,
})

beforeEach(() => {
  clearSettingsCache()
  process.env.ENCRYPTION_SECRET = 'settings-test-secret'
  delete process.env.OPENAI_API_KEY
  delete process.env.AWS_ACCESS_KEY_ID
})

describe('getSettings', () => {
  it('returns env defaults + default policies when no row exists', async () => {
    process.env.OPENAI_API_KEY = 'env-key'
    prismaMock.systemSettings.findUnique.mockResolvedValue(null)
    const s = await getSettings()
    expect(s.openaiApiKey).toBe('env-key')
    expect(s.cancelPolicy).toBe('REPORTER_AND_ADMIN')
    expect(s.employeeCanViewNotes).toBe(true)
  })

  it('DB value wins over env, per field', async () => {
    process.env.OPENAI_API_KEY = 'env-key'
    process.env.AWS_ACCESS_KEY_ID = 'env-aws'
    prismaMock.systemSettings.findUnique.mockResolvedValue(row({ openaiApiKey: encrypt('db-key') }))
    const s = await getSettings()
    expect(s.openaiApiKey).toBe('db-key')
    expect(s.awsAccessKeyId).toBe('env-aws')
  })

  it('passes a plaintext awsAccessKeyId through (stored before the field was encrypted)', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(row({ awsAccessKeyId: 'AKIAIOSFODNN7EXAMPLE' }))
    expect((await getSettings()).awsAccessKeyId).toBe('AKIAIOSFODNN7EXAMPLE')
  })

  it('falls back to env and logs when a stored secret cannot be decrypted', async () => {
    process.env.OPENAI_API_KEY = 'env-key'
    const enc = encrypt('db-key')
    process.env.ENCRYPTION_SECRET = 'rotated-without-previous'
    prismaMock.systemSettings.findUnique.mockResolvedValue(row({ openaiApiKey: enc }))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await getSettings()).openaiApiKey).toBe('env-key')
    expect(err).toHaveBeenCalledWith(expect.stringContaining('Cannot decrypt openaiApiKey'), expect.anything())
  })

  it('caches the result (including the no-row defaults)', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(null)
    await getSettings()
    await getSettings()
    expect(prismaMock.systemSettings.findUnique).toHaveBeenCalledTimes(1)
  })
})

describe('updateSettings', () => {
  it('encrypts all three secret fields, stores others as-is, clears the cache', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(null)
    await getSettings() // warm cache
    prismaMock.systemSettings.upsert.mockResolvedValue(row())
    prismaMock.systemSettings.findUnique.mockResolvedValue(row({ maxRecordingMins: 40 }))

    const s = await updateSettings({ openaiApiKey: 'k1', awsAccessKeyId: 'AKIA', awsSecretKey: 's', maxRecordingMins: 40, cancelPolicy: 'ADMIN_ONLY' })

    const data = prismaMock.systemSettings.upsert.mock.calls[0][0].update
    expect(data.openaiApiKey).toMatch(/^v2:/)
    expect(data.awsAccessKeyId).toMatch(/^v2:/)
    expect(data.awsSecretKey).toMatch(/^v2:/)
    expect(data.maxRecordingMins).toBe(40)
    expect(data.cancelPolicy).toBe('ADMIN_ONLY')
    expect(s.maxRecordingMins).toBe(40) // re-read, not cached
  })

  it('null clears a secret; undefined leaves it untouched', async () => {
    prismaMock.systemSettings.upsert.mockResolvedValue(row())
    prismaMock.systemSettings.findUnique.mockResolvedValue(row())
    await updateSettings({ openaiApiKey: null, awsSecretKey: undefined })
    const data = prismaMock.systemSettings.upsert.mock.calls[0][0].update
    expect(data).toEqual({ openaiApiKey: null })
  })
})
