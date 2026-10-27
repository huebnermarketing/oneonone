import { describe, it, expect, vi } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'

vi.mock('@/lib/keka', () => ({ isKekaConfigured: vi.fn(() => true), getBaseUrl: vi.fn(() => ''), getKekaAccessToken: vi.fn(async () => null) }))

import { kekaSyncDue, lockedFieldChanges, planKekaSync } from '@/lib/keka-sync'
import type { KekaEmployee } from '@/lib/keka-employees'
import type { ExistingUser, ImportContext } from '@/lib/user-import'

const now = new Date('2026-10-27T00:00:00Z')
const emp = (over: Partial<KekaEmployee> = {}): KekaEmployee => ({
  id: 'k-' + (over.email ?? 'asha@example.com'),
  email: 'asha@example.com', firstName: 'Asha', lastName: 'Rao', employeeNumber: 'RIQ1', jobTitle: 'Engineer', department: 'Product',
  managerEmail: null, countryCode: 'IN', workPhone: '9876543210', mobilePhone: null, joiningDate: '2024-12-01', exitDate: null,
  employmentStatus: 0, ...over,
})
const user = (id: string, email: string, extra: Partial<ExistingUser> = {}): ExistingUser => ({
  id, email, name: email.split('@')[0], role: 'EMPLOYEE', isActive: true, departmentId: null, reportsToId: null, title: null, phone: null,
  country: null, timeZone: null, workDayStart: null, workDayEnd: null, kekaEmployeeId: null, employeeNumber: null, joiningDate: null, ...extra,
})
const ctx = (users: ExistingUser[] = []): ImportContext => ({ users, departments: [{ id: 'd1', name: 'Product' }], actorEmail: '' })
const row = (p: ReturnType<typeof planKekaSync>, email: string) => p.rows.find((r) => r.email === email)!

describe('planKekaSync', () => {
  it('creates an active employee with HR fields, country defaults and Keka ids', () => {
    const plan = planKekaSync([emp()], ctx(), now)
    const r = row(plan, 'asha@example.com')
    expect(r.action).toBe('create')
    expect(r.data).toMatchObject({
      name: 'Asha Rao', title: 'Engineer', department: 'product', phone: '9876543210', country: 'IN', timeZone: 'Asia/Kolkata',
      kekaEmployeeId: 'k-asha@example.com', employeeNumber: 'RIQ1', joiningDate: '2024-12-01',
    })
    expect(r.data.isActive).toBeUndefined()
    expect(plan.syncedEmails).toEqual(['asha@example.com'])
  })

  it('treats HR placeholders and bad phones as blank, maps unknown countries to Other', () => {
    const r = row(planKekaSync([emp({ department: 'NA', workPhone: '123', mobilePhone: '+1 303 555 0100', countryCode: 'DE' })], ctx(), now), 'asha@example.com')
    expect(r.data.department).toBeUndefined()
    expect(r.data.phone).toBe('+1 303 555 0100')
    expect(r.data.country).toBe('OTHER')
  })

  it('deactivates an existing user who left, ignores leavers never in the app, never re-activates', () => {
    const users = [user('u1', 'gone@example.com'), user('u2', 'paused@example.com', { isActive: false })]
    const plan = planKekaSync(
      [emp({ email: 'gone@example.com', employmentStatus: 1 }), emp({ email: 'old@example.com', employmentStatus: 1 }), emp({ email: 'paused@example.com' })],
      ctx(users),
      now
    )
    expect(row(plan, 'gone@example.com').data.isActive).toBe(false)
    expect(row(plan, 'gone@example.com').changes).toContain('status')
    expect(plan.rows.find((r) => r.email === 'old@example.com')).toBeUndefined()
    expect(plan.leaversIgnored).toBe(1)
    expect(row(plan, 'paused@example.com').data.isActive).toBeUndefined() // admin switched them off; stays off
  })

  it('skips other domains and missing emails, and links managers in any order', () => {
    const plan = planKekaSync(
      [emp({ email: 'rep@example.com', managerEmail: 'lead@example.com' }), emp({ email: 'lead@example.com' }), emp({ email: 'x@other.com' }), emp({ email: '' })],
      ctx(),
      now
    )
    expect(plan.skipped.map((s) => s.reason)).toEqual(['Not a company email', 'No work email in Keka'])
    expect(row(plan, 'rep@example.com').data.managerEmail).toBe('lead@example.com')
    expect(row(plan, 'lead@example.com').data.role).toBe('REPORTER')
  })

  it('keeps the user when their manager is not in the app yet (warning, linked later)', () => {
    const r = row(planKekaSync([emp({ managerEmail: 'ceo@example.com' })], ctx(), now), 'asha@example.com')
    expect(r.action).toBe('create')
    expect(r.data.managerEmail).toBeUndefined()
    expect(r.warnings[0]).toMatch(/linked on a later sync/)
  })

  it('a second sync with the same data changes nothing', () => {
    const synced = user('u1', 'asha@example.com', {
      name: 'Asha Rao', title: 'Engineer', departmentId: 'd1', phone: '9876543210', country: 'IN', timeZone: 'Asia/Kolkata',
      workDayStart: '11:00', workDayEnd: '21:00', kekaEmployeeId: 'k-asha@example.com', employeeNumber: 'RIQ1', joiningDate: new Date('2024-12-01T00:00:00Z'),
    })
    expect(planKekaSync([emp()], ctx([synced]), now).summary).toEqual({ create: 0, update: 0, unchanged: 1, error: 0 })
  })
})

describe('locked fields', () => {
  const synced = { name: 'Asha Rao', title: 'Engineer', departmentId: 'd1', kekaSyncedAt: new Date() }
  it('rejects changes to Keka-owned fields of synced users only', () => {
    expect(lockedFieldChanges(synced, { name: 'Asha R', timeZone: 'UTC' })).toEqual(['name'])
    expect(lockedFieldChanges(synced, { name: 'Asha Rao', title: 'Engineer', departmentId: 'd1' })).toEqual([])
    expect(lockedFieldChanges({ ...synced, kekaSyncedAt: null }, { name: 'Anything' })).toEqual([])
  })
})

describe('kekaSyncDue', () => {
  it('only after a first confirmed sync, then every ~23h', async () => {
    vi.mocked(prismaMock.systemSettings.findUnique).mockImplementation((async () => null) as never)
    expect(await kekaSyncDue(now)).toBe(false)
    vi.mocked(prismaMock.systemSettings.findUnique).mockImplementation((async () => ({ kekaLastSyncAt: new Date(now.getTime() - 2 * 3600_000) })) as never)
    expect(await kekaSyncDue(now)).toBe(false)
    vi.mocked(prismaMock.systemSettings.findUnique).mockImplementation((async () => ({ kekaLastSyncAt: new Date(now.getTime() - 24 * 3600_000) })) as never)
    expect(await kekaSyncDue(now)).toBe(true)
  })
})
