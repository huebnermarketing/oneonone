import { describe, it, expect } from 'vitest'
import { encrypt, decrypt, maskApiKey } from '@/lib/encryption'

describe('encrypt / decrypt', () => {
  it('round-trips', () => {
    const secret = 'sk-live-1234567890abcdef'
    const enc = encrypt(secret)
    expect(enc).not.toContain(secret)
    expect(enc.split(':')).toHaveLength(3)
    expect(decrypt(enc)).toBe(secret)
  })

  it('uses a fresh IV each time', () => {
    expect(encrypt('x')).not.toBe(encrypt('x'))
  })

  it('rejects tampered ciphertext', () => {
    const enc = encrypt('hello')
    const [iv, tag, data] = enc.split(':')
    const flipped = data.slice(0, -2) + (data.slice(-2) === '00' ? '11' : '00')
    expect(() => decrypt(`${iv}:${tag}:${flipped}`)).toThrow()
  })

  it('rejects malformed input', () => {
    expect(() => decrypt('not-encrypted')).toThrow('Invalid encrypted text format')
  })

  it('fails to decrypt after the secret changes (documented rotation hazard)', () => {
    const enc = encrypt('rotate-me')
    const original = process.env.NEXTAUTH_SECRET
    process.env.NEXTAUTH_SECRET = 'a-different-secret'
    try {
      expect(() => decrypt(enc)).toThrow()
    } finally {
      process.env.NEXTAUTH_SECRET = original
    }
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
