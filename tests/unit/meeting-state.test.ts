import { describe, it, expect, vi } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'
import { meeting, reporter, admin, ids } from '../helpers/fixtures'

vi.mock('@/lib/settings', () => ({
  getPolicies: vi.fn(async () => ({ requireFormBeforeComplete: true, cancelPolicy: 'REPORTER_AND_ADMIN' })),
}))
vi.mock('@/lib/notifications', () => ({
  notifyMeetingCancelled: vi.fn(async () => undefined),
  notifyMeetingCompleted: vi.fn(async () => undefined),
}))

import { assertTransition, completeMeeting, cancelMeeting } from '@/lib/meeting-state'
import { getPolicies } from '@/lib/settings'
import { notifyMeetingCancelled, notifyMeetingCompleted } from '@/lib/notifications'
import { sendMeetingCancelledEmail } from '@/lib/email'
import { deleteCalendarEvent } from '@/lib/google-calendar'
import { ApiError } from '@/lib/api'

describe('assertTransition', () => {
  it.each([
    ['PROPOSED', 'SCHEDULED'],
    ['PROPOSED', 'CANCELLED'],
    ['SCHEDULED', 'COMPLETED'],
    ['SCHEDULED', 'CANCELLED'],
  ] as const)('allows %s → %s', (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow()
  })

  it.each([
    ['PROPOSED', 'COMPLETED'],
    ['COMPLETED', 'CANCELLED'],
    ['COMPLETED', 'SCHEDULED'],
    ['CANCELLED', 'SCHEDULED'],
    ['CANCELLED', 'COMPLETED'],
    ['SCHEDULED', 'SCHEDULED'],
  ] as const)('rejects %s → %s with 400', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(ApiError)
    try {
      assertTransition(from, to)
    } catch (e) {
      expect((e as ApiError).status).toBe(400)
    }
  })
})

describe('completeMeeting', () => {
  it('blocks completion when the form is required and not submitted', async () => {
    const m = meeting({ status: 'SCHEDULED', formSubmittedAt: null })
    await expect(completeMeeting(m as never, reporter.id)).rejects.toMatchObject({ status: 400 })
    expect(prismaMock.meeting.update).not.toHaveBeenCalled()
  })

  it('completes when the form was submitted', async () => {
    const m = meeting({ status: 'SCHEDULED', formSubmittedAt: new Date() })
    prismaMock.meeting.update.mockResolvedValue({ ...m, status: 'COMPLETED' })
    const result = await completeMeeting(m as never, reporter.id)
    expect(result.status).toBe('COMPLETED')
    expect(prismaMock.meeting.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'COMPLETED' } }))
    expect(notifyMeetingCompleted).toHaveBeenCalledWith(ids.employee, 'Reporter', ids.meeting)
    expect(prismaMock.auditLog.create).toHaveBeenCalled()
  })

  it('completes without a form when the policy is off', async () => {
    vi.mocked(getPolicies).mockResolvedValueOnce({ requireFormBeforeComplete: false, cancelPolicy: 'REPORTER_AND_ADMIN' } as never)
    const m = meeting({ status: 'SCHEDULED', formSubmittedAt: null })
    prismaMock.meeting.update.mockResolvedValue({ ...m, status: 'COMPLETED' })
    await expect(completeMeeting(m as never, reporter.id)).resolves.toMatchObject({ status: 'COMPLETED' })
  })

  it('refuses to complete a PROPOSED meeting', async () => {
    const m = meeting({ status: 'PROPOSED', formSubmittedAt: new Date() })
    await expect(completeMeeting(m as never, reporter.id)).rejects.toMatchObject({ status: 400 })
  })
})

describe('cancelMeeting', () => {
  it('cancels a SCHEDULED meeting, removes the calendar event and notifies the other party', async () => {
    const m = meeting({ status: 'SCHEDULED', calendarEvent: { googleEventId: 'gcal-1' } })
    prismaMock.meeting.update.mockResolvedValue({ ...m, status: 'CANCELLED' })

    const result = await cancelMeeting(m as never, reporter, 'sick')

    expect(result.status).toBe('CANCELLED')
    expect(deleteCalendarEvent).toHaveBeenCalledWith('gcal-1', ids.reporter)
    // only the employee is notified when the reporter cancels
    expect(notifyMeetingCancelled).toHaveBeenCalledTimes(1)
    expect(notifyMeetingCancelled).toHaveBeenCalledWith(ids.employee, 'Reporter', m.meetingDate, ids.meeting)
    expect(sendMeetingCancelledEmail).toHaveBeenCalledWith('employee@example.com', 'Employee', 'Reporter', m.meetingDate, 'sick')
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ details: expect.objectContaining({ status: 'CANCELLED', reason: 'sick' }) }) })
    )
  })

  it('notifies both parties when an admin cancels', async () => {
    const m = meeting({ status: 'PROPOSED' })
    prismaMock.meeting.update.mockResolvedValue({ ...m, status: 'CANCELLED' })
    await cancelMeeting(m as never, admin)
    expect(notifyMeetingCancelled).toHaveBeenCalledTimes(2)
    expect(deleteCalendarEvent).not.toHaveBeenCalled()
  })

  it('does not notify excluded people (someone who has left)', async () => {
    const m = meeting({ status: 'PROPOSED' })
    prismaMock.meeting.update.mockResolvedValue({ ...m, status: 'CANCELLED' })
    await cancelMeeting(m as never, admin, 'left', { excludeUserIds: [ids.employee] })
    expect(notifyMeetingCancelled).toHaveBeenCalledTimes(1)
    expect(vi.mocked(notifyMeetingCancelled).mock.calls[0][0]).not.toBe(ids.employee)
  })

  it('refuses to cancel a COMPLETED meeting', async () => {
    await expect(cancelMeeting(meeting({ status: 'COMPLETED' }) as never, reporter)).rejects.toMatchObject({ status: 400 })
  })

  it('still succeeds when calendar deletion fails', async () => {
    const m = meeting({ status: 'SCHEDULED', calendarEvent: { googleEventId: 'gcal-1' } })
    prismaMock.meeting.update.mockResolvedValue({ ...m, status: 'CANCELLED' })
    vi.mocked(deleteCalendarEvent).mockRejectedValueOnce(new Error('google down'))
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(cancelMeeting(m as never, reporter)).resolves.toMatchObject({ status: 'CANCELLED' })
    expect(quiet).toHaveBeenCalledWith('[meeting-state] deleteCalendarEvent failed', expect.any(Error))
  })
})
