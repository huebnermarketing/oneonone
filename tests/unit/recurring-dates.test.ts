import { describe, it, expect, vi, afterEach } from 'vitest'
import { toZonedTime } from 'date-fns-tz'
import { calculateFirstOccurrence, advanceToNextOccurrence, getNextOccurrenceDates, buildRecurrenceRule, monthlyOrdinal, nthWeekdayOfMonth } from '@/lib/recurring-dates'

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
  it('monthly: same weekday-of-month next month (2nd Monday → 2nd Monday)', () => {
    // Mon 9 Nov 2026 is the 2nd Monday → 2nd Monday of Dec is 14 Dec
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

describe('monthly = Nth weekday of the month (backlog #19)', () => {
  it('ordinal + nth weekday helpers', () => {
    expect([1, 7, 8, 14, 22, 28, 29, 31].map(monthlyOrdinal)).toEqual([1, 1, 2, 2, 4, 4, 4, 4])
    expect(nthWeekdayOfMonth(2026, 0, 1, 1)).toBe(5) // 1st Monday Jan 2026
    expect(nthWeekdayOfMonth(2026, 1, 1, 2)).toBe(9) // 2nd Monday Feb 2026
    expect(nthWeekdayOfMonth(2026, 4, 5, 4)).toBe(22) // 4th Friday May 2026
  })

  it('does not drift over a year (old rule moved later every month)', () => {
    let d = new Date('2026-01-05T09:30:00.000Z') // Mon 5 Jan 2026 15:00 IST — 1st Monday
    const got: string[] = []
    for (let i = 0; i < 12; i++) {
      d = advanceToNextOccurrence(1, '15:00', 'MONTHLY', d, TZ)
      const l = local(d)
      expect(l.getDay()).toBe(1)
      expect(l.getDate()).toBeLessThanOrEqual(7) // always the 1st Monday
      expect([l.getHours(), l.getMinutes()]).toEqual([15, 0])
      got.push(`${l.getFullYear()}-${l.getMonth() + 1}-${l.getDate()}`)
    }
    expect(got[0]).toBe('2026-2-2')
    expect(got[11]).toBe('2027-1-4') // rolls into the next year
  })

  it('4th-week anchors stay on the 4th weekday even in 5-week months', () => {
    let d = new Date('2026-06-22T09:30:00.000Z') // Mon 22 Jun 2026 = 4th Monday (29 Jun is the 5th)
    d = advanceToNextOccurrence(1, '15:00', 'MONTHLY', d, TZ) // July: 4th Monday = 27
    expect(local(d).getDate()).toBe(27)
  })

  it('first occurrence never lands in a 5th week', () => {
    vi.useFakeTimers({ now: new Date('2026-03-27T04:30:00.000Z') }) // Fri 27 Mar → next Mon is 30 Mar (5th week)
    const d = local(calculateFirstOccurrence(1, '15:00', 'MONTHLY', TZ))
    expect([d.getMonth(), d.getDate()]).toEqual([3, 6]) // Mon 6 Apr instead
    vi.useFakeTimers({ now: new Date('2026-03-27T04:30:00.000Z') })
    expect(local(calculateFirstOccurrence(1, '15:00', 'WEEKLY', TZ)).getDate()).toBe(30) // weekly unaffected
  })

  it('Google RRULE matches the app rule', () => {
    expect(buildRecurrenceRule('MONTHLY', new Date('2026-02-09T09:30:00.000Z'), TZ)).toEqual(['RRULE:FREQ=MONTHLY;BYDAY=2MO;COUNT=12'])
    expect(buildRecurrenceRule('MONTHLY', new Date('2026-05-22T09:30:00.000Z'), TZ)).toEqual(['RRULE:FREQ=MONTHLY;BYDAY=4FR;COUNT=12'])
    expect(buildRecurrenceRule('WEEKLY', new Date(), TZ)).toEqual(['RRULE:FREQ=WEEKLY;WKST=MO;COUNT=52'])
    expect(buildRecurrenceRule('BIWEEKLY', new Date(), TZ)).toEqual(['RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=MO;COUNT=26'])
  })

  it('uses the schedule timezone for the weekday (late-evening UTC is next day in IST)', () => {
    // 2026-02-08T20:00Z = Mon 9 Feb 01:30 IST → 2nd Monday in IST, though still Sunday in UTC
    expect(buildRecurrenceRule('MONTHLY', new Date('2026-02-08T20:00:00.000Z'), TZ)).toEqual(['RRULE:FREQ=MONTHLY;BYDAY=2MO;COUNT=12'])
  })
})
