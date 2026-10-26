import { describe, it, expect, beforeAll } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'
import { sealToken, openToken, sealAccountTokens, saveGoogleTokens, getGoogleTokens } from '@/lib/oauth-tokens'
import { isEncrypted } from '@/lib/encryption'

beforeAll(() => {
  process.env.ENCRYPTION_SECRET ||= 'unit-test-encryption-secret-0123456789'
})

describe('seal/open', () => {
  it('encrypts, is idempotent, and round-trips', () => {
    const c = sealToken('ya29.secret')!
    expect(isEncrypted(c)).toBe(true)
    expect(c).not.toContain('ya29')
    expect(sealToken(c)).toBe(c) // never double-encrypts
    expect(openToken(c)).toBe('ya29.secret')
  })
  it('passes legacy plaintext rows and empties through', () => {
    expect(openToken('1//plain-refresh')).toBe('1//plain-refresh')
    expect(sealToken(null)).toBeNull()
    expect(openToken(undefined)).toBeNull()
  })
  it('sealAccountTokens encrypts only token fields', () => {
    const a = sealAccountTokens({ provider: 'google', access_token: 'a', refresh_token: 'r', id_token: null, expires_at: 5 })
    expect(a.provider).toBe('google')
    expect(a.expires_at).toBe(5)
    expect(isEncrypted(a.access_token)).toBe(true)
    expect(isEncrypted(a.refresh_token)).toBe(true)
    expect(a.id_token).toBeNull()
  })
})

describe('saveGoogleTokens', () => {
  it('keeps the stored refresh token when Google does not send a new one', async () => {
    await saveGoogleTokens('u1', { access_token: 'new-access', expires_at: 100 })
    const { where, data } = prismaMock.account.updateMany.mock.calls[0][0]
    expect(where).toEqual({ userId: 'u1', provider: 'google' })
    expect(Object.keys(data).sort()).toEqual(['access_token', 'expires_at'])
    expect(openToken(data.access_token)).toBe('new-access')
  })
  it('replaces refresh/id tokens when provided, encrypted', async () => {
    await saveGoogleTokens('u1', { access_token: 'a', refresh_token: 'r2', id_token: 'i2', expires_at: null })
    const { data } = prismaMock.account.updateMany.mock.calls[0][0]
    expect(openToken(data.refresh_token)).toBe('r2')
    expect(openToken(data.id_token)).toBe('i2')
  })
  it('no-op without an access token', async () => {
    await saveGoogleTokens('u1', { refresh_token: 'r' })
    expect(prismaMock.account.updateMany).not.toHaveBeenCalled()
  })
})

describe('getGoogleTokens', () => {
  it('decrypts stored tokens', async () => {
    prismaMock.account.findFirst.mockResolvedValue({ access_token: sealToken('acc'), refresh_token: sealToken('ref'), expires_at: 10 })
    expect(await getGoogleTokens('u1')).toEqual({ accessToken: 'acc', refreshToken: 'ref', expiryDate: 10_000 })
  })
  it('reads legacy plaintext rows', async () => {
    prismaMock.account.findFirst.mockResolvedValue({ access_token: 'acc', refresh_token: null, expires_at: null })
    expect(await getGoogleTokens('u1')).toEqual({ accessToken: 'acc', refreshToken: null, expiryDate: null })
  })
  it('returns null (user must sign in again) when ciphertext cannot be decrypted', async () => {
    const foreign = 'v2:' + '00'.repeat(12) + ':' + '00'.repeat(16) + ':abcd'
    prismaMock.account.findFirst.mockResolvedValue({ access_token: foreign, refresh_token: null, expires_at: null })
    const err = console.error
    console.error = () => {}
    expect(await getGoogleTokens('u1')).toBeNull()
    console.error = err
  })
  it('null when nothing is linked', async () => {
    prismaMock.account.findFirst.mockResolvedValue(null)
    expect(await getGoogleTokens('u1')).toBeNull()
  })
})

describe('redact', async () => {
  const { maskEmail, maskRecipients } = await import('@/lib/redact')
  it('masks the local part, keeps the domain', () => {
    expect(maskEmail('tarang.c@whitelabeliq.com')).toBe('t***@whitelabeliq.com')
    expect(maskEmail(null)).toBe('(none)')
    expect(maskEmail('nodomain')).toBe('***')
    expect(maskRecipients(['a@x.com', 'bob@y.org'])).toBe('2 recipients: a***@x.com, b***@y.org')
  })
})

describe('auth adapter', () => {
  it('linkAccount stores Google tokens encrypted on first sign-in', async () => {
    const { authOptions } = await import('@/lib/auth')
    prismaMock.account.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data)
    await authOptions.adapter!.linkAccount!({
      userId: 'u1', type: 'oauth', provider: 'google', providerAccountId: 'g1',
      access_token: 'ya29.first', refresh_token: '1//first', id_token: 'eyJ.first', expires_at: 1, token_type: 'Bearer', scope: 's',
    } as never)
    const data = prismaMock.account.create.mock.calls[0][0].data
    for (const f of ['access_token', 'refresh_token', 'id_token']) {
      expect(isEncrypted(data[f])).toBe(true)
      expect(openToken(data[f])).toMatch(/first$/)
    }
    expect(data.provider).toBe('google')
    expect(data.token_type).toBe('Bearer')
  })
})
