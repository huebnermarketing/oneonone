/**
 * Global test setup. Unit tests never touch a real database: `@/lib/prisma` is replaced with
 * the mock from tests/helpers/prisma-mock.ts, and the few modules that reach the network are stubbed.
 */
import { vi, beforeEach } from 'vitest'
import { prismaMock, resetPrismaMock } from './helpers/prisma-mock'

process.env.NEXTAUTH_SECRET ||= 'test-secret-for-unit-tests-only'
process.env.NEXTAUTH_URL ||= 'http://localhost:3000'
process.env.GOOGLE_CLIENT_ID ||= 'test-client-id'
process.env.GOOGLE_CLIENT_SECRET ||= 'test-client-secret'
process.env.GOOGLE_WORKSPACE_DOMAIN ||= 'example.com'
process.env.NODE_ENV ||= 'test'

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/email', () => {
  const senders = [
    'sendMeetingScheduledEmail', 'sendTodoAssignedEmail', 'sendTodoDueReminderEmail', 'sendFormSubmittedEmail',
    'sendMeetingProposalEmail', 'sendMeetingAcceptedEmail', 'sendProposalConfirmationEmail', 'sendMeetingReminderEmail',
    'sendFormReminderEmail', 'sendMeetingSuggestionEmail', 'sendRecurringScheduleUpdatedEmail', 'sendMeetingCancelledEmail',
    'sendRescheduleRequestEmail', 'sendRescheduleAcceptedEmail', 'sendRescheduleDeclinedEmail',
  ]
  return Object.fromEntries(senders.map((name) => [name, vi.fn(async () => undefined)]))
})
vi.mock('@/lib/google-calendar', () => ({
  deleteCalendarEvent: vi.fn(async () => undefined),
  createCalendarEvent: vi.fn(async () => undefined),
  createRecurringCalendarEvent: vi.fn(async () => undefined),
  updateCalendarEvent: vi.fn(async () => undefined),
  moveCalendarOccurrence: vi.fn(async () => true),
  cancelCalendarOccurrence: vi.fn(async () => true),
  setCalendarEventDuration: vi.fn(async () => undefined),
  isCalendarEnabled: vi.fn(async () => false),
}))

beforeEach(() => {
  resetPrismaMock()
})
