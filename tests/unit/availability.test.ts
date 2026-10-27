import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'

vi.mock('@/lib/google-calendar', () => ({
  getMutualFreeSlots: vi.fn(),
  isCalendarEnabled: vi.fn(),
  isDateTimeFreeForBoth: vi.fn(),
}))
vi.mock('@/lib/keka', () => ({ isDateUnavailableForEitherUser: vi.fn() }))

import * as gcal from '@/lib/google-calendar'
import * as keka from '@/lib/keka'
import { pairProfiles, workingHoursLabel, appMeetingsBusy, freeSlotsForDay, firstFreeOccurrence, calendarsConnected } from '@/lib/availability'

const IST = { timeZone: 'Asia/Kolkata', workDayStart: '11:00', workDayEnd: '20:00' }
const MT = { timeZone: 'America/Denver', workDayStart: '08:00', workDayEnd: '16:00' }

beforeEach(() => {
  vi.mocked(keka.isDateUnavailableForEitherUser).mockImplementation(async () => false)
})

describe('profiles + label', () => {
  it('fills app defaults for unset fields', () => {
    const p = pairProfiles(null, { timeZone: null, workDayStart: null, workDayEnd: null })
    expect(p.reporter).toEqual({ timeZone: 'Asia/Kolkata', workStart: '09:00', workEnd: '19:00' })
    expect(p.options).toMatchObject({ reporterTimeZone: 'Asia/Kolkata', employeeWorkEnd: '19:00' })
  })
  it('same hours → simple label; viewer suffix optional', () => {
    const p = pairProfiles(IST, IST)
    expect(workingHoursLabel(p)).toBe('Free on both calendars (11:00 – 20:00 your time)')
    expect(workingHoursLabel(p, false)).toBe('Free on both calendars (11:00 – 20:00)')
  })
  it('different zones → per-person label', () => {
    expect(workingHoursLabel(pairProfiles(IST, MT))).not.toMatch(/^Free on both calendars/)
  })
})

describe('appMeetingsBusy', () => {
  it('queries the reporter-local calendar day and returns meeting-length intervals', async () => {
    const at = new Date('2026-11-10T06:00:00.000Z')
    prismaMock.meeting.findMany.mockResolvedValue([{ meetingDate: at }])
    const busy = await appMeetingsBusy('r', 'e', new Date('2026-11-10T00:00:00.000Z'), 'Asia/Kolkata')
    const where = prismaMock.meeting.findMany.mock.calls[0][0].where
    expect(where.meetingDate.gte.toISOString()).toBe('2026-11-09T18:30:00.000Z') // 10 Nov 00:00 IST
    expect(where.meetingDate.lt.toISOString()).toBe('2026-11-10T18:30:00.000Z')  // 11 Nov 00:00 IST
    expect(where.OR).toHaveLength(4)
    expect(busy).toEqual([{ start: at.getTime(), end: at.getTime() + 30 * 60_000 }])
  })
})

describe('freeSlotsForDay', () => {
  it('removes calendar slots that overlap an existing app meeting', async () => {
    vi.mocked(gcal.getMutualFreeSlots).mockImplementation(async () => [
      { start: '2026-11-10T06:00:00.000Z', end: '2026-11-10T06:30:00.000Z' },
      { start: '2026-11-10T06:30:00.000Z', end: '2026-11-10T07:00:00.000Z' },
      { start: '2026-11-10T07:00:00.000Z', end: '2026-11-10T07:30:00.000Z' },
    ])
    prismaMock.meeting.findMany.mockResolvedValue([{ meetingDate: new Date('2026-11-10T06:30:00.000Z') }])
    const slots = await freeSlotsForDay('r', 'e', new Date('2026-11-10'), pairProfiles(IST, IST))
    expect(slots.map((s) => s.start)).toEqual(['2026-11-10T06:00:00.000Z', '2026-11-10T07:00:00.000Z'])
  })
})

describe('firstFreeOccurrence', () => {
  const dates = [new Date('2026-11-09T09:30:00Z'), new Date('2026-11-16T09:30:00Z'), new Date('2026-11-23T09:30:00Z')]
  it('skips Keka-unavailable days and busy times', async () => {
    vi.mocked(keka.isDateUnavailableForEitherUser).mockImplementation(async (_r, _e, d) => d.getTime() === dates[0].getTime())
    vi.mocked(gcal.isDateTimeFreeForBoth).mockImplementation(async (_r, _e, d) => d.getTime() === dates[2].getTime())
    expect(await firstFreeOccurrence('r', 'e', dates, pairProfiles(IST, IST))).toEqual(dates[2])
    expect(gcal.isDateTimeFreeForBoth).toHaveBeenCalledTimes(2) // the leave day never hit the calendar API
  })
  it('null when all are blocked', async () => {
    vi.mocked(gcal.isDateTimeFreeForBoth).mockImplementation(async () => false)
    expect(await firstFreeOccurrence('r', 'e', dates, pairProfiles(IST, IST))).toBeNull()
  })
})

describe('calendarsConnected', () => {
  it('reports each side and both', async () => {
    vi.mocked(gcal.isCalendarEnabled).mockImplementation(async (id) => id === 'r')
    expect(await calendarsConnected('r', 'e')).toEqual({ reporter: true, employee: false, both: false, either: true })
  })
})
