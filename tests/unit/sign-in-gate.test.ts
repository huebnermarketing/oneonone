import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'

vi.mock('@/lib/keka', () => ({ isKekaConfigured: vi.fn(() => true) }))
vi.mock('@/lib/keka-sync', () => ({
  STALE_AFTER_MS: 24 * 3600_000,
  provisionFromKeka: vi.fn(async () => 'created'),
  refreshFromKeka: vi.fn(async () => undefined),
}))

import { signInGate } from '@/lib/sign-in-gate'
import { provisionFromKeka, refreshFromKeka } from '@/lib/keka-sync'
import { isKekaConfigured } from '@/lib/keka'

const now = new Date('2026-10-27T12:00:00Z')
const existing = (v: unknown) => vi.mocked(prismaMock.user.findFirst).mockImplementation((async () => v) as never)

beforeEach(() => {
  vi.mocked(isKekaConfigured).mockImplementation(() => true)
  vi.mocked(provisionFromKeka).mockImplementation(async () => 'created')
  vi.mocked(refreshFromKeka).mockImplementation(async () => undefined)
  delete process.env.INITIAL_ADMIN_EMAILS
})

describe('signInGate', () => {
  it('lets active users in and refreshes stale Keka data in the background', async () => {
    existing({ isActive: true, kekaSyncedAt: new Date(now.getTime() - 3600_000) })
    expect(await signInGate('a@example.com', now)).toBe(true)
    expect(refreshFromKeka).not.toHaveBeenCalled()
    existing({ isActive: true, kekaSyncedAt: null })
    expect(await signInGate('A@Example.com', now)).toBe(true)
    expect(refreshFromKeka).toHaveBeenCalledWith('a@example.com')
  })

  it('blocks inactive users', async () => {
    existing({ isActive: false, kekaSyncedAt: null })
    expect(await signInGate('a@example.com', now)).toBe('/auth/signin?error=AccountInactive')
  })

  it('unknown emails: initial admins always in; otherwise provisioned from Keka or refused', async () => {
    existing(null)
    process.env.INITIAL_ADMIN_EMAILS = 'boss@example.com'
    expect(await signInGate('boss@example.com', now)).toBe(true)
    expect(provisionFromKeka).not.toHaveBeenCalled()

    expect(await signInGate('new@example.com', now)).toBe(true)
    vi.mocked(provisionFromKeka).mockImplementation(async () => 'not_found')
    expect(await signInGate('new@example.com', now)).toBe('/auth/signin?error=NotInKeka')
    vi.mocked(provisionFromKeka).mockImplementation(async () => 'relieved')
    expect(await signInGate('new@example.com', now)).toBe('/auth/signin?error=NotInKeka')
    vi.mocked(provisionFromKeka).mockImplementation(async () => 'unavailable')
    expect(await signInGate('new@example.com', now)).toBe('/auth/signin?error=KekaUnavailable')
    vi.mocked(provisionFromKeka).mockImplementation(async () => 'not_configured')
    expect(await signInGate('new@example.com', now)).toBe('/auth/signin?error=NotRegistered')
  })
})
