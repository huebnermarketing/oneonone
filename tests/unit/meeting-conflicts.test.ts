import { describe, it, expect } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'
import { ids } from '../helpers/fixtures'
import { assertNoConflict } from '@/lib/meeting-conflicts'
import { MEETING_DURATION_MINUTES } from '@/lib/constants'

const at = new Date('2026-11-02T10:00:00.000Z')

describe('assertNoConflict', () => {
  it('passes when nothing overlaps', async () => {
    prismaMock.meeting.findFirst.mockResolvedValue(null)
    await expect(assertNoConflict(ids.employee, ids.reporter, at)).resolves.toBeUndefined()
  })

  it('queries a window one minute short of the meeting length on each side, both roles for both people', async () => {
    prismaMock.meeting.findFirst.mockResolvedValue(null)
    await assertNoConflict(ids.employee, ids.reporter, at, ids.meeting)
    const where = prismaMock.meeting.findFirst.mock.calls[0][0].where
    const ms = (MEETING_DURATION_MINUTES - 1) * 60 * 1000
    expect(where.meetingDate).toEqual({ gte: new Date(at.getTime() - ms), lte: new Date(at.getTime() + ms) })
    expect(where.status).toEqual({ in: ['PROPOSED', 'SCHEDULED'] })
    expect(where.id).toEqual({ not: ids.meeting })
    expect(where.OR).toEqual([
      { employeeId: ids.employee },
      { reporterId: ids.reporter },
      { employeeId: ids.reporter },
      { reporterId: ids.employee },
    ])
  })

  it('throws 409 naming the busy person when the employee is double-booked', async () => {
    prismaMock.meeting.findFirst.mockResolvedValue({
      employeeId: ids.employee,
      reporterId: ids.otherReporter,
      employee: { name: 'Employee' },
      reporter: { name: 'Other' },
    })
    await expect(assertNoConflict(ids.employee, ids.reporter, at)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('Employee already has a meeting with Other'),
    })
  })

  it('throws 409 naming the reporter when the reporter is double-booked', async () => {
    prismaMock.meeting.findFirst.mockResolvedValue({
      employeeId: ids.otherEmployee,
      reporterId: ids.reporter,
      employee: { name: 'Someone' },
      reporter: { name: 'Reporter' },
    })
    await expect(assertNoConflict(ids.employee, ids.reporter, at)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('Reporter already has a meeting with Someone'),
    })
  })
})
