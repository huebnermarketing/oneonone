import { describe, it, expect, vi, afterEach } from 'vitest'
import { toZonedTime } from 'date-fns-tz'
import { calculateFirstOccurrence, advanceToNextOccurrence, getNextOccurrenceDates } from '@/lib/recurring-dates'

const TZ = 'Asia/Kolkata'
const local = (d: Date) => toZonedTime(d, TZ)

afterEach(() => vi.useRealTimers())

describe('calculateFirstOccurrence', () => {
  // Wed 2026-11-04 10:00 IST
  const now = new Date('2026-11-04T04:30:00.000Z')

  it('weekly: next matching weekday at the given time, in the schedule timezone', () => {
    vi.useFakeTimers({ now })
    const d = local(calculateFirstOccurrence(1, '15:00', 'WEEKLY', TZ)) // Monday
    expect(d.getDay()).toBe(1)
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([15, 0, 0])
    expect(d.getDate()).toBe(9) // Mon 9 Nov
  })

  it('same weekday, later today → today', () => {
    vi.useFakeTimers({ now })
    const d = local(calculateFirstOccurrence(3, '15:00', 'WEEKLY', TZ))
    expect(d.getDate()).toBe(4)
  })

  it('same weekday, time already passed → next week', () => {
    vi.useFakeTimers({ now })
    const d = local(calculateFirstOccurrence(3, '09:00', 'WEEKLY', TZ))
    expect(d.getDate()).toBe(11)
  })

  it('biweekly skips a week when the next match is < 7 days away', () => {
    vi.useFakeTimers({ now })
    const d = local(calculateFirstOccurrence(1, '15:00', 'BIWEEKLY', TZ))
    expect(d.getDate()).toBe(16) // Mon 16 Nov, not 9
  })

  it('respects a different timezone (US/Denver)', () => {
    vi.useFakeTimers({ now })
    const d = toZonedTime(calculateFirstOccurrence(1, '09:30', 'WEEKLY', 'America/Denver'), 'America/Denver')
    expect(d.getDay()).toBe(1)
    expect([d.getHours(), d.getMinutes()]).toEqual([9, 30])
  })
})

describe('advanceToNextOccurrence', () => {
  const last = new Date('2026-11-09T09:30:00.000Z') // Mon 9 Nov 15:00 IST

  it('weekly +7 days', () => {
    const d = local(advanceToNextOccurrence(1, '15:00', 'WEEKLY', last, TZ))
    expect([d.getDate(), d.getMonth(), d.getHours()]).toEqual([16, 10, 15])
  })
  it('biweekly +14 days', () => {
    const d = local(advanceToNextOccurrence(1, '15:00', 'BIWEEKLY', last, TZ))
    expect(d.getDate()).toBe(23)
  })
  it('monthly: first matching weekday on/after the same date next month', () => {
    // 9 Dec 2026 is a Wednesday → next Monday is 14 Dec
    const d = local(advanceToNextOccurrence(1, '15:00', 'MONTHLY', last, TZ))
    expect([d.getDate(), d.getMonth()]).toEqual([14, 11])
  })
  it('keeps wall-clock time across a DST change in a DST timezone', () => {
    // Denver: DST ends 2026-11-01. Start Mon 26 Oct 09:30 MDT, advance weekly → Mon 2 Nov 09:30 MST
    const start = new Date('2026-10-26T15:30:00.000Z')
    const next = toZonedTime(advanceToNextOccurrence(1, '09:30', 'WEEKLY', start, 'America/Denver'), 'America/Denver')
    expect([next.getDate(), next.getHours(), next.getMinutes()]).toEqual([2, 9, 30])
  })
})

describe('getNextOccurrenceDates', () => {
  it('returns N strictly increasing dates', () => {
    vi.useFakeTimers({ now: new Date('2026-11-04T04:30:00.000Z') })
    const dates = getNextOccurrenceDates(5, '11:00', 'WEEKLY', TZ, 4)
    expect(dates).toHaveLength(4)
    for (let i = 1; i < dates.length; i++) expect(dates[i].getTime() - dates[i - 1].getTime()).toBe(7 * 86400000)
  })
})
