import { describe, it, expect, vi } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'
import { meeting, ids } from '../helpers/fixtures'

vi.mock('@/lib/settings', () => ({ getPolicies: vi.fn(async () => ({ workingDays: [0, 1, 2, 3, 4, 5, 6] })) }))

import { acceptReschedule, dropReschedule, requestReschedule, rescheduleRole } from '@/lib/reschedule'
import { moveCalendarOccurrence, updateCalendarEvent } from '@/lib/google-calendar'
import { sendRescheduleAcceptedEmail, sendRescheduleDeclinedEmail, sendRescheduleRequestEmail } from '@/lib/email'

const now = new Date('2026-11-02T00:00:00.000Z')
const current = new Date('2026-11-03T06:00:00.000Z')
const next = new Date('2026-11-04T07:00:00.000Z')
const rep = { id: ids.reporter, name: 'Reporter', timeZone: 'UTC' }
const emp = { id: ids.employee, name: 'Employee', timeZone: 'UTC' }

const scheduled = (extra: Record<string, unknown> = {}) => ({
  ...meeting({ status: 'SCHEDULED', meetingDate: current }),
  durationMinutes: 30,
  rescheduleDate: null as Date | null,
  rescheduleDuration: null as number | null,
  rescheduleRequestedById: null as string | null,
  recurringSchedule: null as { googleRecurringEventId: string | null } | null,
  ...extra,
})
const pending = (extra: Record<string, unknown> = {}) =>
  scheduled({ rescheduleDate: next, rescheduleDuration: 15, rescheduleRequestedById: ids.employee, ...extra })

describe('rescheduleRole', () => {
  it('requester / responder / none', () => {
    const m = pending()
    expect(rescheduleRole(ids.employee, m as never)).toBe('requester')
    expect(rescheduleRole(ids.reporter, m as never)).toBe('responder')
    expect(rescheduleRole(ids.admin, m as never)).toBeNull()
    expect(rescheduleRole(ids.reporter, scheduled() as never)).toBeNull()
  })
})

describe('requestReschedule', () => {
  it('stores the request without moving the meeting and tells the other participant', async () => {
    prismaMock.meeting.findMany.mockResolvedValue([])
    prismaMock.meeting.update.mockImplementation(async (a: { data: unknown }) => ({ ...scheduled(), ...(a.data as object) }))
    await requestReschedule(scheduled() as never, emp, { meetingDate: next, durationMinutes: 15, reason: ' clash ' }, now)
    const data = prismaMock.meeting.update.mock.calls[0][0].data
    expect(data).toMatchObject({ rescheduleDate: next, rescheduleDuration: 15, rescheduleRequestedById: ids.employee, rescheduleReason: 'clash' })
    expect(data.meetingDate).toBeUndefined()
    expect(sendRescheduleRequestEmail).toHaveBeenCalledWith('reporter@example.com', 'Reporter', 'Employee', current, next, 15, ids.meeting, 'clash')
  })

  it('keeps the current length when none is given', async () => {
    prismaMock.meeting.findMany.mockResolvedValue([])
    prismaMock.meeting.update.mockResolvedValue(scheduled())
    await requestReschedule(scheduled() as never, rep, { meetingDate: next }, now)
    expect(prismaMock.meeting.update.mock.calls[0][0].data.rescheduleDuration).toBe(30)
  })

  it.each([
    ['not scheduled', () => requestReschedule({ ...scheduled(), status: 'PROPOSED' } as never, rep, { meetingDate: next }, now), 400],
    ['not a participant', () => requestReschedule(scheduled() as never, { id: ids.admin }, { meetingDate: next }, now), 403],
    ['in the past', () => requestReschedule(scheduled() as never, rep, { meetingDate: new Date('2026-11-01T00:00:00Z') }, now), 400],
    ['same time and length', () => requestReschedule(scheduled() as never, rep, { meetingDate: current, durationMinutes: 30 }, now), 400],
  ])('rejects: %s', async (_n, run, status) => {
    await expect(run()).rejects.toMatchObject({ status })
  })

  it('409 when the new time clashes with another meeting (itself excluded)', async () => {
    prismaMock.meeting.findMany.mockResolvedValue([
      { meetingDate: next, durationMinutes: 30, employeeId: ids.employee, reporterId: ids.otherReporter, employee: { name: 'Employee' }, reporter: { name: 'Other' } },
    ])
    await expect(requestReschedule(scheduled() as never, rep, { meetingDate: next }, now)).rejects.toMatchObject({ status: 409 })
    expect(prismaMock.meeting.findMany.mock.calls[0][0].where.id).toEqual({ not: ids.meeting })
  })
})

describe('acceptReschedule', () => {
  it('only the other participant can accept', async () => {
    await expect(acceptReschedule(pending() as never, emp, now)).rejects.toMatchObject({ status: 403 })
    await expect(acceptReschedule(scheduled() as never, rep, now)).rejects.toMatchObject({ status: 400 })
  })

  it('moves the meeting, re-arms reminders, clears the request, updates the one-off event, tells the requester', async () => {
    prismaMock.meeting.findMany.mockResolvedValue([])
    prismaMock.meeting.update.mockResolvedValue(scheduled())
    await acceptReschedule(pending({ calendarEvent: { googleEventId: 'ev-1' } }) as never, rep, now)
    expect(prismaMock.meeting.update.mock.calls[0][0].data).toMatchObject({
      meetingDate: next, durationMinutes: 15, reminder24hSent: false, reminderSent: false, rescheduleDate: null, rescheduleRequestedById: null,
    })
    expect(updateCalendarEvent).toHaveBeenCalledWith('ev-1', ids.reporter, next, 'Employee', 'Reporter', 15)
    expect(sendRescheduleAcceptedEmail).toHaveBeenCalledWith('employee@example.com', 'Employee', 'Reporter', next, 15, ids.meeting)
  })

  it('moves only that occurrence of a recurring series', async () => {
    prismaMock.meeting.findMany.mockResolvedValue([])
    prismaMock.meeting.update.mockResolvedValue(scheduled())
    await acceptReschedule(pending({ recurringSchedule: { googleRecurringEventId: 'series-1' } }) as never, rep, now)
    expect(moveCalendarOccurrence).toHaveBeenCalledWith('series-1', ids.reporter, current, next, 15)
    expect(updateCalendarEvent).not.toHaveBeenCalled()
  })

  it('refuses a requested time that has passed', async () => {
    await expect(acceptReschedule(pending() as never, rep, new Date('2026-11-05T00:00:00Z'))).rejects.toMatchObject({ status: 400 })
  })
})

describe('dropReschedule', () => {
  it('declined by the other participant → requester gets email + in-app', async () => {
    prismaMock.meeting.update.mockResolvedValue(scheduled())
    const r = await dropReschedule(pending() as never, rep)
    expect(r.withdrawn).toBe(false)
    expect(prismaMock.meeting.update.mock.calls[0][0].data).toMatchObject({ rescheduleDate: null })
    expect(sendRescheduleDeclinedEmail).toHaveBeenCalledWith('employee@example.com', 'Employee', 'Reporter', current, ids.meeting)
  })

  it('withdrawn by the requester → no email', async () => {
    prismaMock.meeting.update.mockResolvedValue(scheduled())
    expect((await dropReschedule(pending() as never, emp)).withdrawn).toBe(true)
    expect(sendRescheduleDeclinedEmail).not.toHaveBeenCalled()
  })

  it('outsiders cannot respond', async () => {
    await expect(dropReschedule(pending() as never, { id: ids.admin })).rejects.toMatchObject({ status: 403 })
  })
})
