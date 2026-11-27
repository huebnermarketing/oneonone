import { describe, it, expect } from 'vitest'
import { UserRole } from '@prisma/client'
import { prismaMock } from '../helpers/prisma-mock'
import {
  listMeetingsPage,
  meetingScope,
  pageWindow,
  parsePage,
  parseTab,
  splitWindow,
  tabWhere,
  upcomingWhere,
} from '@/lib/meeting-list'

const now = new Date('2026-11-02T10:00:00Z')

describe('meeting-list helpers', () => {
  it('parses tab and page from query values', () => {
    expect(parseTab('recurring')).toBe('recurring')
    expect(parseTab(['one-time', 'all'])).toBe('one-time')
    expect(parseTab('bogus')).toBe('all')
    expect(parseTab(undefined)).toBe('all')
    expect(parsePage('3')).toBe(3)
    expect(parsePage('0')).toBe(1)
    expect(parsePage('-2')).toBe(1)
    expect(parsePage('abc')).toBe(1)
    expect(parsePage(undefined)).toBe(1)
  })

  it('clamps the page into range', () => {
    expect(pageWindow(1, 0, 15)).toEqual({ page: 1, pages: 1, offset: 0 })
    expect(pageWindow(3, 40, 15)).toEqual({ page: 3, pages: 3, offset: 30 })
    expect(pageWindow(9, 40, 15)).toEqual({ page: 3, pages: 3, offset: 30 })
  })

  it('scopes by role', () => {
    expect(meetingScope({ id: 'e', role: UserRole.EMPLOYEE })).toEqual({ employeeId: 'e' })
    expect(meetingScope({ id: 'r', role: UserRole.REPORTER })).toEqual({ OR: [{ employeeId: 'r' }, { reporterId: 'r' }] })
    expect(meetingScope({ id: 'a', role: UserRole.SUPER_ADMIN })).toEqual({})
  })

  it('filters tabs on the recurring schedule link', () => {
    expect(tabWhere('all')).toEqual({})
    expect(tabWhere('one-time')).toEqual({ recurringScheduleId: null })
    expect(tabWhere('recurring')).toEqual({ recurringScheduleId: { not: null } })
  })

  it('splits a window across upcoming then past', () => {
    // 20 upcoming: page 1 all upcoming, page 2 = 5 upcoming + 10 past, page 3 all past
    expect(splitWindow(0, 15, 20)).toEqual({ upcoming: { skip: 0, take: 15 }, rest: { skip: 0, take: 0 } })
    expect(splitWindow(15, 15, 20)).toEqual({ upcoming: { skip: 15, take: 5 }, rest: { skip: 0, take: 10 } })
    expect(splitWindow(30, 15, 20)).toEqual({ upcoming: { skip: 20, take: 0 }, rest: { skip: 10, take: 15 } })
    expect(splitWindow(0, 15, 0)).toEqual({ upcoming: { skip: 0, take: 0 }, rest: { skip: 0, take: 15 } })
  })
})

describe('listMeetingsPage', () => {
  const reporter = { id: 'r', role: UserRole.REPORTER }

  it('returns upcoming rows first, then past rows, with stats from counts', async () => {
    // all, total in tab, upcoming in tab, upcoming, completed, pending form
    for (const n of [30, 20, 18, 22, 7, 2]) prismaMock.meeting.count.mockResolvedValueOnce(n)
    prismaMock.meeting.findMany
      .mockResolvedValueOnce([{ id: 'u16' }, { id: 'u17' }, { id: 'u18' }])
      .mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }])

    const res = await listMeetingsPage({ user: reporter, tab: 'one-time', page: 2, now })

    expect(res.meetings.map((m) => m.id)).toEqual(['u16', 'u17', 'u18', 'p1', 'p2'])
    expect(res).toMatchObject({ total: 20, page: 2, offset: 15, pageSize: 15 })
    expect(res.stats).toEqual({ all: 30, upcoming: 22, completed: 7, pendingForm: 2 })

    const inTab = { AND: [meetingScope(reporter), { recurringScheduleId: null }] }
    const [upCall, restCall] = prismaMock.meeting.findMany.mock.calls.map((c) => c[0])
    expect(upCall).toMatchObject({
      where: { AND: [inTab, upcomingWhere(now)] },
      orderBy: [{ meetingDate: 'asc' }, { id: 'asc' }],
      skip: 15,
      take: 3,
    })
    expect(restCall).toMatchObject({
      where: { AND: [inTab, { NOT: upcomingWhere(now) }] },
      orderBy: [{ meetingDate: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 12,
    })
    // list rows never carry notes, form answers or emails
    expect(upCall.select.employee).toEqual({ select: { name: true } })
    expect(upCall.select).not.toHaveProperty('notes')
  })

  it('skips the queries it does not need and clamps a page past the end', async () => {
    for (const n of [5, 5, 5, 5, 0, 0]) prismaMock.meeting.count.mockResolvedValueOnce(n)
    prismaMock.meeting.findMany.mockResolvedValueOnce([{ id: 'a' }])

    const res = await listMeetingsPage({ user: reporter, tab: 'all', page: 4, now })

    expect(res.page).toBe(1)
    expect(prismaMock.meeting.findMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.meeting.findMany.mock.calls[0][0].orderBy).toEqual([{ meetingDate: 'asc' }, { id: 'asc' }])
  })

  it('counts pending forms as past, scheduled and not submitted', async () => {
    for (const n of [0, 0, 0, 0, 0, 0]) prismaMock.meeting.count.mockResolvedValueOnce(n)
    await listMeetingsPage({ user: { id: 'e', role: UserRole.EMPLOYEE }, tab: 'all', page: 1, now })
    expect(prismaMock.meeting.count.mock.calls[5][0].where).toEqual({
      AND: [{ employeeId: 'e' }, { status: 'SCHEDULED', meetingDate: { lt: now }, formSubmittedAt: null }],
    })
    expect(prismaMock.meeting.findMany).not.toHaveBeenCalled()
  })
})
