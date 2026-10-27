import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/keka', () => ({
  getBaseUrl: vi.fn(() => 'https://acme.keka.com/api/v1'),
  getKekaAccessToken: vi.fn(async () => 'tok'),
  isKekaConfigured: vi.fn(() => true),
}))

import { fetchKekaEmployees, findKekaEmployeeByEmail, isKekaActive, KekaUnavailableError, pickEmployee } from '@/lib/keka-employees'

const raw = (over: Record<string, unknown> = {}) => ({
  id: 'k1',
  employeeNumber: 'RIQ1',
  firstName: 'Asha',
  lastName: 'Rao',
  displayName: 'Asha Rao',
  email: 'Asha.Rao@Example.com',
  countryCode: 'IN',
  jobTitle: { identifier: 'j', title: 'Engineer' },
  reportsTo: { id: 'm', firstName: 'M', lastName: 'G', email: 'Mgr@Example.com' },
  groups: [
    { id: 'g1', title: 'Product', groupType: 2 },
    { id: 'g2', title: 'Ahmedabad', groupType: 3 },
  ],
  workPhone: '9876543210',
  mobilePhone: null,
  joiningDate: '2024-12-01T00:00:00Z',
  exitDate: null,
  employmentStatus: 0,
  // personal fields Keka returns that must never leave pickEmployee
  dateOfBirth: '1990-01-01T00:00:00Z',
  personalEmail: 'private@gmail.com',
  currentAddress: { addressLine1: 'x' },
  bloodGroup: 3,
  ...over,
})

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('pickEmployee', () => {
  it('keeps only work fields, lower-cases emails, takes the department group', () => {
    const e = pickEmployee(raw())!
    expect(e).toEqual({
      id: 'k1', email: 'asha.rao@example.com', firstName: 'Asha', lastName: 'Rao', employeeNumber: 'RIQ1', jobTitle: 'Engineer',
      department: 'Product', managerEmail: 'mgr@example.com', countryCode: 'IN', workPhone: '9876543210', mobilePhone: null,
      joiningDate: '2024-12-01', exitDate: null, employmentStatus: 0,
    })
    expect(JSON.stringify(e)).not.toMatch(/1990|private@gmail|addressLine|bloodGroup/)
  })
  it('handles empty manager and missing groups', () => {
    const e = pickEmployee(raw({ reportsTo: { id: null, email: null }, groups: undefined }))!
    expect(e.managerEmail).toBeNull()
    expect(e.department).toBeNull()
  })
})

describe('isKekaActive', () => {
  const now = new Date('2026-10-27T00:00:00Z')
  it('working with no past exit date', () => {
    expect(isKekaActive(pickEmployee(raw())!, now)).toBe(true)
    expect(isKekaActive(pickEmployee(raw({ employmentStatus: 1 }))!, now)).toBe(false)
    expect(isKekaActive(pickEmployee(raw({ exitDate: '2026-10-01T00:00:00Z' }))!, now)).toBe(false)
    expect(isKekaActive(pickEmployee(raw({ exitDate: '2026-11-30T00:00:00Z' }))!, now)).toBe(true) // serving notice
  })
})

describe('HTTP', () => {
  it('pages through the directory', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ data: [raw({ id: 'a' })], totalPages: 2 }))
      .mockResolvedValueOnce(json({ data: [raw({ id: 'b' })], totalPages: 2 }))
    const list = await fetchKekaEmployees()
    expect(list.map((e) => e.id)).toEqual(['a', 'b'])
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe('https://acme.keka.com/api/v1/hris/employees?pageNumber=2&pageSize=200')
  })

  it('looks up by work email via the search endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ data: raw() }))
    const e = await findKekaEmployeeByEmail('asha.rao@example.com')
    expect(e?.id).toBe('k1')
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://acme.keka.com/api/v1/hris/employees/search')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ workEmail: 'asha.rao@example.com' })
  })

  it('returns null when nothing or someone else matches; throws KekaUnavailableError on server errors', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ data: null }))
    expect(await findKekaEmployeeByEmail('nobody@example.com')).toBeNull()
    vi.mocked(fetch).mockResolvedValueOnce(json({ data: [raw()] }))
    expect(await findKekaEmployeeByEmail('other@example.com')).toBeNull()
    vi.mocked(fetch).mockResolvedValueOnce(json({}, 503))
    await expect(findKekaEmployeeByEmail('x@example.com')).rejects.toBeInstanceOf(KekaUnavailableError)
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNRESET'))
    await expect(fetchKekaEmployees()).rejects.toBeInstanceOf(KekaUnavailableError)
  })
})
