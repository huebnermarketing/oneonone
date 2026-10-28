import { describe, it, expect, vi } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'
import { ids } from '../helpers/fixtures'

vi.mock('@/lib/availability', () => ({
  calendarsConnected: vi.fn(async () => ({ reporter: true, employee: true, both: true, either: true })),
  loadPairProfiles: vi.fn(async () => ({ options: {} })),
}))

import { applySeriesMoveToCalendar, onPattern, planSeriesMove, prepareSeriesMove } from '@/lib/recurring-edit'
import * as gcal from '@/lib/google-calendar'

const IST = 'Asia/Kolkata'
const now = new Date('2026-11-02T00:00:00Z') // Mon 05:30 IST
const oldP = { dayOfWeek: 1, timeOfDay: '11:00', frequency: 'WEEKLY' as const }
const newP = { dayOfWeek: 3, timeOfDay: '14:00', frequency: 'WEEKLY' as const }
const mon2 = new Date('2026-11-02T05:30:00Z') // Mon 11:00 IST
const mon9 = new Date('2026-11-09T05:30:00Z')
const tue17 = new Date('2026-11-17T09:30:00Z') // individually rescheduled (Tue 15:00 IST)

describe('onPattern', () => {
  it('weekday + time in the zone', () => {
    expect(onPattern(mon2, oldP, IST)).toBe(true)
    expect(onPattern(tue17, oldP, IST)).toBe(false)
    expect(onPattern(mon2, oldP, 'UTC')).toBe(false)
  })
})

describe('planSeriesMove', () => {
  it('moves old-pattern meetings in order onto the new pattern, keeps rescheduled ones, continues after the last', () => {
    const plan = planSeriesMove(
      [
        { id: 'b', meetingDate: mon9 },
        { id: 'x', meetingDate: tue17 },
        { id: 'a', meetingDate: mon2 },
      ],
      oldP,
      newP,
      IST,
      now
    )
    expect(plan.moves.map((m) => [m.id, m.to.toISOString()])).toEqual([
      ['a', '2026-11-04T08:30:00.000Z'], // Wed 14:00 IST
      ['b', '2026-11-11T08:30:00.000Z'],
    ])
    expect(plan.kept.map((m) => m.id)).toEqual(['x'])
    expect(plan.firstNew.toISOString()).toBe('2026-11-04T08:30:00.000Z')
    expect(plan.nextMeetingDate.toISOString()).toBe('2026-11-18T08:30:00.000Z')
  })

  it('nothing upcoming → next generation starts at the first new occurrence', () => {
    const plan = planSeriesMove([], oldP, { ...newP, frequency: 'BIWEEKLY' }, IST, now)
    expect(plan.moves).toEqual([])
    expect(plan.nextMeetingDate).toEqual(plan.firstNew)
  })
})

const schedule = {
  id: 's1',
  reporterId: ids.reporter,
  employeeId: ids.employee,
  ...oldP,
  googleRecurringEventId: 'series-old' as string | null,
  employee: { id: ids.employee, name: 'Emp', email: 'emp@example.com' },
  reporter: { id: ids.reporter, name: 'Rep', email: 'rep@example.com', timeZone: IST },
}

describe('prepareSeriesMove', () => {
  it('409 when the first new slot clashes with another meeting', async () => {
    prismaMock.meeting.findMany
      .mockResolvedValueOnce([{ id: 'a', meetingDate: mon2, status: 'SCHEDULED', calendarEvent: null }])
      .mockResolvedValueOnce([
        { meetingDate: new Date('2026-11-04T08:30:00Z'), durationMinutes: 30, employeeId: ids.employee, reporterId: ids.otherReporter, employee: { name: 'Emp' }, reporter: { name: 'Other' } },
      ])
    await expect(prepareSeriesMove(schedule, newP, 30, IST, now)).rejects.toMatchObject({ status: 409 })
  })

  it('409 when Google says the first new slot is busy', async () => {
    prismaMock.meeting.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(gcal.isDateTimeFreeForBoth).mockImplementationOnce(async () => false)
    await expect(prepareSeriesMove(schedule, newP, 30, IST, now)).rejects.toMatchObject({ status: 409 })
  })
})

describe('applySeriesMoveToCalendar', () => {
  it('ends the old series, gives a rescheduled meeting its own event, starts a new series at the first accepted meeting', async () => {
    vi.mocked(gcal.isCalendarEnabled).mockImplementation(async () => true)
    const upcoming = [
      { id: 'a', meetingDate: mon2, status: 'SCHEDULED' as const, calendarEvent: null },
      { id: 'x', meetingDate: tue17, status: 'SCHEDULED' as const, calendarEvent: null },
    ]
    const plan = planSeriesMove(upcoming, oldP, newP, IST, now)
    await applySeriesMoveToCalendar(schedule, newP, 30, IST, plan, upcoming, now)
    expect(gcal.endRecurringSeries).toHaveBeenCalledWith('series-old', ids.reporter, now)
    expect(gcal.createCalendarEvent).toHaveBeenCalledWith('x', 'emp@example.com', 'rep@example.com', ids.reporter, tue17, 'Emp', 'Rep', 30)
    expect(gcal.createRecurringCalendarEvent).toHaveBeenCalledWith(
      's1', 'a', ids.reporter, 'emp@example.com', 'rep@example.com', new Date('2026-11-04T08:30:00Z'), 'Emp', 'Rep', 'WEEKLY', IST, 30
    )
  })

  it('no series yet (not accepted): only one-off events move', async () => {
    const upcoming = [{ id: 'a', meetingDate: mon2, status: 'PROPOSED' as const, calendarEvent: { googleEventId: 'ev1' } }]
    const plan = planSeriesMove(upcoming, oldP, newP, IST, now)
    await applySeriesMoveToCalendar({ ...schedule, googleRecurringEventId: null }, newP, 15, IST, plan, upcoming, now)
    expect(gcal.updateCalendarEvent).toHaveBeenCalledWith('ev1', ids.reporter, plan.moves[0]!.to, 'Emp', 'Rep', 15)
    expect(gcal.endRecurringSeries).not.toHaveBeenCalled()
    expect(gcal.createRecurringCalendarEvent).not.toHaveBeenCalled()
  })
})

describe('truncateRecurrence', () => {
  it('replaces COUNT/UNTIL with an UNTIL at the cut-off', async () => {
    const { truncateRecurrence } = await vi.importActual<typeof import('@/lib/google-calendar')>('@/lib/google-calendar')
    expect(truncateRecurrence(['RRULE:FREQ=WEEKLY;WKST=MO;COUNT=52', 'EXDATE:20261110T053000Z'], new Date('2026-11-02T05:29:00Z'))).toEqual([
      'RRULE:FREQ=WEEKLY;WKST=MO;UNTIL=20261102T052900Z',
      'EXDATE:20261110T053000Z',
    ])
    expect(truncateRecurrence(['RRULE:FREQ=MONTHLY;BYDAY=2MO;UNTIL=20270101T000000Z'], new Date('2026-11-02T00:00:00Z'))).toEqual([
      'RRULE:FREQ=MONTHLY;BYDAY=2MO;UNTIL=20261102T000000Z',
    ])
  })
})
