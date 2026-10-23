import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHmac } from 'crypto'
import { verifyFathomWebhook } from '@/lib/fathom-webhook'

const secretBytes = Buffer.from('super-secret-webhook-key')
const secret = `whsec_${secretBytes.toString('base64')}`
const body = JSON.stringify({ id: 'rec_1', zoom_meeting_id: '123456789' })

function headersFor(id: string, ts: number, sig: string) {
  const map: Record<string, string> = { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': sig }
  return { get: (n: string) => map[n] ?? null }
}
function sign(id: string, ts: number, raw = body, key = secretBytes) {
  return createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64')
}

afterEach(() => vi.useRealTimers())

describe('verifyFathomWebhook', () => {
  const now = 1_800_000_000
  it('accepts a valid v1 signature', () => {
    vi.useFakeTimers({ now: now * 1000 })
    expect(verifyFathomWebhook(secret, headersFor('msg_1', now, `v1,${sign('msg_1', now)}`), body)).toBe(true)
  })
  it('accepts when one of several signatures matches', () => {
    vi.useFakeTimers({ now: now * 1000 })
    const sig = `v1,bogus v1,${sign('msg_1', now)}`
    expect(verifyFathomWebhook(secret, headersFor('msg_1', now, sig), body)).toBe(true)
  })
  it('accepts a raw base64 secret without the whsec_ prefix', () => {
    vi.useFakeTimers({ now: now * 1000 })
    expect(verifyFathomWebhook(secretBytes.toString('base64'), headersFor('m', now, `v1,${sign('m', now)}`), body)).toBe(true)
  })
  it('rejects a wrong secret', () => {
    vi.useFakeTimers({ now: now * 1000 })
    expect(verifyFathomWebhook('whsec_' + Buffer.from('other').toString('base64'), headersFor('m', now, `v1,${sign('m', now)}`), body)).toBe(false)
  })
  it('rejects a modified body', () => {
    vi.useFakeTimers({ now: now * 1000 })
    expect(verifyFathomWebhook(secret, headersFor('m', now, `v1,${sign('m', now)}`), body + ' ')).toBe(false)
  })
  it('rejects timestamps older than 5 minutes (replay)', () => {
    vi.useFakeTimers({ now: now * 1000 })
    const old = now - 301
    expect(verifyFathomWebhook(secret, headersFor('m', old, `v1,${sign('m', old)}`), body)).toBe(false)
  })
  it('rejects missing headers', () => {
    expect(verifyFathomWebhook(secret, { get: () => null }, body)).toBe(false)
  })
})
