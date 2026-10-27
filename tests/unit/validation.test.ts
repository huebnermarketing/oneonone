import { describe, it, expect } from 'vitest'
import { createMeetingSchema, updateMeetingSchema, meetingFormSchema, processRecordingSchema } from '@/lib/validation/meetings'
import { createRecurringScheduleSchema } from '@/lib/validation/recurring'
import { createTodoSchema } from '@/lib/validation/todos'
import { updateProfileSchema, importUsersSchema } from '@/lib/validation/users'
import { clearDataSchema, updateSettingsSchema } from '@/lib/validation/admin'
import { notificationsQuery, reportsQuery } from '@/lib/validation/misc'
import { ids } from '../helpers/fixtures'

const ok = <T>(r: { success: boolean; data?: T }) => {
  expect(r.success).toBe(true)
  return r.data as T
}
const fail = (r: { success: boolean }, ) => expect(r.success).toBe(false)

describe('meetings', () => {
  it('create: ZOOM requires a link; IN_PERSON does not', () => {
    fail(createMeetingSchema.safeParse({ employeeId: ids.employee, meetingDate: '2026-11-10T10:00:00Z', meetingType: 'ZOOM' }))
    const d = ok(createMeetingSchema.safeParse({ employeeId: ids.employee, meetingDate: '2026-11-10T10:00:00Z', meetingType: 'ZOOM', meetingLink: 'https://zoom.us/j/123456789' }))
    expect(d.meetingDate).toBeInstanceOf(Date)
    ok(createMeetingSchema.safeParse({ employeeId: ids.employee, meetingDate: '2026-11-10T10:00:00Z' }))
  })
  it('create: rejects bad uuid / date', () => {
    fail(createMeetingSchema.safeParse({ employeeId: 'nope', meetingDate: '2026-11-10T10:00:00Z' }))
    fail(createMeetingSchema.safeParse({ employeeId: ids.employee, meetingDate: 'tomorrowish' }))
  })
  it('update: status accepts only SCHEDULED/COMPLETED', () => {
    ok(updateMeetingSchema.safeParse({ status: 'COMPLETED' }))
    fail(updateMeetingSchema.safeParse({ status: 'CANCELLED' }))
    fail(updateMeetingSchema.safeParse({ status: 'PROPOSED' }))
  })
  it('form: draft defaults to false; all fields optional', () => {
    expect(ok(meetingFormSchema.safeParse({})).draft).toBe(false)
    expect(ok(meetingFormSchema.safeParse({ draft: true, goodNews: ' hi ' })).goodNews).toBe('hi')
  })
  it('process recording: totalChunks ≥ 1, duration default 0', () => {
    fail(processRecordingSchema.safeParse({ totalChunks: 0 }))
    expect(ok(processRecordingSchema.safeParse({ totalChunks: 3 })).duration).toBe(0)
  })
})

describe('recurring', () => {
  it('validates day/time formats and defaults frequency', () => {
    const d = ok(createRecurringScheduleSchema.safeParse({ employeeId: ids.employee, dayOfWeek: '3', timeOfDay: '15:30' }))
    expect(d.frequency).toBe('BIWEEKLY')
    expect(d.dayOfWeek).toBe(3)
    fail(createRecurringScheduleSchema.safeParse({ employeeId: ids.employee, dayOfWeek: 7, timeOfDay: '15:30' }))
    fail(createRecurringScheduleSchema.safeParse({ employeeId: ids.employee, dayOfWeek: 1, timeOfDay: '3pm' }))
  })
})

describe('todos', () => {
  it('requires title + assignee, defaults priority', () => {
    fail(createTodoSchema.safeParse({ title: '', assignedToId: ids.employee }))
    fail(createTodoSchema.safeParse({ title: 'x' }))
    expect(ok(createTodoSchema.safeParse({ title: 'x', assignedToId: ids.employee })).priority).toBe('MEDIUM')
    fail(createTodoSchema.safeParse({ title: 'x', assignedToId: ids.employee, priority: 'URGENT' }))
  })
})

describe('users / profile', () => {
  it('profile schema strips reportsToId and departmentId', () => {
    const d = ok(updateProfileSchema.safeParse({ name: 'Me', reportsToId: ids.reporter, departmentId: ids.admin }))
    expect(d).not.toHaveProperty('reportsToId')
    expect(d).not.toHaveProperty('departmentId')
  })
  it('profile phone needs ≥10 digits unless empty', () => {
    fail(updateProfileSchema.safeParse({ phone: '12345' }))
    ok(updateProfileSchema.safeParse({ phone: '+91 98765 43210' }))
    ok(updateProfileSchema.safeParse({ phone: '' }))
  })
  it('import: takes raw CSV text, commit optional', () => {
    fail(importUsersSchema.safeParse({ csv: '' }))
    expect(ok(importUsersSchema.safeParse({ csv: 'email\na@example.com' })).commit).toBeUndefined()
    expect(ok(importUsersSchema.safeParse({ csv: 'x', commit: true })).commit).toBe(true)
  })
})

describe('admin', () => {
  it('clear-data requires confirm === clearType', () => {
    fail(clearDataSchema.safeParse({ clearType: 'all', confirm: 'yes' }))
    expect(ok(clearDataSchema.safeParse({ clearType: 'todos', confirm: 'todos' })).keepCurrentUser).toBe(true)
  })
  it('settings: policy fields typed, reminder bounds enforced', () => {
    ok(updateSettingsSchema.safeParse({ cancelPolicy: 'ANY_PARTICIPANT', reminderHoursBefore: '48', employeeCanViewRecording: true }))
    fail(updateSettingsSchema.safeParse({ cancelPolicy: 'EVERYONE' }))
    fail(updateSettingsSchema.safeParse({ reminderHoursBefore: 0 }))
    fail(updateSettingsSchema.safeParse({ maxRecordingMins: 500 }))
  })
})

describe('query schemas', () => {
  it('notifications: pagination bounds + bool flags', () => {
    const d = ok(notificationsQuery.safeParse({ limit: '20', read: 'false', countOnly: '1' }))
    expect(d).toMatchObject({ limit: 20, offset: 0, read: false, countOnly: true })
    fail(notificationsQuery.safeParse({ limit: '0' }))
    fail(notificationsQuery.safeParse({ limit: 'abc' }))
  })
  it('reports: YYYY-MM-DD only; format enum', () => {
    ok(reportsQuery.safeParse({ startDate: '2026-01-01', format: 'csv' }))
    fail(reportsQuery.safeParse({ startDate: '01/01/2026' }))
    fail(reportsQuery.safeParse({ format: 'xlsx' }))
  })
})
