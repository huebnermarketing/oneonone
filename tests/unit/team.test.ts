import { describe, it, expect } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'
import { admin, reporter, employee, ids } from '../helpers/fixtures'
import { getTeamUserIds, canActOnUser } from '@/lib/team'

describe('getTeamUserIds', () => {
  it('admin → null (no restriction)', async () => {
    expect(await getTeamUserIds(admin)).toBeNull()
    expect(prismaMock.user.findMany).not.toHaveBeenCalled()
  })
  it('employee → only self', async () => {
    expect(await getTeamUserIds(employee)).toEqual([ids.employee])
  })
  it('reporter → self + active direct reports', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: ids.employee }, { id: ids.otherEmployee }])
    expect(await getTeamUserIds(reporter)).toEqual([ids.reporter, ids.employee, ids.otherEmployee])
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: { reportsToId: ids.reporter, isActive: true },
      select: { id: true },
    })
  })
})

describe('canActOnUser', () => {
  it('admin and self always', async () => {
    expect(await canActOnUser(admin, ids.otherEmployee)).toBe(true)
    expect(await canActOnUser(employee, ids.employee)).toBe(true)
  })
  it('reporter on a direct report', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: ids.employee, reportsToId: ids.reporter })
    expect(await canActOnUser(reporter, ids.employee)).toBe(true)
  })
  it('employee on their own manager', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: ids.reporter, reportsToId: ids.admin }) // target
      .mockResolvedValueOnce({ reportsToId: ids.reporter }) // me
    expect(await canActOnUser(employee, ids.reporter)).toBe(true)
  })
  it('reporter on someone else\'s report → false', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: ids.otherEmployee, reportsToId: ids.otherReporter })
      .mockResolvedValueOnce({ reportsToId: ids.admin })
    expect(await canActOnUser(reporter, ids.otherEmployee)).toBe(false)
  })
  it('unknown target → false', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null)
    expect(await canActOnUser(reporter, ids.otherEmployee)).toBe(false)
  })
})
