import { UserRole, MeetingStatus } from '@prisma/client'

export const ids = {
  admin: '00000000-0000-4000-8000-000000000001',
  reporter: '00000000-0000-4000-8000-000000000002',
  employee: '00000000-0000-4000-8000-000000000003',
  otherReporter: '00000000-0000-4000-8000-000000000004',
  otherEmployee: '00000000-0000-4000-8000-000000000005',
  meeting: '00000000-0000-4000-8000-000000000010',
  calendarEvent: '00000000-0000-4000-8000-000000000020',
}

export const admin = { id: ids.admin, role: UserRole.SUPER_ADMIN, name: 'Admin', email: 'admin@example.com' }
export const reporter = { id: ids.reporter, role: UserRole.REPORTER, name: 'Reporter', email: 'reporter@example.com' }
export const employee = { id: ids.employee, role: UserRole.EMPLOYEE, name: 'Employee', email: 'employee@example.com' }
export const otherReporter = { id: ids.otherReporter, role: UserRole.REPORTER, name: 'Other', email: 'other@example.com' }
export const otherEmployee = { id: ids.otherEmployee, role: UserRole.EMPLOYEE, name: 'Someone', email: 'someone@example.com' }

/** A meeting between `reporter` and `employee`, proposed by the reporter. */
export function meeting(overrides: Partial<ReturnType<typeof baseMeeting>> = {}) {
  return { ...baseMeeting(), ...overrides }
}

function baseMeeting() {
  return {
    id: ids.meeting,
    employeeId: ids.employee,
    reporterId: ids.reporter,
    proposedById: ids.reporter,
    status: MeetingStatus.PROPOSED,
    meetingDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    formSubmittedAt: null as Date | null,
    recurringScheduleId: null as string | null,
    employee: { id: ids.employee, name: 'Employee', email: 'employee@example.com' },
    reporter: { id: ids.reporter, name: 'Reporter', email: 'reporter@example.com' },
    calendarEvent: null as { googleEventId: string } | null,
  }
}
