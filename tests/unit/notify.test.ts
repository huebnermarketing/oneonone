import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/notifications', () => {
  const fns = [
    'createNotification', 'notifyFormReminder', 'notifyFormSubmitted', 'notifyMeetingAccepted', 'notifyMeetingCancelled',
    'notifyMeetingCompleted', 'notifyMeetingProposed', 'notifyMeetingReminder', 'notifyMeetingSuggested',
    'notifyRecordingReady', 'notifyTodoAssigned',
  ]
  return Object.fromEntries(fns.map((name) => [name, vi.fn(async () => undefined)]))
})

import * as notify from '@/lib/notify'
import * as email from '@/lib/email'
import * as inApp from '@/lib/notifications'

const date = new Date('2026-11-02T10:00:00Z')
const employee = { id: 'e1', email: 'emp@example.com', name: 'Emp' }
const reporter = { id: 'r1', email: 'rep@example.com', name: 'Rep' }

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('fanOut', () => {
  it('runs every delivery, never rejects, and reports + logs each failure once', async () => {
    const ok = vi.fn(async () => 'x')
    const res = await notify.fanOut('evt', 'id1', [
      ['a', ok],
      ['b', async () => { throw new Error('smtp down') }],
      ['c', () => { throw new Error('sync throw') }],
    ])
    expect(ok).toHaveBeenCalledTimes(1)
    expect(res).toEqual({ ok: false, failures: ['b', 'c'] })
    expect(errorSpy).toHaveBeenCalledTimes(2)
    expect(errorSpy.mock.calls[0][0]).toBe('[notify] evt b failed (id1):')
    expect(errorSpy.mock.calls[0][1]).toBe('smtp down')
  })

  it('ok when everything succeeds', async () => {
    expect(await notify.fanOut('evt', 'id', [['a', async () => 1]])).toEqual({ ok: true, failures: [] })
  })
})

describe('meeting events', () => {
  it('meetingProposed: email + in-app to employee, receipt to reporter only when asked', async () => {
    await notify.meetingProposed({ meetingId: 'm1', date, employee, reporter })
    expect(email.sendMeetingProposalEmail).toHaveBeenCalledWith('emp@example.com', 'Emp', 'Rep', date, 'm1', undefined)
    expect(inApp.notifyMeetingProposed).toHaveBeenCalledWith('e1', 'Rep', date, 'm1')
    expect(email.sendProposalConfirmationEmail).not.toHaveBeenCalled()

    await notify.meetingProposed({ meetingId: 'm1', date, employee, reporter, confirmToReporter: true, durationMinutes: 15 })
    expect(email.sendMeetingProposalEmail).toHaveBeenLastCalledWith('emp@example.com', 'Emp', 'Rep', date, 'm1', 15)
    expect(email.sendProposalConfirmationEmail).toHaveBeenCalledWith('rep@example.com', 'Rep', 'Emp', date, 'm1', 15)
  })

  it('falls back to a display name when the actor has none', async () => {
    await notify.meetingProposed({ meetingId: 'm1', date, employee, reporter: { email: 'r@x', name: '' } })
    expect(inApp.notifyMeetingProposed).toHaveBeenCalledWith('e1', 'Your manager', date, 'm1')
  })

  it('meetingTimeSuggested picks the proposal email when the proposer edits their own proposal', async () => {
    await notify.meetingTimeSuggested({ meetingId: 'm1', date, to: employee, from: reporter, isProposer: true })
    expect(email.sendMeetingProposalEmail).toHaveBeenCalledTimes(1)
    expect(email.sendMeetingSuggestionEmail).not.toHaveBeenCalled()

    await notify.meetingTimeSuggested({ meetingId: 'm1', date, to: reporter, from: employee, isProposer: false, durationMinutes: 30 })
    expect(email.sendMeetingSuggestionEmail).toHaveBeenCalledWith('rep@example.com', 'Rep', 'Emp', date, 'm1', 30)
    expect(inApp.notifyMeetingSuggested).toHaveBeenLastCalledWith('r1', 'Emp', date, 'm1')
  })

  it('meetingCancelled emails only recipients with an address, and not at all with email:false', async () => {
    await notify.meetingCancelled({ meetingId: 'm1', date, recipients: [employee, reporter], actorName: 'Admin', reason: 'sick' })
    expect(inApp.notifyMeetingCancelled).toHaveBeenCalledTimes(2)
    expect(email.sendMeetingCancelledEmail).toHaveBeenCalledWith('emp@example.com', 'Emp', 'Admin', date, 'sick')

    vi.clearAllMocks()
    await notify.meetingCancelled({ meetingId: 'm1', date, recipients: [{ id: 'e1' }], actorName: 'Rep', email: false })
    expect(inApp.notifyMeetingCancelled).toHaveBeenCalledWith('e1', 'Rep', date, 'm1')
    expect(email.sendMeetingCancelledEmail).not.toHaveBeenCalled()
  })

  it('meetingReminder: both parties in-app; emails gated by the policy flag', async () => {
    await notify.meetingReminder({ meetingId: 'm1', date, employee, reporter, hoursBefore: 24, email: false })
    expect(inApp.notifyMeetingReminder).toHaveBeenCalledWith('e1', 'Rep', date, 'm1', 24)
    expect(inApp.notifyMeetingReminder).toHaveBeenCalledWith('r1', 'Emp', date, 'm1', 24)
    expect(email.sendMeetingReminderEmail).not.toHaveBeenCalled()

    await notify.meetingReminder({ meetingId: 'm1', date, employee, reporter, hoursBefore: 24, email: true })
    expect(email.sendMeetingReminderEmail).toHaveBeenCalledTimes(2)
  })

  it('a failing email does not stop the in-app notification and is reported', async () => {
    vi.mocked(email.sendMeetingAcceptedEmail).mockRejectedValueOnce(new Error('smtp'))
    const res = await notify.meetingAccepted({ meetingId: 'm1', date, to: reporter, acceptorName: 'Emp' })
    expect(inApp.notifyMeetingAccepted).toHaveBeenCalledWith('r1', 'Emp', date, 'm1')
    expect(res).toEqual({ ok: false, failures: ['email'] })
  })
})

describe('other events', () => {
  it('formReminder emails only when enabled', async () => {
    await notify.formReminder({ meetingId: 'm1', date, employee, reporterName: 'Rep', email: false })
    expect(inApp.notifyFormReminder).toHaveBeenCalledWith('e1', 'Rep', date, 'm1')
    expect(email.sendFormReminderEmail).not.toHaveBeenCalled()
  })

  it('recurringScheduleUpdated formats the in-app time in 12h', async () => {
    await notify.recurringScheduleUpdated({
      scheduleId: 's1', employee, actorName: 'Rep', dayOfWeek: 1, timeOfDay: '14:30', frequency: 'WEEKLY', reporterTimeZone: 'Asia/Kolkata',
    })
    expect(email.sendRecurringScheduleUpdatedEmail).toHaveBeenCalledWith('emp@example.com', 'Emp', 'Rep', 1, '14:30', 'WEEKLY', 'Asia/Kolkata')
    expect(inApp.createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'e1', message: 'Rep updated your recurring meeting to Mondays at 2:30 PM.' }))
  })

  it('todoAssigned sends both channels', async () => {
    await notify.todoAssigned({ todo: { id: 't1', title: 'Ship', description: null, dueDate: null }, assignee: employee, creatorName: 'Rep' })
    expect(email.sendTodoAssignedEmail).toHaveBeenCalledWith('emp@example.com', 'Emp', 'Ship', null, null, 'Rep', 't1')
    expect(inApp.notifyTodoAssigned).toHaveBeenCalledWith('e1', 'Rep', 'Ship', 't1')
  })
})
