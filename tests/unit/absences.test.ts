import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'

vi.mock('@/lib/keka', () => ({
  KEKA_LEAVE_STATUS: { PENDING: 0, APPROVED: 1 },
  isKekaConfigured: vi.fn(() => true),
  fetchLeaveRequests: vi.fn(async () => []),
  holidayDatesForCountry: vi.fn(async () => new Set<string>()),
  countryTimeZone: vi.fn((c: string | null) => (c === 'IN' ? 'Asia/Kolkata' : c === 'US' ? 'America/New_York' : undefined)),
}))

import {
  absenceAt,
  absencesForMeetings,
  blockingAbsence,
  clearAbsenceCache,
  expandLeave,
  fullDayMessage,
  leaveNoteFor,
  pairAbsenceDays,
  pairSlotFilter,
  strongest,
} from '@/lib/absences'
import { absenceChips, absenceLabel } from '@/lib/absence-format'
import { fetchLeaveRequests, holidayDatesForCountry, isKekaConfigured } from '@/lib/keka'

const IST = { timeZone: 'Asia/Kolkata', workStart: '11:00', workEnd: '20:00' } // middle of the day = 15:30
const at = (iso: string) => new Date(iso)

const users = [
  { id: 'emp', kekaEmployeeId: 'k-emp', country: 'IN', timeZone: 'Asia/Kolkata', workDayStart: '11:00', workDayEnd: '20:00' },
  { id: 'rep', kekaEmployeeId: 'k-rep', country: 'US', timeZone: 'America/Denver', workDayStart: '08:00', workDayEnd: '16:00' },
]

beforeEach(() => {
  clearAbsenceCache()
  vi.mocked(isKekaConfigured).mockReturnValue(true)
  prismaMock.user.findMany.mockImplementation(async (args: { where: { id: { in: string[] } } }) => users.filter((u) => args.where.id.in.includes(u.id)))
})

describe('expandLeave', () => {
  it('one day per date, approved vs pending', () => {
    expect(expandLeave({ fromDate: '2026-12-01T00:00:00', toDate: '2026-12-03T00:00:00', status: 1 })).toEqual([
      { date: '2026-12-01', kind: 'leave' },
      { date: '2026-12-02', kind: 'leave' },
      { date: '2026-12-03', kind: 'leave' },
    ])
    expect(expandLeave({ fromDate: '2026-12-01', toDate: '2026-12-01', status: 0 })).toEqual([{ date: '2026-12-01', kind: 'pending' }])
  })

  it('half days from sessions (0 = first half, 1 = second half)', () => {
    expect(expandLeave({ fromDate: '2026-12-01', toDate: '2026-12-01', status: 1, fromSession: 0, toSession: 0 })).toEqual([{ date: '2026-12-01', kind: 'leave', half: 'FIRST' }])
    expect(expandLeave({ fromDate: '2026-12-01', toDate: '2026-12-01', status: 1, fromSession: 1, toSession: 1 })).toEqual([{ date: '2026-12-01', kind: 'leave', half: 'SECOND' }])
    expect(expandLeave({ fromDate: '2026-12-01', toDate: '2026-12-01', status: 1, fromSession: 0, toSession: 1 })).toEqual([{ date: '2026-12-01', kind: 'leave' }])
    // starts after lunch on the 1st, back after lunch on the 3rd
    expect(expandLeave({ fromDate: '2026-12-01', toDate: '2026-12-03', status: 1, fromSession: 1, toSession: 0 })).toEqual([
      { date: '2026-12-01', kind: 'leave', half: 'SECOND' },
      { date: '2026-12-02', kind: 'leave' },
      { date: '2026-12-03', kind: 'leave', half: 'FIRST' },
    ])
  })

  it('ignores malformed dates', () => {
    expect(expandLeave({ fromDate: 'nope', toDate: '', status: 1 })).toEqual([])
  })
})

describe('absenceAt', () => {
  it('full day covers any time that local day', () => {
    const days = [{ date: '2026-12-01', kind: 'leave' as const }]
    expect(absenceAt(days, at('2026-12-01T05:30:00Z'), 30, IST)).toEqual(days[0]) // 11:00 IST
    expect(absenceAt(days, at('2026-11-30T19:00:00Z'), 30, IST)).toEqual(days[0]) // 00:30 IST on the 1st
    expect(absenceAt(days, at('2026-12-01T19:00:00Z'), 30, IST)).toBeNull() // already the 2nd in IST
  })

  it('half day only blocks its half of the working day', () => {
    const morning = [{ date: '2026-12-01', kind: 'leave' as const, half: 'FIRST' as const }]
    expect(absenceAt(morning, at('2026-12-01T06:30:00Z'), 30, IST)).toEqual(morning[0]) // 12:00 IST
    expect(absenceAt(morning, at('2026-12-01T11:30:00Z'), 30, IST)).toBeNull() // 17:00 IST
    expect(absenceAt(morning, at('2026-12-01T09:45:00Z'), 30, IST)).toEqual(morning[0]) // 15:15–15:45 crosses 15:30
    const afternoon = [{ date: '2026-12-01', kind: 'leave' as const, half: 'SECOND' as const }]
    expect(absenceAt(afternoon, at('2026-12-01T06:30:00Z'), 30, IST)).toBeNull()
    expect(absenceAt(afternoon, at('2026-12-01T11:30:00Z'), 30, IST)).toEqual(afternoon[0])
  })

  it('strongest wins: holiday > leave > pending, full over half', () => {
    expect(strongest([{ date: 'd', kind: 'pending' }, { date: 'd', kind: 'holiday' }, { date: 'd', kind: 'leave' }])?.kind).toBe('holiday')
    expect(strongest([{ date: 'd', kind: 'leave', half: 'FIRST' }, { date: 'd', kind: 'leave' }])).toEqual({ date: 'd', kind: 'leave' })
  })
})

describe('absencesForMeetings', () => {
  const meeting = (id: string, iso: string) => ({ id, meetingDate: at(iso), durationMinutes: 30, employeeId: 'emp', reporterId: 'rep' })
  const now = at('2026-11-27T00:00:00Z')

  it('batches Keka per month, maps leave + holidays per person in their own zone', async () => {
    vi.mocked(fetchLeaveRequests).mockImplementation(async (ids: string[]) =>
      ids.includes('k-emp') ? [{ id: 'l1', employeeIdentifier: 'k-emp', fromDate: '2026-12-02', toDate: '2026-12-02', status: 1 }] : []
    )
    vi.mocked(holidayDatesForCountry).mockImplementation(async (c) => new Set(c === 'US' ? ['2026-12-25'] : []))

    const res = await absencesForMeetings(
      [meeting('a', '2026-12-02T06:00:00Z'), meeting('b', '2026-12-25T16:00:00Z'), meeting('c', '2026-12-03T06:00:00Z')],
      now
    )
    expect(res.a).toEqual({ employee: { date: '2026-12-02', kind: 'leave' } })
    expect(res.b).toEqual({ reporter: { date: '2026-12-25', kind: 'holiday' } })
    expect(res.c).toBeUndefined()
    // one call per month (Dec), both people in it
    expect(fetchLeaveRequests).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchLeaveRequests).mock.calls[0][0]).toEqual(['k-emp', 'k-rep'])

    // cached: a second lookup in the same month doesn't call Keka again
    await absencesForMeetings([meeting('d', '2026-12-09T06:00:00Z')], now)
    expect(fetchLeaveRequests).toHaveBeenCalledTimes(1)
  })

  it('Keka down or not configured → no absences, no throw', async () => {
    vi.mocked(fetchLeaveRequests).mockRejectedValue(new Error('429'))
    expect(await absencesForMeetings([meeting('a', '2026-12-02T06:00:00Z')], now)).toEqual({})
    vi.mocked(isKekaConfigured).mockReturnValue(false)
    expect(await absencesForMeetings([meeting('a', '2026-12-02T06:00:00Z')], now)).toEqual({})
  })

  it('ignores past and far-future meetings', async () => {
    expect(await absencesForMeetings([meeting('old', '2026-10-01T06:00:00Z'), meeting('far', '2027-09-01T06:00:00Z')], now)).toEqual({})
    expect(fetchLeaveRequests).not.toHaveBeenCalled()
  })
})

describe('pair helpers', () => {
  beforeEach(() => {
    vi.mocked(fetchLeaveRequests).mockImplementation(async () => [
      { id: 'l1', employeeIdentifier: 'k-emp', fromDate: '2026-12-02', toDate: '2026-12-02', status: 1 },
      { id: 'l2', employeeIdentifier: 'k-emp', fromDate: '2026-12-04', toDate: '2026-12-04', status: 1, fromSession: 1, toSession: 1 },
      { id: 'l3', employeeIdentifier: 'k-rep', fromDate: '2026-12-07', toDate: '2026-12-07', status: 0 },
    ])
  })

  it('pairAbsenceDays: whole days block, half/pending are hints', async () => {
    const days = await pairAbsenceDays('rep', 'emp', '2026-12-01', '2026-12-31')
    expect(days.map((d) => [d.date, !!d.fullDay, d.partial.map((p) => `${p.who}:${p.absence.kind}${p.absence.half ? ':' + p.absence.half : ''}`)])).toEqual([
      ['2026-12-02', true, []],
      ['2026-12-04', false, ['employee:leave:SECOND']],
      ['2026-12-07', false, ['reporter:pending']],
    ])
    const nameOf = (s: 'reporter' | 'employee') => (s === 'reporter' ? 'You' : 'Asha')
    expect(fullDayMessage(days[0].fullDay!, nameOf)).toBe('Asha is on leave that day (Keka). Pick another day.')
    expect(leaveNoteFor(days[1], nameOf)).toBe('Asha is on leave for the second half of the day; only the other half is shown.')
    expect(leaveNoteFor(days[2], nameOf)).toBe('You have a leave request pending in Keka for this day.')
  })

  it('pairSlotFilter drops the leave half, keeps the rest; pending never blocks', async () => {
    const f = await pairSlotFilter('rep', 'emp', '2026-12-04')
    expect(f.isBlocked(at('2026-12-04T06:00:00Z'), 30)).toBe(false) // 11:30 IST
    expect(f.isBlocked(at('2026-12-04T11:00:00Z'), 30)).toBe(true) // 16:30 IST
    const p = await pairSlotFilter('rep', 'emp', '2026-12-07')
    expect(p.isBlocked(at('2026-12-07T16:00:00Z'), 30)).toBe(false)
    expect(p.pending()).toEqual(['reporter'])
  })

  it('blockingAbsence for a recurring occurrence', async () => {
    expect(await blockingAbsence('rep', 'emp', at('2026-12-02T06:00:00Z'), 30)).toEqual({ who: 'employee', absence: { date: '2026-12-02', kind: 'leave' } })
    expect(await blockingAbsence('rep', 'emp', at('2026-12-07T16:00:00Z'), 30)).toBeNull() // pending only
  })
})

describe('absenceChips', () => {
  const m = { employeeId: 'emp', reporterId: 'rep' }
  const a = { employee: { kind: 'leave' as const }, reporter: { kind: 'holiday' as const } }
  it('labels per viewer', () => {
    expect(absenceChips(a, m, 'rep').map((c) => c.label)).toEqual(['On leave', 'You: Holiday'])
    expect(absenceChips(a, m, 'emp').map((c) => c.label)).toEqual(['Holiday', 'You: On leave'])
    expect(absenceChips(a, m, 'admin').map((c) => c.label)).toEqual(['On leave', 'Manager: Holiday'])
    expect(absenceChips(undefined, m, 'rep')).toEqual([])
    expect(absenceLabel({ kind: 'leave', half: 'FIRST' })).toBe('Half-day leave')
    expect(absenceLabel({ kind: 'pending' })).toBe('Leave pending')
  })
})

describe('whoIsOutToday', () => {
  it('lists approved full + half day leave today in each person\'s zone, full day first; skips pending', async () => {
    const { whoIsOutToday } = await import('@/lib/absences')
    prismaMock.user.findMany.mockImplementation(async (args: { where: { id?: { in: string[] }; isActive?: boolean } }) => {
      if (args.where.isActive) {
        return [
          { id: 'emp', name: 'Zed', image: null, title: 'Dev', department: { name: 'Eng' } },
          { id: 'rep', name: 'Amy', image: null, title: null, department: null },
        ]
      }
      return users.filter((u) => args.where.id!.in.includes(u.id))
    })
    vi.mocked(fetchLeaveRequests).mockImplementation(async () => [
      { id: 'a', employeeIdentifier: 'k-emp', fromDate: '2026-12-02', toDate: '2026-12-02', status: 1 },
      { id: 'b', employeeIdentifier: 'k-rep', fromDate: '2026-12-02', toDate: '2026-12-02', status: 1, fromSession: 1, toSession: 1 },
    ])
    // 2026-12-02 10:00 UTC: Dec 2 in both IST and Denver
    const out = await whoIsOutToday(null, at('2026-12-02T10:00:00Z'))
    expect(out.map((p) => [p.name, p.absence.half ?? 'FULL', p.department])).toEqual([['Zed', 'FULL', 'Eng'], ['Amy', 'SECOND', null]])

    vi.mocked(fetchLeaveRequests).mockImplementation(async () => [{ id: 'c', employeeIdentifier: 'k-emp', fromDate: '2026-12-09', toDate: '2026-12-09', status: 0 }])
    clearAbsenceCache()
    expect(await whoIsOutToday(['emp'], at('2026-12-09T10:00:00Z'))).toEqual([])
  })

  it('nothing without Keka', async () => {
    const { whoIsOutToday } = await import('@/lib/absences')
    vi.mocked(isKekaConfigured).mockReturnValue(false)
    expect(await whoIsOutToday(null)).toEqual([])
  })
})
