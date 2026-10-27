import { describe, it, expect } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'
import { ids } from '../helpers/fixtures'
import { assertNoConflict, overlaps } from '@/lib/meeting-conflicts'

const at = new Date('2026-11-02T10:00:00.000Z')
const min = (n: number) => new Date(at.getTime() + n * 60_000)

describe('overlaps', () => {
  it('back-to-back is not an overlap; any shared minute is', () => {
    expect(overlaps(at, 15, min(15), 30)).toBe(false)
    expect(overlaps(min(-30), 30, at, 15)).toBe(false)
    expect(overlaps(min(-15), 30, at, 15)).toBe(true) // 30-min meeting at 9:45 runs into 10:00
    expect(overlaps(at, 30, min(15), 15)).toBe(true)
  })
})

describe('assertNoConflict', () => {
  it('passes when nothing overlaps', async () => {
    prismaMock.meeting.findMany.mockResolvedValue([])
    await expect(assertNoConflict(ids.employee, ids.reporter, at, { durationMinutes: 15 })).resolves.toBeUndefined()
  })

  it('queries from (start - longest length) to the new end, both roles for both people', async () => {
    prismaMock.meeting.findMany.mockResolvedValue([])
    await assertNoConflict(ids.employee, ids.reporter, at, { durationMinutes: 15, excludeMeetingId: ids.meeting })
    const where = prismaMock.meeting.findMany.mock.calls[0][0].where
    expect(where.meetingDate).toEqual({ gt: min(-30), lt: min(15) })
    expect(where.status).toEqual({ in: ['PROPOSED', 'SCHEDULED'] })
    expect(where.id).toEqual({ not: ids.meeting })
    expect(where.OR).toEqual([
      { employeeId: ids.employee },
      { reporterId: ids.reporter },
      { employeeId: ids.reporter },
      { reporterId: ids.employee },
    ])
  })

  it('a 15-min meeting that ended before the new one starts is fine', async () => {
    prismaMock.meeting.findMany.mockResolvedValue([
      { meetingDate: min(-15), durationMinutes: 15, employeeId: ids.employee, reporterId: ids.otherReporter, employee: { name: 'E' }, reporter: { name: 'O' } },
    ])
    await expect(assertNoConflict(ids.employee, ids.reporter, at, { durationMinutes: 30 })).resolves.toBeUndefined()
  })

  it('throws 409 naming the busy person when the employee is double-booked', async () => {
    prismaMock.meeting.findMany.mockResolvedValue([
      { meetingDate: min(-15), durationMinutes: 30, employeeId: ids.employee, reporterId: ids.otherReporter, employee: { name: 'Employee' }, reporter: { name: 'Other' } },
    ])
    await expect(assertNoConflict(ids.employee, ids.reporter, at, { durationMinutes: 15 })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('Employee already has a meeting with Other'),
    })
  })

  it('throws 409 naming the reporter when the reporter is double-booked', async () => {
    prismaMock.meeting.findMany.mockResolvedValue([
      { meetingDate: at, durationMinutes: 15, employeeId: ids.otherEmployee, reporterId: ids.reporter, employee: { name: 'Someone' }, reporter: { name: 'Reporter' } },
    ])
    await expect(assertNoConflict(ids.employee, ids.reporter, at, { durationMinutes: 15 })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('Reporter already has a meeting with Someone'),
    })
  })
})
