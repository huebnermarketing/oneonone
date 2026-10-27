import { describe, it, expect, vi } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'
import { ids, reporter, admin, employee, otherReporter } from '../helpers/fixtures'

vi.mock('@/lib/notifications', () => ({ notifyFormEdited: vi.fn(async () => undefined) }))

import { diffAnswers, missingRequired, pickAnswers } from '@/lib/form-fields'
import { editFormAnswers } from '@/lib/form-answers'
import { canEditFormAnswers } from '@/lib/meeting-access'
import { notifyFormEdited } from '@/lib/notifications'

const full = {
  checkInPersonal: 'a', checkInProfessional: 'b', priorityGoalProfessional: 'c', priorityGoalAgency: null,
  progressReport: 'd', goodNews: null, supportNeeded: null, priorityDiscussions: null, headsUp: null, anythingElse: null,
}
const submitted = { id: ids.meeting, employeeId: ids.employee, reporterId: ids.reporter, formSubmittedAt: new Date(), status: 'COMPLETED' }

describe('form-fields', () => {
  it('diff ignores "" vs null and whitespace, keeps form order', () => {
    expect(diffAnswers({ goodNews: '' }, { goodNews: null })).toEqual([])
    expect(diffAnswers(full, { ...full, progressReport: 'D', checkInPersonal: 'A' }).map((c) => c.field)).toEqual(['checkInPersonal', 'progressReport'])
    expect(diffAnswers({}, { goodNews: 'yay' })).toEqual([{ field: 'goodNews', before: null, after: 'yay' }])
  })
  it('missing required fields by title', () => {
    expect(missingRequired({ ...full, progressReport: '  ' })).toEqual(['Progress Report'])
  })
  it('pickAnswers normalises every field', () => {
    expect(pickAnswers({ goodNews: '' }).goodNews).toBeNull()
    expect(Object.keys(pickAnswers({}))).toHaveLength(10)
  })
})

describe('canEditFormAnswers', () => {
  it('owner or admin, only after submission, not when cancelled', () => {
    expect(canEditFormAnswers(reporter, submitted)).toBe(true)
    expect(canEditFormAnswers(admin, submitted)).toBe(true)
    expect(canEditFormAnswers(employee, submitted)).toBe(false)
    expect(canEditFormAnswers(otherReporter, submitted)).toBe(false)
    expect(canEditFormAnswers(reporter, { ...submitted, formSubmittedAt: null })).toBe(false)
    expect(canEditFormAnswers(reporter, { ...submitted, status: 'CANCELLED' })).toBe(false)
  })
})

describe('editFormAnswers', () => {
  it('saves only changed fields, records an EDITED revision, tells the employee', async () => {
    prismaMock.meeting.findUniqueOrThrow.mockResolvedValue(full)
    const changes = await editFormAnswers(submitted, reporter, { progressReport: 'better', goodNews: 'shipped' })
    expect(changes).toEqual([
      { field: 'progressReport', before: 'd', after: 'better' },
      { field: 'goodNews', before: null, after: 'shipped' },
    ])
    expect(prismaMock.meeting.update.mock.calls[0][0].data).toEqual({ progressReport: 'better', goodNews: 'shipped' })
    expect(prismaMock.meetingFormRevision.create.mock.calls[0][0].data).toMatchObject({ kind: 'EDITED', editedById: ids.reporter, meetingId: ids.meeting })
    expect(notifyFormEdited).toHaveBeenCalledWith(ids.employee, 'Reporter', 2, ids.meeting)
  })

  it('no change → nothing written', async () => {
    prismaMock.meeting.findUniqueOrThrow.mockResolvedValue(full)
    expect(await editFormAnswers(submitted, admin, { checkInPersonal: 'a' })).toEqual([])
    expect(prismaMock.meeting.update).not.toHaveBeenCalled()
  })

  it('cannot blank a required answer', async () => {
    prismaMock.meeting.findUniqueOrThrow.mockResolvedValue(full)
    await expect(editFormAnswers(submitted, reporter, { progressReport: '' })).rejects.toMatchObject({ status: 400 })
  })

  it('403 for others, 400 before submission', async () => {
    await expect(editFormAnswers(submitted, otherReporter, {})).rejects.toMatchObject({ status: 403 })
    await expect(editFormAnswers({ ...submitted, formSubmittedAt: null }, reporter, {})).rejects.toMatchObject({ status: 400 })
  })
})
