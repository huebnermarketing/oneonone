import { describe, it, expect, vi } from 'vitest'
import {
  resolveTimeZone, isValidTimeZone, formatDate, formatDateTime, formatTime, formatMeetingShort, formatMeetingLong,
  formatDayHeading, formatMonthDay, timeZoneAbbrev, isDateOnly, parseDateOnly, formatDateOnly, toDateKey,
  offsetMinutes, endOfDayInTz, startOfDayInTz, isTodoOverdue, relativeDayLabel, formattersFor,
} from '@/lib/dates'

const T = new Date('2026-02-18T06:00:00.000Z') // 11:30 IST, 23:00 MST (Feb 17), 01:00 EST
const IST = 'Asia/Kolkata'
const MST = 'America/Denver'

describe('timezone resolution', () => {
  it('validates IANA names and falls back to the app default', () => {
    expect(isValidTimeZone(IST)).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(resolveTimeZone(null)).toBe(IST)
    expect(resolveTimeZone('Mars/Olympus')).toBe(IST)
    expect(resolveTimeZone(MST)).toBe(MST)
  })
})

describe('instant formatting renders in the viewer zone', () => {
  it('same instant, two viewers, two different days', () => {
    expect(formatMeetingShort(T, IST)).toBe('Wed, Feb 18, 11:30 AM')
    expect(formatMeetingShort(T, MST)).toBe('Tue, Feb 17, 11:00 PM')
    expect(formatMeetingLong(T, IST)).toBe('Wednesday, February 18, 2026 at 11:30 AM')
    expect(formatDateTime(T, MST, 'short')).toBe('Feb 17, 2026, 11:00 PM')
    expect(formatDate(T, IST)).toBe('February 18, 2026')
    expect(formatDate(T, MST, 'short')).toBe('Feb 17, 2026')
    expect(formatTime(T, 'America/New_York')).toBe('1:00 AM')
    expect(formatDayHeading(T, IST)).toBe('Wednesday, February 18')
    expect(formatMonthDay(T, IST)).toBe('Feb 18')
  })
  it('accepts ISO strings and epoch numbers; empty on garbage', () => {
    expect(formatTime(T.toISOString(), IST)).toBe('11:30 AM')
    expect(formatTime(T.getTime(), IST)).toBe('11:30 AM')
    expect(formatTime('not a date', IST)).toBe('')
  })
  it('zone abbreviations', () => {
    expect(timeZoneAbbrev(T, IST)).toBe('IST')
    expect(timeZoneAbbrev(T, 'Asia/Singapore')).toMatch(/SGT|GMT\+8/)
    expect(timeZoneAbbrev(T, MST)).toBe('MST')
    expect(timeZoneAbbrev(new Date('2026-07-01T00:00:00Z'), MST)).toBe('MDT')
  })
})

describe('calendar dates never shift', () => {
  it('detects date-only values', () => {
    expect(isDateOnly('2026-02-18')).toBe(true)
    expect(isDateOnly(new Date('2026-02-18T00:00:00.000Z'))).toBe(true)
    expect(isDateOnly(T)).toBe(false)
  })
  it('formatDateOnly is identical for every viewer', () => {
    const due = new Date('2026-02-18T00:00:00.000Z')
    expect(formatDateOnly(due)).toBe('February 18, 2026')
    expect(formatDateOnly('2026-02-18', 'short')).toBe('Feb 18, 2026')
    expect(formatDateOnly('2026-02-18', 'weekday')).toBe('Wed, Feb 18')
    // the old bug: rendering midnight-UTC in a US zone shows the previous day
    expect(formatDate(due, MST, 'short')).toBe('Feb 17, 2026')
  })
  it('parseDateOnly → UTC midnight', () => {
    expect(parseDateOnly('2026-02-18').toISOString()).toBe('2026-02-18T00:00:00.000Z')
  })
  it('toDateKey gives the local calendar day', () => {
    expect(toDateKey(T, IST)).toBe('2026-02-18')
    expect(toDateKey(T, MST)).toBe('2026-02-17')
  })
})

describe('offsets and day bounds', () => {
  it('offsetMinutes', () => {
    expect(offsetMinutes(T, IST)).toBe(330)
    expect(offsetMinutes(T, MST)).toBe(-420)
    expect(offsetMinutes(new Date('2026-07-01T00:00:00Z'), MST)).toBe(-360)
    expect(offsetMinutes(T, 'UTC')).toBe(0)
  })
  it('start/end of day in a zone', () => {
    expect(startOfDayInTz('2026-02-18', IST).toISOString()).toBe('2026-02-17T18:30:00.000Z')
    expect(endOfDayInTz('2026-02-18', IST).toISOString()).toBe('2026-02-18T18:29:59.999Z')
    expect(endOfDayInTz('2026-02-18', MST).toISOString()).toBe('2026-02-19T06:59:59.999Z')
  })
  it('handles the US DST switch day', () => {
    // 2026-03-08: MST → MDT at 02:00; the day is 23 h long
    const start = startOfDayInTz('2026-03-08', MST)
    const end = endOfDayInTz('2026-03-08', MST)
    expect(start.toISOString()).toBe('2026-03-08T07:00:00.000Z')
    expect(end.toISOString()).toBe('2026-03-09T05:59:59.999Z')
  })
})

describe('isTodoOverdue in the viewer zone', () => {
  const due = '2026-02-18' // date-only
  it('date-only: overdue only after the viewer\'s end of that day', () => {
    expect(isTodoOverdue(due, new Date('2026-02-18T18:00:00Z'), 'PENDING', IST)).toBe(false) // 23:30 IST
    expect(isTodoOverdue(due, new Date('2026-02-18T18:30:00Z'), 'PENDING', IST)).toBe(true)  // 00:00 IST next day
    expect(isTodoOverdue(due, new Date('2026-02-18T18:30:00Z'), 'PENDING', MST)).toBe(false) // still 11:30 AM Feb 18 in Denver
    expect(isTodoOverdue(due, new Date('2026-02-19T07:00:00Z'), 'PENDING', MST)).toBe(true)
  })
  it('timed due dates compare the instant; DONE is never overdue', () => {
    expect(isTodoOverdue(T, new Date(T.getTime() + 1), 'PENDING', IST)).toBe(true)
    expect(isTodoOverdue(T, new Date(T.getTime() - 1), 'PENDING', IST)).toBe(false)
    expect(isTodoOverdue(due, new Date('2030-01-01'), 'DONE', IST)).toBe(false)
    expect(isTodoOverdue(null, new Date(), 'PENDING', IST)).toBe(false)
  })
})

describe('relative day labels + bound formatters', () => {
  it('today/tomorrow/yesterday by local calendar', () => {
    const now = new Date('2026-02-18T06:00:00Z')
    expect(relativeDayLabel('2026-02-18T15:00:00Z', now, IST)).toBe('today')
    expect(relativeDayLabel('2026-02-18T20:00:00Z', now, IST)).toBe('tomorrow') // 01:30 IST Feb 19
    expect(relativeDayLabel('2026-02-17T10:00:00Z', now, IST)).toBe('yesterday')
    expect(relativeDayLabel('2026-02-25T10:00:00Z', now, IST)).toBeUndefined()
  })
  it('formattersFor binds the zone', () => {
    const f = formattersFor(MST)
    expect(f.timeZone).toBe(MST)
    expect(f.meetingShort(T)).toBe('Tue, Feb 17, 11:00 PM')
    expect(f.dateOnly('2026-02-18')).toBe('February 18, 2026')
    expect(f.dateKey(T)).toBe('2026-02-17')
    expect(formattersFor('Mars/Olympus').timeZone).toBe(IST)
  })
})

describe('email helpers', () => {
  it('asciiSubject strips the punctuation that forces RFC 2047 encoding', async () => {
    const { asciiSubject, htmlToText } = await vi.importActual<typeof import('@/lib/email')>('@/lib/email')
    expect(asciiSubject('Meeting Request – Nishant Rana · Thursday, October 29, 2026 at 9:30 AM')).toBe(
      'Meeting Request - Nishant Rana - Thursday, October 29, 2026 at 9:30 AM'
    )
    expect(asciiSubject('“Quoted” … it’s\nmultiline')).toBe('"Quoted" ... it\'s multiline')
    expect(asciiSubject('Meeting with Priyanka Chokshi')).toBe('Meeting with Priyanka Chokshi')
    expect(htmlToText('<p>Hi <strong>A &amp; B</strong>,</p><p>See <a href="https://x.y/m/1">the meeting</a>.</p>')).toBe(
      'Hi A & B,\nSee the meeting (https://x.y/m/1).'
    )
  })
})
