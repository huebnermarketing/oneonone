import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'

// tests/setup.ts mocks this module globally; here we test the real one with Google mocked out
vi.unmock('@/lib/google-calendar')
const g = vi.hoisted(() => ({ query: vi.fn(), authUser: [] as string[] }))
vi.mock('googleapis', () => ({
  google: {
    calendar: () => ({ freebusy: { query: g.query } }),
    auth: {
      OAuth2: class {
        user = ''
        setCredentials(c: { access_token: string }) {
          this.user = c.access_token
          g.authUser.push(c.access_token)
        }
        on() {}
      },
    },
  },
}))
const tokens = vi.hoisted(() => ({ connected: new Set<string>() }))
vi.mock('@/lib/oauth-tokens', () => ({
  getGoogleTokens: vi.fn(async (id: string) => (tokens.connected.has(id) ? { accessToken: `tok-${id}`, refreshToken: 'r', expiryDate: null } : null)),
  saveGoogleTokens: vi.fn(async () => undefined),
}))

import { CalendarUnavailableError, getPairBusy } from '@/lib/google-calendar'
import { busyFromFreeBusy } from '@/lib/free-slots'

const t0 = new Date('2026-11-02T04:00:00Z')
const t1 = new Date('2026-11-02T14:00:00Z')
const busy = (s: string, e: string) => ({ start: `2026-11-02T${s}:00Z`, end: `2026-11-02T${e}:00Z` })
const ms = (s: string) => new Date(`2026-11-02T${s}:00Z`).getTime()

beforeEach(() => {
  tokens.connected = new Set()
  g.authUser = []
  vi.mocked(prismaMock.user.findMany).mockImplementation((async () => [
    { id: 'rep', email: 'rep@example.com' },
    { id: 'emp', email: 'emp@example.com' },
  ]) as never)
})

describe('busyFromFreeBusy', () => {
  it('returns intervals, or null when Google reports an error / no calendar', () => {
    const cals = { primary: { busy: [busy('05:00', '06:00')] }, 'x@example.com': { errors: [{ reason: 'notFound' }] } }
    expect(busyFromFreeBusy(cals, 'primary')).toEqual([{ start: ms('05:00'), end: ms('06:00') }])
    expect(busyFromFreeBusy(cals, 'x@example.com')).toBeNull()
    expect(busyFromFreeBusy(cals, 'missing@example.com')).toBeNull()
  })
})

describe('getPairBusy', () => {
  it("reads the employee's free/busy through the reporter's calendar when only the reporter is connected", async () => {
    tokens.connected.add('rep')
    g.query.mockResolvedValueOnce({ data: { calendars: { primary: { busy: [busy('05:00', '06:00')] }, 'emp@example.com': { busy: [busy('07:00', '07:30')] } } } })
    const out = await getPairBusy('rep', 'emp', t0, t1)
    expect(g.query).toHaveBeenCalledTimes(1)
    expect(g.query.mock.calls[0][0].requestBody.items).toEqual([{ id: 'primary' }, { id: 'emp@example.com' }])
    expect(g.authUser).toEqual(['tok-rep'])
    expect(out).toEqual([{ start: ms('05:00'), end: ms('06:00') }, { start: ms('07:00'), end: ms('07:30') }])
  })

  it("uses the employee's calendar when only they are connected", async () => {
    tokens.connected.add('emp')
    g.query.mockResolvedValueOnce({ data: { calendars: { primary: { busy: [] }, 'rep@example.com': { busy: [busy('09:00', '10:00')] } } } })
    await getPairBusy('rep', 'emp', t0, t1)
    expect(g.authUser).toEqual(['tok-emp'])
    expect(g.query.mock.calls[0][0].requestBody.items[1]).toEqual({ id: 'rep@example.com' })
  })

  it("falls back to the other person's own connection when their free/busy isn't shared", async () => {
    tokens.connected.add('rep').add('emp')
    g.query
      .mockResolvedValueOnce({ data: { calendars: { primary: { busy: [] }, 'emp@example.com': { errors: [{ reason: 'notFound' }] } } } })
      .mockResolvedValueOnce({ data: { calendars: { primary: { busy: [busy('08:00', '09:00')] } } } })
    const out = await getPairBusy('rep', 'emp', t0, t1)
    expect(g.authUser).toEqual(['tok-rep', 'tok-emp'])
    expect(out).toEqual([{ start: ms('08:00'), end: ms('09:00') }])
  })

  it('throws CalendarUnavailableError when nothing can be read', async () => {
    await expect(getPairBusy('rep', 'emp', t0, t1)).rejects.toMatchObject({ reason: 'none_connected' })
    tokens.connected.add('rep')
    g.query.mockResolvedValueOnce({ data: { calendars: { primary: { busy: [] }, 'emp@example.com': { errors: [{ reason: 'notFound' }] } } } })
    const err = await getPairBusy('rep', 'emp', t0, t1).catch((e) => e)
    expect(err).toBeInstanceOf(CalendarUnavailableError)
    expect(err.reason).toBe('not_visible')
  })
})
