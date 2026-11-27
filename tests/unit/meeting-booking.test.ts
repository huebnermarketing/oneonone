import { describe, it, expect, vi } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'
import {
  confirmPendingProposals,
  createNextOccurrence,
  recurringLabel,
  syncBookedMeetingToCalendar,
  watchCalendarRsvps,
} from '@/lib/meeting-booking'
import {
  acceptInvitationAs,
  createCalendarEvent,
  createRecurringCalendarEvent,
  getAttendeeRsvp,
  isCalendarEnabled,
} from '@/lib/google-calendar'
import { sendCalendarDeclinedEmail, sendMeetingBookedEmail } from '@/lib/email'

const now = new Date('2026-11-27T06:00:00.000Z')
const when = new Date('2026-11-30T06:00:00.000Z')
const employee = { id: 'emp', name: 'Employee', email: 'emp@test.com' }
const reporter = { id: 'rep', name: 'Reporter', email: 'rep@test.com' }

const booked = (extra: Record<string, unknown> = {}) => ({
  id: 'm1',
  status: 'SCHEDULED',
  meetingDate: when,
  durationMinutes: 30,
  employeeId: employee.id,
  reporterId: reporter.id,
  recurringScheduleId: null as string | null,
  calendarDeclinedAt: null as Date | null,
  employee,
  reporter,
  calendarEvent: null as null | { googleEventId: string },
  recurringSchedule: null as null | { googleRecurringEventId: string | null; frequency: string; reporter: { timeZone: string } },
  ...extra,
})

/** Calendar connected for these user ids only. */
const calendarsOn = (...userIds: string[]) =>
  vi.mocked(isCalendarEnabled).mockImplementation(async (id: string) => userIds.includes(id))

describe('recurringLabel', () => {
  it('names frequency and day', () => {
    expect(recurringLabel('WEEKLY', 1)).toBe('Weekly on Monday')
    expect(recurringLabel('BIWEEKLY', 3)).toBe('Every 2 weeks on Wednesday')
    expect(recurringLabel('MONTHLY', 5)).toBe('Monthly on Friday')
  })
})

describe('createNextOccurrence', () => {
  const schedule = {
    id: 's1', isActive: true, nextMeetingDate: when, employeeId: employee.id, reporterId: reporter.id,
    durationMinutes: 15, meetingType: 'IN_PERSON', meetingLink: null, dayOfWeek: 1, timeOfDay: '06:00',
    frequency: 'WEEKLY', reporter: { timeZone: 'UTC' },
  }

  it('books the next occurrence as SCHEDULED and advances the schedule', async () => {
    prismaMock.recurringSchedule.findUnique.mockResolvedValue(schedule)
    prismaMock.meeting.create.mockResolvedValue({ id: 'next' })
    expect(await createNextOccurrence(prismaMock as never, 's1')).toBe('next')
    expect(prismaMock.meeting.create.mock.calls[0][0].data).toMatchObject({ status: 'SCHEDULED', meetingDate: when, durationMinutes: 15, recurringScheduleId: 's1' })
    const advanced = prismaMock.recurringSchedule.update.mock.calls[0][0].data.nextMeetingDate as Date
    expect(advanced.getTime() - when.getTime()).toBe(7 * 86_400_000)
  })

  it('does nothing when that occurrence exists or the schedule is paused', async () => {
    prismaMock.recurringSchedule.findUnique.mockResolvedValue(schedule)
    prismaMock.meeting.findFirst.mockResolvedValue({ id: 'already' })
    expect(await createNextOccurrence(prismaMock as never, 's1')).toBeNull()
    prismaMock.recurringSchedule.findUnique.mockResolvedValue({ ...schedule, isActive: false })
    expect(await createNextOccurrence(prismaMock as never, 's1')).toBeNull()
    expect(prismaMock.meeting.create).not.toHaveBeenCalled()
  })
})

describe('syncBookedMeetingToCalendar', () => {
  it('creates the event on the reporter calendar and accepts it as the employee', async () => {
    calendarsOn(reporter.id, employee.id)
    prismaMock.meeting.findUnique.mockResolvedValue(booked())
    vi.mocked(createCalendarEvent).mockResolvedValue({ eventId: 'ev1', calendarLink: 'x', hangoutLink: null })
    vi.mocked(acceptInvitationAs).mockResolvedValue('accepted')

    expect(await syncBookedMeetingToCalendar('m1')).toEqual({ calendar: 'created', rsvp: 'accepted' })
    expect(vi.mocked(createCalendarEvent).mock.calls[0].slice(0, 4)).toEqual(['m1', employee.email, reporter.email, reporter.id])
    expect(acceptInvitationAs).toHaveBeenCalledWith(employee.id, employee.email, 'ev1')
  })

  it('uses the existing series for a recurring occurrence', async () => {
    calendarsOn(reporter.id, employee.id)
    prismaMock.meeting.findUnique.mockResolvedValue(
      booked({ recurringScheduleId: 's1', recurringSchedule: { googleRecurringEventId: 'series', frequency: 'WEEKLY', reporter: { timeZone: 'UTC' } } })
    )
    vi.mocked(acceptInvitationAs).mockResolvedValue('accepted')
    expect(await syncBookedMeetingToCalendar('m1')).toEqual({ calendar: 'exists', rsvp: 'accepted' })
    expect(createRecurringCalendarEvent).not.toHaveBeenCalled()
    expect(acceptInvitationAs).toHaveBeenCalledWith(employee.id, employee.email, 'series')
  })

  it('creates the series when the schedule has none yet', async () => {
    calendarsOn(reporter.id)
    prismaMock.meeting.findUnique.mockResolvedValue(
      booked({ recurringScheduleId: 's1', recurringSchedule: { googleRecurringEventId: null, frequency: 'WEEKLY', reporter: { timeZone: 'Asia/Kolkata' } } })
    )
    vi.mocked(createRecurringCalendarEvent).mockResolvedValue({ eventId: 'series', calendarLink: null })
    // employee has no Google connection: event still created, RSVP skipped
    expect(await syncBookedMeetingToCalendar('m1')).toEqual({ calendar: 'created', rsvp: 'skipped' })
    expect(vi.mocked(createRecurringCalendarEvent).mock.calls[0].slice(0, 3)).toEqual(['s1', 'm1', reporter.id])
    expect(acceptInvitationAs).not.toHaveBeenCalled()
  })

  it('skips without a reporter calendar and never throws on Google errors', async () => {
    prismaMock.meeting.findUnique.mockResolvedValue(booked())
    calendarsOn()
    expect(await syncBookedMeetingToCalendar('m1')).toEqual({ calendar: 'no-calendar', rsvp: 'skipped' })
    calendarsOn(reporter.id)
    vi.mocked(createCalendarEvent).mockRejectedValue(new Error('google down'))
    expect(await syncBookedMeetingToCalendar('m1')).toEqual({ calendar: 'failed', rsvp: 'skipped' })
  })
})

describe('confirmPendingProposals', () => {
  const proposal = (extra: Record<string, unknown> = {}) => ({
    id: 'p1', meetingDate: when, durationMinutes: 15, recurringScheduleId: null, proposedById: reporter.id,
    employeeId: employee.id, employee, reporter, ...extra,
  })

  it('confirms future proposals, books them and tells the employee', async () => {
    prismaMock.meeting.findMany.mockResolvedValue([proposal()])
    prismaMock.meeting.updateMany.mockResolvedValue({ count: 1 })
    calendarsOn()

    expect(await confirmPendingProposals(now)).toEqual({ confirmed: 1, failed: 0 })
    expect(prismaMock.meeting.findMany.mock.calls[0][0].where).toMatchObject({ status: 'PROPOSED', meetingDate: { gte: now } })
    expect(prismaMock.meeting.updateMany.mock.calls[0][0]).toEqual({ where: { id: 'p1', status: 'PROPOSED' }, data: { status: 'SCHEDULED' } })
    expect(vi.mocked(sendMeetingBookedEmail).mock.calls.map((c) => c[0])).toEqual([employee.email])
  })

  it('also tells the manager when the employee had proposed the time, and creates the next recurring one', async () => {
    prismaMock.meeting.findMany.mockResolvedValue([proposal({ proposedById: employee.id, recurringScheduleId: 's1' })])
    prismaMock.meeting.updateMany.mockResolvedValue({ count: 1 })
    calendarsOn()
    await confirmPendingProposals(now)
    expect(vi.mocked(sendMeetingBookedEmail).mock.calls.map((c) => c[0])).toEqual([employee.email, reporter.email])
    expect(prismaMock.recurringSchedule.findUnique.mock.calls[0][0].where).toEqual({ id: 's1' })
  })

  it('skips a proposal someone accepted in the meantime', async () => {
    prismaMock.meeting.findMany.mockResolvedValue([proposal()])
    prismaMock.meeting.updateMany.mockResolvedValue({ count: 0 })
    expect(await confirmPendingProposals(now)).toEqual({ confirmed: 0, failed: 0 })
    expect(sendMeetingBookedEmail).not.toHaveBeenCalled()
  })
})

describe('watchCalendarRsvps', () => {
  it('alerts the manager once when the employee declines', async () => {
    calendarsOn(reporter.id, employee.id)
    prismaMock.meeting.findMany.mockResolvedValue([booked({ calendarEvent: { googleEventId: 'ev1' } })])
    vi.mocked(getAttendeeRsvp).mockResolvedValue('declined')
    prismaMock.meeting.updateMany.mockResolvedValue({ count: 1 })

    const res = await watchCalendarRsvps(now)
    expect(res).toMatchObject({ checked: 1, declined: 1 })
    expect(getAttendeeRsvp).toHaveBeenCalledWith(reporter.id, 'ev1', employee.email, undefined)
    expect(prismaMock.meeting.updateMany.mock.calls[0][0]).toEqual({ where: { id: 'm1', calendarDeclinedAt: null }, data: { calendarDeclinedAt: now } })
    expect(vi.mocked(sendCalendarDeclinedEmail).mock.calls[0].slice(0, 3)).toEqual([reporter.email, reporter.name, employee.name])

    // already flagged: no second alert
    vi.mocked(sendCalendarDeclinedEmail).mockClear()
    prismaMock.meeting.findMany.mockResolvedValue([booked({ calendarEvent: { googleEventId: 'ev1' }, calendarDeclinedAt: now })])
    expect((await watchCalendarRsvps(now)).declined).toBe(0)
    expect(sendCalendarDeclinedEmail).not.toHaveBeenCalled()
  })

  it('clears the flag when they accept again, and reads a series occurrence at the meeting time', async () => {
    calendarsOn(reporter.id)
    prismaMock.meeting.findMany.mockResolvedValue([
      booked({ calendarDeclinedAt: now, recurringScheduleId: 's1', recurringSchedule: { googleRecurringEventId: 'series', frequency: 'WEEKLY', reporter: { timeZone: 'UTC' } } }),
    ])
    vi.mocked(getAttendeeRsvp).mockResolvedValue('accepted')
    await watchCalendarRsvps(now)
    expect(getAttendeeRsvp).toHaveBeenCalledWith(reporter.id, 'series', employee.email, when)
    expect(prismaMock.meeting.update.mock.calls[0][0]).toEqual({ where: { id: 'm1' }, data: { calendarDeclinedAt: null } })
  })

  it('accepts a still-pending RSVP once per event, and creates a missing event', async () => {
    calendarsOn(reporter.id, employee.id)
    const series = { googleRecurringEventId: 'series', frequency: 'WEEKLY', reporter: { timeZone: 'UTC' } }
    prismaMock.meeting.findMany.mockResolvedValue([
      booked({ id: 'a', recurringScheduleId: 's1', recurringSchedule: series }),
      booked({ id: 'b', recurringScheduleId: 's1', recurringSchedule: series }),
      booked({ id: 'c' }),
    ])
    vi.mocked(getAttendeeRsvp).mockResolvedValue('needsAction')
    vi.mocked(acceptInvitationAs).mockResolvedValue('accepted')
    prismaMock.meeting.findUnique.mockResolvedValue(booked({ id: 'c' }))
    vi.mocked(createCalendarEvent).mockResolvedValue({ eventId: 'evc', calendarLink: 'x', hangoutLink: null })

    const res = await watchCalendarRsvps(now)
    expect(res).toMatchObject({ checked: 2, reaccepted: 1, eventsCreated: 1, errors: 0 })
    expect(vi.mocked(acceptInvitationAs).mock.calls.map((c) => c[2])).toEqual(['series', 'evc'])
  })

  it('skips managers without a calendar and keeps going after an error', async () => {
    calendarsOn(reporter.id)
    prismaMock.meeting.findMany.mockResolvedValue([
      booked({ id: 'x', reporterId: 'no-cal', calendarEvent: { googleEventId: 'e0' } }),
      booked({ id: 'y', calendarEvent: { googleEventId: 'e1' } }),
      booked({ id: 'z', calendarEvent: { googleEventId: 'e2' } }),
    ])
    vi.mocked(getAttendeeRsvp).mockRejectedValueOnce(new Error('quota')).mockResolvedValueOnce('accepted')
    expect(await watchCalendarRsvps(now)).toMatchObject({ checked: 2, errors: 1 })
    expect(vi.mocked(getAttendeeRsvp).mock.calls.map((c) => c[1])).toEqual(['e1', 'e2'])
  })
})
