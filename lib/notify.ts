/**
 * Event fan-out: one function per thing that happened, delivering every channel for it (in-app
 * notification + email) in parallel. Delivery is best effort — these functions never throw; each
 * failed channel is logged once as `[notify] <event> <channel> failed (<entity id>)` and reported
 * in the returned NotifyResult so callers that track errors (cron) can count them.
 *
 * Message wording lives in lib/notifications.ts (in-app) and lib/email.ts (email templates);
 * this module only decides who hears about what.
 */
import {
  sendFormReminderEmail,
  sendFormSubmittedEmail,
  sendMeetingAcceptedEmail,
  sendMeetingCancelledEmail,
  sendMeetingProposalEmail,
  sendMeetingReminderEmail,
  sendMeetingSuggestionEmail,
  sendProposalConfirmationEmail,
  sendRecurringScheduleUpdatedEmail,
  sendTodoAssignedEmail,
} from './email'
import {
  createNotification,
  notifyFormReminder,
  notifyFormSubmitted,
  notifyMeetingAccepted,
  notifyMeetingCancelled,
  notifyMeetingCompleted,
  notifyMeetingProposed,
  notifyMeetingReminder,
  notifyMeetingSuggested,
  notifyRecordingReady,
  notifyTodoAssigned,
} from './notifications'
import { DAY_NAMES } from './ui'

export interface Party {
  id: string
  email: string
  name: string | null
}

export interface NotifyResult {
  ok: boolean
  /** Labels of the channels that failed, e.g. ['email:employee'] */
  failures: string[]
}

type Delivery = [label: string, run: () => Promise<unknown>]

/** Run every delivery, never reject, log each failure once. Exported for tests. */
export async function fanOut(event: string, entityId: string, deliveries: Delivery[]): Promise<NotifyResult> {
  const settled = await Promise.allSettled(deliveries.map(([, run]) => Promise.resolve().then(run)))
  const failures: string[] = []
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') return
    const label = deliveries[i][0]
    failures.push(label)
    console.error(`[notify] ${event} ${label} failed (${entityId}):`, r.reason instanceof Error ? r.reason.message : r.reason)
  })
  return { ok: failures.length === 0, failures }
}

const displayName = (name: string | null | undefined, fallback: string) => name?.trim() || fallback

// ── Meetings ────────────────────────────────────────────────────────

/**
 * A new meeting was proposed to the employee (manual, recurring schedule, or cron's next occurrence).
 * `confirmToReporter` also emails the reporter a "you proposed…" receipt (manual proposals only).
 */
export function meetingProposed(args: {
  meetingId: string
  date: Date
  employee: Party
  reporter: Pick<Party, 'email' | 'name'>
  confirmToReporter?: boolean
}): Promise<NotifyResult> {
  const { meetingId, date, employee, reporter } = args
  const deliveries: Delivery[] = [
    ['email:employee', () => sendMeetingProposalEmail(employee.email, employee.name, reporter.name, date, meetingId)],
    ['in-app:employee', () => notifyMeetingProposed(employee.id, displayName(reporter.name, 'Your manager'), date, meetingId)],
  ]
  if (args.confirmToReporter) {
    deliveries.push(['email:reporter', () => sendProposalConfirmationEmail(reporter.email, reporter.name, employee.name, date, meetingId)])
  }
  return fanOut('meetingProposed', meetingId, deliveries)
}

/**
 * Someone moved a pending meeting to a new time. When the original proposer edits their own
 * proposal the other side gets a fresh proposal email; otherwise a "new time suggested" email.
 */
export function meetingTimeSuggested(args: { meetingId: string; date: Date; to: Party; from: Pick<Party, 'name'>; isProposer: boolean }): Promise<NotifyResult> {
  const { meetingId, date, to, from } = args
  const sendEmail = args.isProposer ? sendMeetingProposalEmail : sendMeetingSuggestionEmail
  return fanOut('meetingTimeSuggested', meetingId, [
    ['email', () => sendEmail(to.email, to.name, from.name, date, meetingId)],
    ['in-app', () => notifyMeetingSuggested(to.id, displayName(from.name, 'Someone'), date, meetingId)],
  ])
}

/** A proposal was accepted (or cron auto-scheduled the next recurring meeting); tell `to`. */
export function meetingAccepted(args: { meetingId: string; date: Date; to: Party; acceptorName: string | null; acceptorFallback?: string }): Promise<NotifyResult> {
  const { meetingId, date, to, acceptorName } = args
  return fanOut('meetingAccepted', meetingId, [
    ['email', () => sendMeetingAcceptedEmail(to.email, to.name, acceptorName, date, meetingId)],
    ['in-app', () => notifyMeetingAccepted(to.id, displayName(acceptorName, args.acceptorFallback ?? 'Your colleague'), date, meetingId)],
  ])
}

/** Meeting cancelled — every recipient gets an in-app notification, and an email unless `email: false`. */
export function meetingCancelled(args: {
  meetingId: string
  date: Date
  recipients: Array<Party | Pick<Party, 'id'>>
  actorName: string
  reason?: string | null
  email?: boolean
}): Promise<NotifyResult> {
  const { meetingId, date, actorName } = args
  const withEmail = args.email !== false
  const deliveries: Delivery[] = args.recipients.flatMap((p): Delivery[] => {
    const list: Delivery[] = [[`in-app:${p.id}`, () => notifyMeetingCancelled(p.id, actorName, date, meetingId)]]
    if (withEmail && 'email' in p) {
      list.push([`email:${p.id}`, () => sendMeetingCancelledEmail(p.email, p.name, actorName, date, args.reason ?? undefined)])
    }
    return list
  })
  return fanOut('meetingCancelled', meetingId, deliveries)
}

/** Reporter marked the meeting completed; the employee hears about it in-app. */
export function meetingCompleted(args: { meetingId: string; employeeId: string; reporterName: string | null }): Promise<NotifyResult> {
  return fanOut('meetingCompleted', args.meetingId, [
    ['in-app', () => notifyMeetingCompleted(args.employeeId, displayName(args.reporterName, 'Your manager'), args.meetingId)],
  ])
}

/** Reminder to both parties `hoursBefore` the meeting; emails only when `email` (the enableEmailReminders policy). */
export function meetingReminder(args: { meetingId: string; date: Date; employee: Party; reporter: Party; hoursBefore: number; email: boolean }): Promise<NotifyResult> {
  const { meetingId, date, employee, reporter, hoursBefore } = args
  const deliveries: Delivery[] = [
    ['in-app:employee', () => notifyMeetingReminder(employee.id, displayName(reporter.name, 'your manager'), date, meetingId, hoursBefore)],
    ['in-app:reporter', () => notifyMeetingReminder(reporter.id, displayName(employee.name, 'your team member'), date, meetingId, hoursBefore)],
  ]
  if (args.email) {
    deliveries.push(
      ['email:employee', () => sendMeetingReminderEmail(employee.email, employee.name, reporter.name, date, meetingId)],
      ['email:reporter', () => sendMeetingReminderEmail(reporter.email, reporter.name, employee.name, date, meetingId)]
    )
  }
  return fanOut('meetingReminder', meetingId, deliveries)
}

// ── Forms ───────────────────────────────────────────────────────────

/** Employee submitted the pre-meeting form for the first time; tell the reporter. */
export function formSubmitted(args: { meetingId: string; date: Date; reporter: Party; employeeName: string | null }): Promise<NotifyResult> {
  const { meetingId, date, reporter, employeeName } = args
  return fanOut('formSubmitted', meetingId, [
    ['email', () => sendFormSubmittedEmail(reporter.email, reporter.name, employeeName, date, meetingId)],
    ['in-app', () => notifyFormSubmitted(reporter.id, displayName(employeeName, 'Your team member'), meetingId)],
  ])
}

/** Nudge the employee to fill the form before the meeting; email only when `email`. */
export function formReminder(args: { meetingId: string; date: Date; employee: Party; reporterName: string | null; email: boolean }): Promise<NotifyResult> {
  const { meetingId, date, employee, reporterName } = args
  const deliveries: Delivery[] = [['in-app', () => notifyFormReminder(employee.id, displayName(reporterName, 'your manager'), date, meetingId)]]
  if (args.email) deliveries.push(['email', () => sendFormReminderEmail(employee.email, employee.name, reporterName, date, meetingId)])
  return fanOut('formReminder', meetingId, deliveries)
}

// ── Recurring schedules ─────────────────────────────────────────────

/** The reporter changed day/time/frequency of a recurring schedule; tell the employee. */
export function recurringScheduleUpdated(args: {
  scheduleId: string
  employee: Party
  actorName: string
  dayOfWeek: number
  timeOfDay: string
  frequency: string
  reporterTimeZone: string
}): Promise<NotifyResult> {
  const { employee, actorName, dayOfWeek, timeOfDay, frequency, reporterTimeZone } = args
  const [hh, mm] = timeOfDay.split(':').map(Number)
  const displayTime = `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}`
  return fanOut('recurringScheduleUpdated', args.scheduleId, [
    ['email', () => sendRecurringScheduleUpdatedEmail(employee.email, employee.name, actorName, dayOfWeek, timeOfDay, frequency, reporterTimeZone)],
    [
      'in-app',
      () =>
        createNotification({
          userId: employee.id,
          type: 'MEETING_SCHEDULED',
          title: 'Recurring Schedule Updated',
          message: `${actorName} updated your recurring meeting to ${DAY_NAMES[dayOfWeek]}s at ${displayTime}.`,
          link: '/meetings',
        }),
    ],
  ])
}

// ── Todos & recordings ──────────────────────────────────────────────

/** A todo was assigned to someone other than its creator. */
export function todoAssigned(args: {
  todo: { id: string; title: string; description: string | null; dueDate: Date | null }
  assignee: Party
  creatorName: string | null
}): Promise<NotifyResult> {
  const { todo, assignee, creatorName } = args
  return fanOut('todoAssigned', todo.id, [
    ['email', () => sendTodoAssignedEmail(assignee.email, assignee.name, todo.title, todo.description, todo.dueDate, creatorName, todo.id)],
    ['in-app', () => notifyTodoAssigned(assignee.id, displayName(creatorName, 'Someone'), todo.title, todo.id)],
  ])
}

/** Transcript + analysis are ready (first pipeline run or Fathom import). In-app only. */
export function recordingReady(args: { meetingId: string; userIds: string[] }): Promise<NotifyResult> {
  return fanOut('recordingReady', args.meetingId, [['in-app', () => notifyRecordingReady(args.userIds, args.meetingId)]])
}
