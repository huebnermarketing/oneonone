import { describe, it, expect } from 'vitest'
import {
  getNextOccurrenceDate, slotToTimeInTz, buildFallbackSlots, formatTimeOfDay, parseHHmm, localMinutesOfDay,
  dayOfWeekOf, addDaysToKey, isSlotInPast, isSameLocalDay,
} from '@/lib/slots'

const IST = 'Asia/Kolkata'
const MST = 'America/Denver'
// 2026-02-18T06:00Z is Wed 11:30 IST and Tue 23:00 MST (Feb 17)
const T = new Date('2026-02-18T06:00:00.000Z')

describe('getNextOccurrenceDate (viewer zone, not browser-local)', () => {
  it('same instant is a different weekday for two viewers', () => {
    // IST viewer: it is Wednesday morning → next Wednesday is today
    expect(getNextOccurrenceDate(3, IST, T)).toBe('2026-02-18')
    // MST viewer: it is still Tuesday night (after the 18:00 cutoff) → Wednesday is tomorrow
    expect(getNextOccurrenceDate(3, MST, T)).toBe('2026-02-18')
    // MST viewer asking for Tuesday: today is Tuesday but it is 23:00 → next week's Tuesday
    expect(getNextOccurrenceDate(2, MST, T)).toBe('2026-02-24')
    // IST viewer asking for Tuesday: already Wednesday → next week's Tuesday
    expect(getNextOccurrenceDate(2, IST, T)).toBe('2026-02-24')
  })
  it('today counts only before the cutoff hour in the viewer zone', () => {
    const wedMorningIst = new Date('2026-02-18T03:00:00.000Z') // 08:30 IST
    const wedEveningIst = new Date('2026-02-18T13:00:00.000Z') // 18:30 IST
    expect(getNextOccurrenceDate(3, IST, wedMorningIst)).toBe('2026-02-18')
    expect(getNextOccurrenceDate(3, IST, wedEveningIst)).toBe('2026-02-25')
    // 18:30 IST is 06:00 MST the same Wednesday → still today for a Denver viewer
    expect(getNextOccurrenceDate(3, MST, wedEveningIst)).toBe('2026-02-18')
    expect(getNextOccurrenceDate(3, IST, wedEveningIst, 19)).toBe('2026-02-18')
  })
  it('walks forward across month and year ends', () => {
    const nye = new Date('2026-12-31T10:00:00.000Z') // Thursday
    expect(getNextOccurrenceDate(0, IST, nye)).toBe('2027-01-03')
    expect(getNextOccurrenceDate(4, IST, nye)).toBe('2026-12-31')
  })
})

describe('slotToTimeInTz', () => {
  it('renders HH:mm wall-clock in the given zone', () => {
    expect(slotToTimeInTz(T.toISOString(), IST)).toBe('11:30')
    expect(slotToTimeInTz(T.toISOString(), MST)).toBe('23:00')
    expect(slotToTimeInTz(T.toISOString(), 'UTC')).toBe('06:00')
    expect(slotToTimeInTz('2026-02-17T18:30:00.000Z', IST)).toBe('00:00') // never "24:00"
    expect(slotToTimeInTz('2026-07-01T15:00:00.000Z', MST)).toBe('09:00') // MDT
  })
  it('round-trips a fallback slot back to its wall-clock label', () => {
    const slots = buildFallbackSlots('2026-02-18', MST)
    expect(slots.map((s) => slotToTimeInTz(s.start, MST))[0]).toBe('09:00')
    expect(slots.map((s) => slotToTimeInTz(s.start, MST)).at(-1)).toBe('18:30')
  })
})

describe('buildFallbackSlots', () => {
  it('defaults to twenty 30-minute slots 09:00 … 18:30 in the viewer zone', () => {
    const ist = buildFallbackSlots('2026-02-18', IST)
    expect(ist).toHaveLength(20)
    expect(ist[0]).toEqual({ start: '2026-02-18T03:30:00.000Z', end: '2026-02-18T04:00:00.000Z' })
    expect(ist[19].start).toBe('2026-02-18T13:00:00.000Z')
    const mst = buildFallbackSlots('2026-02-18', MST)
    expect(mst[0].start).toBe('2026-02-18T16:00:00.000Z')
  })
  it('honours the viewer work hours and never emits a slot that overruns the end', () => {
    const slots = buildFallbackSlots('2026-02-18', IST, '11:00', '12:15')
    expect(slots.map((s) => slotToTimeInTz(s.start, IST))).toEqual(['11:00', '11:30'])
    expect(buildFallbackSlots('2026-02-18', IST, '11:00', '11:15')).toEqual([])
    expect(buildFallbackSlots('2026-02-18', IST, null, undefined)).toHaveLength(20)
  })
  it('is right on the US DST switch day', () => {
    const slots = buildFallbackSlots('2026-03-08', MST, '01:00', '04:00')
    // Slots are fixed offsets from local midnight, so the 02:xx wall-clock hour (which does not exist) lands on 03:xx MDT
    expect(slots.map((s) => slotToTimeInTz(s.start, MST))).toEqual(['01:00', '01:30', '03:00', '03:30', '04:00', '04:30'])
  })
})

describe('small helpers', () => {
  it('parse/format HH:mm', () => {
    expect(parseHHmm('09:30')).toBe(570)
    expect(parseHHmm('9:05')).toBe(545)
    expect(parseHHmm('garbage')).toBe(0)
    expect(formatTimeOfDay('09:30')).toBe('9:30 AM')
    expect(formatTimeOfDay('13:05')).toBe('1:05 PM')
    expect(formatTimeOfDay('00:00')).toBe('12:00 AM')
    expect(formatTimeOfDay('12:00')).toBe('12:00 PM')
  })
  it('local minutes, weekday, day arithmetic', () => {
    expect(localMinutesOfDay(T, IST)).toBe(690)
    expect(localMinutesOfDay(T, MST)).toBe(1380)
    expect(dayOfWeekOf('2026-02-18')).toBe(3)
    expect(addDaysToKey('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDaysToKey('2026-12-31', 3)).toBe('2027-01-03')
  })
  it('past + same-day checks', () => {
    expect(isSlotInPast(T.toISOString(), new Date(T.getTime() + 1))).toBe(true)
    expect(isSlotInPast(T, T)).toBe(true)
    expect(isSlotInPast(T.toISOString(), new Date(T.getTime() - 1))).toBe(false)
    expect(isSameLocalDay(T, new Date('2026-02-18T15:00:00Z'), IST)).toBe(true)
    expect(isSameLocalDay(T, new Date('2026-02-18T15:00:00Z'), MST)).toBe(false)
  })
})
