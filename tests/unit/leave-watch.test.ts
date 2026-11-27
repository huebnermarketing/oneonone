import { describe, it, expect, vi } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'

vi.mock('@/lib/absences', async (orig) => {
  const real = await orig<typeof import('@/lib/absences')>()
  return { ...real, absencesForMeetings: vi.fn(async () => ({})), blockingAbsence: vi.fn(async () => null) }
})

import { recurringOccurrenceSkip, watchLeaveConflicts } from '@/lib/leave-watch'
import { absencesForMeetings, blockingAbsence } from '@/lib/absences'
import { cancelCalendarOccurrence } from '@/lib/google-calendar'
import { sendLeaveConflictEmail, sendMeetingSkippedEmail } from '@/lib/email'

const now = new Date('2026-11-27T06:00:00.000Z')
const when = new Date('2026-12-02T06:00:00.000Z')
const employee = { id: 'emp', name: 'Asha', email: 'asha@test.com' }
const reporter = { id: 'rep', name: 'Ravi', email: 'ravi@test.com' }
const booked = (extra: Record<string, unknown> = {}) => ({
  id: 'm1', meetingDate: when, durationMinutes: 30, employeeId: 'emp', reporterId: 'rep', leaveAlertedAt: null as Date | null, employee, reporter, ...extra,
})

describe('watchLeaveConflicts', () => {
  it('alerts the manager once when the employee is on approved leave', async () => {
    prismaMock.meeting.findMany.mockResolvedValue([booked()])
    vi.mocked(absencesForMeetings).mockResolvedValue({ m1: { employee: { date: '2026-12-02', kind: 'leave' } } })
    prismaMock.meeting.updateMany.mockResolvedValue({ count: 1 })

    expect(await watchLeaveConflicts(now)).toEqual({ checked: 1, alerted: 1, cleared: 0 })
    expect(prismaMock.meeting.findMany.mock.calls[0][0].where.meetingDate.lte).toEqual(new Date(now.getTime() + 14 * 86_400_000))
    expect(prismaMock.meeting.updateMany.mock.calls[0][0]).toEqual({ where: { id: 'm1', leaveAlertedAt: null }, data: { leaveAlertedAt: now } })
    expect(vi.mocked(sendLeaveConflictEmail).mock.calls[0].slice(0, 4)).toEqual([reporter.email, reporter.name, 'Asha', 'On leave'])
  })

  it('does not repeat, ignores pending leave, and clears when the leave is gone', async () => {
    prismaMock.meeting.findMany.mockResolvedValue([booked({ leaveAlertedAt: now })])
    vi.mocked(absencesForMeetings).mockResolvedValue({ m1: { employee: { date: '2026-12-02', kind: 'leave' } } })
    expect(await watchLeaveConflicts(now)).toEqual({ checked: 1, alerted: 0, cleared: 0 })
    expect(sendLeaveConflictEmail).not.toHaveBeenCalled()

    vi.mocked(absencesForMeetings).mockResolvedValue({ m1: { employee: { date: '2026-12-02', kind: 'pending' } } })
    expect(await watchLeaveConflicts(now)).toEqual({ checked: 1, alerted: 0, cleared: 1 })
    expect(prismaMock.meeting.update.mock.calls[0][0]).toEqual({ where: { id: 'm1' }, data: { leaveAlertedAt: null } })
  })

  it("tells the manager when it's their own holiday", async () => {
    prismaMock.meeting.findMany.mockResolvedValue([booked()])
    vi.mocked(absencesForMeetings).mockResolvedValue({ m1: { reporter: { date: '2026-12-02', kind: 'holiday' } } })
    prismaMock.meeting.updateMany.mockResolvedValue({ count: 1 })
    await watchLeaveConflicts(now)
    expect(vi.mocked(sendLeaveConflictEmail).mock.calls[0].slice(2, 4)).toEqual(['You', 'Holiday'])
  })
})

describe('recurringOccurrenceSkip', () => {
  const schedule = { id: 's1', reporterId: 'rep', employeeId: 'emp', durationMinutes: 30, googleRecurringEventId: 'series', reporter, employee }

  it('books normally when nobody is away', async () => {
    expect(await recurringOccurrenceSkip(schedule, when)).toEqual({ skipped: false })
    expect(cancelCalendarOccurrence).not.toHaveBeenCalled()
  })

  it('skips on leave: removes the Google occurrence and tells both', async () => {
    vi.mocked(blockingAbsence).mockResolvedValue({ who: 'employee', absence: { date: '2026-12-02', kind: 'leave', half: 'FIRST' } })
    expect(await recurringOccurrenceSkip(schedule, when)).toEqual({ skipped: true, reason: 'Asha: Half-day leave' })
    expect(cancelCalendarOccurrence).toHaveBeenCalledWith('series', 'rep', when)
    expect(vi.mocked(sendMeetingSkippedEmail).mock.calls.map((c) => [c[0], c[2]])).toEqual([[reporter.email, 'Asha'], [employee.email, 'Ravi']])
  })

  it('still skips when Google removal fails', async () => {
    vi.mocked(blockingAbsence).mockResolvedValue({ who: 'reporter', absence: { date: '2026-12-02', kind: 'holiday' } })
    vi.mocked(cancelCalendarOccurrence).mockRejectedValue(new Error('no token'))
    expect((await recurringOccurrenceSkip({ ...schedule }, when)).skipped).toBe(true)
  })
})
