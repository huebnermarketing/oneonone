import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import { encrypt, decrypt, maskApiKey, isEncrypted, isLegacyCiphertext } from '@/lib/encryption'

const env = process.env
let saved: Record<string, string | undefined>
beforeEach(() => {
  saved = { ENCRYPTION_SECRET: env.ENCRYPTION_SECRET, ENCRYPTION_SECRET_PREVIOUS: env.ENCRYPTION_SECRET_PREVIOUS, NEXTAUTH_SECRET: env.NEXTAUTH_SECRET }
  env.ENCRYPTION_SECRET = 'unit-test-encryption-secret'
  delete env.ENCRYPTION_SECRET_PREVIOUS
})
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete env[k]
    else env[k] = v
  }
})

/** Produce ciphertext in the pre-v2 format (scrypt key, no prefix) exactly as the old code did. */
function legacyEncrypt(text: string, secret: string): string {
  const key = crypto.scryptSync(secret, 'salt', 32)
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = cipher.update(text, 'utf8', 'hex') + cipher.final('hex')
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc}`
}

describe('v2 encrypt / decrypt', () => {
  it('round-trips and uses the v2 format', () => {
    const secret = 'sk-live-1234567890abcdef'
    const enc = encrypt(secret)
    expect(enc.startsWith('v2:')).toBe(true)
    expect(enc.split(':')).toHaveLength(4)
    expect(enc).not.toContain(secret)
    expect(decrypt(enc)).toBe(secret)
  })

  it('uses a fresh IV each time', () => {
    expect(encrypt('x')).not.toBe(encrypt('x'))
  })

  it('rejects tampered ciphertext', () => {
    const [v, iv, tag, data] = encrypt('hello').split(':')
    const flipped = data.slice(0, -2) + (data.slice(-2) === '00' ? '11' : '00')
    expect(() => decrypt(`${v}:${iv}:${tag}:${flipped}`)).toThrow()
  })

  it('rejects malformed input', () => {
    expect(() => decrypt('not-encrypted')).toThrow('Invalid encrypted text format')
    expect(() => decrypt('AKIAIOSFODNN7EXAMPLE')).toThrow('Invalid encrypted text format')
  })

  it('prefers ENCRYPTION_SECRET over NEXTAUTH_SECRET', () => {
    const enc = encrypt('a')
    env.ENCRYPTION_SECRET = 'different'
    expect(() => decrypt(enc)).toThrow()
    env.ENCRYPTION_SECRET = 'unit-test-encryption-secret'
    env.NEXTAUTH_SECRET = 'irrelevant-change'
    expect(decrypt(enc)).toBe('a')
  })

  it('falls back to NEXTAUTH_SECRET when ENCRYPTION_SECRET is unset', () => {
    delete env.ENCRYPTION_SECRET
    env.NEXTAUTH_SECRET = 'only-nextauth'
    expect(decrypt(encrypt('b'))).toBe('b')
  })
})

describe('key rotation', () => {
  it('decrypts values written under ENCRYPTION_SECRET_PREVIOUS', () => {
    const enc = encrypt('rotate-me')
    env.ENCRYPTION_SECRET_PREVIOUS = env.ENCRYPTION_SECRET
    env.ENCRYPTION_SECRET = 'brand-new-secret'
    expect(decrypt(enc)).toBe('rotate-me')
    // and re-encrypting now uses the new secret
    const re = encrypt('rotate-me')
    delete env.ENCRYPTION_SECRET_PREVIOUS
    expect(decrypt(re)).toBe('rotate-me')
    expect(() => decrypt(enc)).toThrow()
  })
})

describe('legacy ciphertext', () => {
  it('is recognised and decrypted with NEXTAUTH_SECRET (the old key source)', () => {
    env.NEXTAUTH_SECRET = 'old-nextauth-secret'
    const legacy = legacyEncrypt('legacy-value', 'old-nextauth-secret')
    expect(isEncrypted(legacy)).toBe(true)
    expect(isLegacyCiphertext(legacy)).toBe(true)
    expect(isLegacyCiphertext(encrypt('x'))).toBe(false)
    expect(decrypt(legacy)).toBe('legacy-value')
  })

  it('also tries ENCRYPTION_SECRET_PREVIOUS for legacy values', () => {
    env.NEXTAUTH_SECRET = 'rotated-already'
    env.ENCRYPTION_SECRET_PREVIOUS = 'old-nextauth-secret'
    expect(decrypt(legacyEncrypt('v', 'old-nextauth-secret'))).toBe('v')
  })
})

describe('isEncrypted', () => {
  it.each([
    [null, false],
    ['', false],
    ['AKIAIOSFODNN7EXAMPLE', false],
    ['sk-proj-abc:def', false],
    ['a:b:c', false],
    ['v2:zz:zz:zz', false],
  ])('%s → %s', (v, expected) => {
    expect(isEncrypted(v)).toBe(expected)
  })
  it('true for both real formats', () => {
    expect(isEncrypted(encrypt('x'))).toBe(true)
    expect(isEncrypted(legacyEncrypt('x', 's'))).toBe(true)
  })
})

describe('maskApiKey', () => {
  it.each([
    [null, ''],
    ['', ''],
    ['short', '****'],
    ['12345678', '****'],
    ['sk-abcdefghijklmnop', 'sk-a****mnop'],
  ])('%s → %s', (input, expected) => {
    expect(maskApiKey(input as never)).toBe(expected)
  })
})
