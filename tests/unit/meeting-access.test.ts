import { describe, it, expect, vi } from 'vitest'
import { meeting, admin, reporter, employee, otherReporter, otherEmployee, ids } from '../helpers/fixtures'

const policies = {
  cancelPolicy: 'REPORTER_AND_ADMIN',
  employeeCanViewRecording: false,
  employeeCanViewNotes: true,
}
vi.mock('@/lib/settings', () => ({ getPolicies: vi.fn(async () => policies) }))

import {
  isReceiver,
  canViewMeeting,
  canManageMeeting,
  canFillForm,
  canAccept,
  canSuggest,
  canCancel,
  canViewRecording,
  canViewNotes,
  assertAccess,
} from '@/lib/meeting-access'
import { ApiError } from '@/lib/api'

describe('isReceiver', () => {
  it('employee receives when the reporter proposed', () => {
    const m = meeting({ proposedById: ids.reporter })
    expect(isReceiver(employee, m)).toBe(true)
    expect(isReceiver(reporter, m)).toBe(false)
  })
  it('reporter receives when the employee proposed (after a suggest)', () => {
    const m = meeting({ proposedById: ids.employee })
    expect(isReceiver(reporter, m)).toBe(true)
    expect(isReceiver(employee, m)).toBe(false)
  })
  it('employee receives when a third party (admin) proposed', () => {
    const m = meeting({ proposedById: ids.admin })
    expect(isReceiver(employee, m)).toBe(true)
    expect(isReceiver(reporter, m)).toBe(false)
  })
  it('employee receives when proposedById is null', () => {
    expect(isReceiver(employee, meeting({ proposedById: null }))).toBe(true)
  })
})

describe('view / manage / form / accept / suggest', () => {
  const m = meeting()
  it('participants and admin can view; others cannot', () => {
    expect(canViewMeeting(employee, m)).toBe(true)
    expect(canViewMeeting(reporter, m)).toBe(true)
    expect(canViewMeeting(admin, m)).toBe(true)
    expect(canViewMeeting(otherReporter, m)).toBe(false)
    expect(canViewMeeting(otherEmployee, m)).toBe(false)
  })
  it('only the reporter or admin can manage', () => {
    expect(canManageMeeting(reporter, m)).toBe(true)
    expect(canManageMeeting(admin, m)).toBe(true)
    expect(canManageMeeting(employee, m)).toBe(false)
    expect(canManageMeeting(otherReporter, m)).toBe(false)
  })
  it('a reporter who is the employee in a meeting is not its manager', () => {
    const asEmployee = meeting({ employeeId: ids.reporter, reporterId: ids.otherReporter })
    expect(canManageMeeting(reporter, asEmployee)).toBe(false)
    expect(canFillForm(reporter, asEmployee)).toBe(true)
  })
  it('only the employee fills the form (not even admin)', () => {
    expect(canFillForm(employee, m)).toBe(true)
    expect(canFillForm(admin, m)).toBe(false)
    expect(canFillForm(reporter, m)).toBe(false)
  })
  it('accept = receiver or admin; suggest = any participant or admin', () => {
    expect(canAccept(employee, m)).toBe(true)
    expect(canAccept(reporter, m)).toBe(false)
    expect(canAccept(admin, m)).toBe(true)
    expect(canSuggest(employee, m)).toBe(true)
    expect(canSuggest(reporter, m)).toBe(true)
    expect(canSuggest(otherEmployee, m)).toBe(false)
  })
})

describe('policy-driven predicates', () => {
  const m = meeting()

  it('canCancel follows cancelPolicy; admin always', async () => {
    policies.cancelPolicy = 'ADMIN_ONLY'
    expect(await canCancel(admin, m)).toBe(true)
    expect(await canCancel(reporter, m)).toBe(false)
    expect(await canCancel(employee, m)).toBe(false)

    policies.cancelPolicy = 'REPORTER_AND_ADMIN'
    expect(await canCancel(reporter, m)).toBe(true)
    expect(await canCancel(employee, m)).toBe(false)
    expect(await canCancel(otherReporter, m)).toBe(false)

    policies.cancelPolicy = 'ANY_PARTICIPANT'
    expect(await canCancel(employee, m)).toBe(true)
    expect(await canCancel(reporter, m)).toBe(true)
    expect(await canCancel(otherEmployee, m)).toBe(false)
  })

  it('canViewRecording: reporter/admin always, employee per policy, outsiders never', async () => {
    policies.employeeCanViewRecording = false
    expect(await canViewRecording(reporter, m)).toBe(true)
    expect(await canViewRecording(admin, m)).toBe(true)
    expect(await canViewRecording(employee, m)).toBe(false)
    policies.employeeCanViewRecording = true
    expect(await canViewRecording(employee, m)).toBe(true)
    expect(await canViewRecording(otherEmployee, m)).toBe(false)
  })

  it('canViewNotes: employee per policy', async () => {
    policies.employeeCanViewNotes = true
    expect(await canViewNotes(employee, m)).toBe(true)
    policies.employeeCanViewNotes = false
    expect(await canViewNotes(employee, m)).toBe(false)
    expect(await canViewNotes(reporter, m)).toBe(true)
  })
})

describe('assertAccess', () => {
  it('throws a 403 ApiError when false', () => {
    expect(() => assertAccess(false, 'nope')).toThrow(ApiError)
    try {
      assertAccess(false, 'nope')
    } catch (e) {
      expect((e as ApiError).status).toBe(403)
      expect((e as ApiError).message).toBe('nope')
    }
    expect(() => assertAccess(true)).not.toThrow()
  })
})
