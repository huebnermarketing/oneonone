import { MeetingStatus, Prisma, UserRole } from '@prisma/client'
import { prisma } from './prisma'

/**
 * Server-side paging for the Meetings page. The list order is "upcoming first (nearest first), then
 * everything else (most recent first)", so a page window is split across two ordered queries
 * instead of loading every meeting and sorting in the browser.
 */

export const MEETINGS_PAGE_SIZE = 15
export const MEETING_TABS = ['all', 'one-time', 'recurring'] as const
export type MeetingTab = (typeof MEETING_TABS)[number]

const UPCOMING_STATUSES: MeetingStatus[] = ['SCHEDULED', 'PROPOSED']

export function parseTab(value: string | string[] | undefined): MeetingTab {
  const v = Array.isArray(value) ? value[0] : value
  return (MEETING_TABS as readonly string[]).includes(v ?? '') ? (v as MeetingTab) : 'all'
}

/** 1-based page number from a query value; anything invalid is page 1. */
export function parsePage(value: string | string[] | undefined): number {
  const v = Array.isArray(value) ? value[0] : value
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

/** Clamp a requested page into [1, last page] and return its offset. */
export function pageWindow(page: number, total: number, pageSize: number) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(1, page), pages)
  return { page: current, pages, offset: (current - 1) * pageSize }
}

/** Which meetings a user sees on the list: employee → theirs, reporter → either side, admin → all. */
export function meetingScope(user: { id: string; role: UserRole }): Prisma.MeetingWhereInput {
  if (user.role === UserRole.EMPLOYEE) return { employeeId: user.id }
  if (user.role === UserRole.REPORTER) return { OR: [{ employeeId: user.id }, { reporterId: user.id }] }
  return {}
}

export function tabWhere(tab: MeetingTab): Prisma.MeetingWhereInput {
  if (tab === 'one-time') return { recurringScheduleId: null }
  if (tab === 'recurring') return { recurringScheduleId: { not: null } }
  return {}
}

export function upcomingWhere(now: Date): Prisma.MeetingWhereInput {
  return { meetingDate: { gte: now }, status: { in: UPCOMING_STATUSES } }
}

/**
 * Split the window [offset, offset + limit) of the combined list [upcoming…, rest…] into the slice
 * taken from each part.
 */
export function splitWindow(offset: number, limit: number, upcomingTotal: number) {
  const upcomingTake = Math.max(0, Math.min(limit, upcomingTotal - offset))
  return {
    upcoming: { skip: Math.min(offset, upcomingTotal), take: upcomingTake },
    rest: { skip: Math.max(0, offset - upcomingTotal), take: limit - upcomingTake },
  }
}

/** Only what a list row renders. */
export const meetingListSelect = {
  id: true,
  meetingDate: true,
  status: true,
  formSubmittedAt: true,
  employeeId: true,
  recurringScheduleId: true,
  durationMinutes: true,
  rescheduleDate: true,
  employee: { select: { name: true } },
  reporter: { select: { name: true } },
} satisfies Prisma.MeetingSelect

export type MeetingListRow = Prisma.MeetingGetPayload<{ select: typeof meetingListSelect }>

export interface MeetingListStats {
  /** Every meeting the user can see (all tabs) — 0 means the empty state. */
  all: number
  upcoming: number
  completed: number
  pendingForm: number
}

export interface MeetingListPage {
  meetings: MeetingListRow[]
  /** Meetings in the current tab. */
  total: number
  page: number
  pageSize: number
  offset: number
  stats: MeetingListStats
}

export async function listMeetingsPage(opts: {
  user: { id: string; role: UserRole }
  tab: MeetingTab
  page: number
  now?: Date
  pageSize?: number
}): Promise<MeetingListPage> {
  const now = opts.now ?? new Date()
  const pageSize = opts.pageSize ?? MEETINGS_PAGE_SIZE
  const scope = meetingScope(opts.user)
  const inTab: Prisma.MeetingWhereInput = { AND: [scope, tabWhere(opts.tab)] }
  const up = upcomingWhere(now)

  const [all, total, upcomingInTab, upcoming, completed, pendingForm] = await Promise.all([
    prisma.meeting.count({ where: scope }),
    prisma.meeting.count({ where: inTab }),
    prisma.meeting.count({ where: { AND: [inTab, up] } }),
    prisma.meeting.count({ where: { AND: [scope, up] } }),
    prisma.meeting.count({ where: { AND: [scope, { status: 'COMPLETED' }] } }),
    prisma.meeting.count({
      where: { AND: [scope, { status: 'SCHEDULED', meetingDate: { lt: now }, formSubmittedAt: null }] },
    }),
  ])

  const { page, offset } = pageWindow(opts.page, total, pageSize)
  const w = splitWindow(offset, pageSize, upcomingInTab)

  const [upcomingRows, restRows] = await Promise.all([
    w.upcoming.take > 0
      ? prisma.meeting.findMany({
          where: { AND: [inTab, up] },
          orderBy: [{ meetingDate: 'asc' }, { id: 'asc' }],
          skip: w.upcoming.skip,
          take: w.upcoming.take,
          select: meetingListSelect,
        })
      : Promise.resolve([] as MeetingListRow[]),
    w.rest.take > 0 && total - upcomingInTab > w.rest.skip
      ? prisma.meeting.findMany({
          where: { AND: [inTab, { NOT: up }] },
          orderBy: [{ meetingDate: 'desc' }, { id: 'desc' }],
          skip: w.rest.skip,
          take: w.rest.take,
          select: meetingListSelect,
        })
      : Promise.resolve([] as MeetingListRow[]),
  ])

  return {
    meetings: [...upcomingRows, ...restRows],
    total,
    page,
    pageSize,
    offset,
    stats: { all, upcoming, completed, pendingForm },
  }
}
