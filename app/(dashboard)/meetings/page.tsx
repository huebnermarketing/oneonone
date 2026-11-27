import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { Prisma, UserRole } from '@prisma/client'
import { listMeetingsPage, parsePage, parseTab } from '@/lib/meeting-list'
import { MeetingsClient } from './meetings-client'

export default async function MeetingsPage(props: {
  searchParams: Promise<{ tab?: string | string[]; page?: string | string[] }>
}) {
  const user = await getCurrentUser()
  if (!user) return null
  const searchParams = await props.searchParams
  const tab = parseTab(searchParams.tab)

  const scheduleWhere: Prisma.RecurringScheduleWhereInput =
    user.role === UserRole.EMPLOYEE
      ? { employeeId: user.id, isActive: true }
      : user.role === UserRole.REPORTER
        ? { reporterId: user.id, isActive: true }
        : { isActive: true }

  const [list, recurringSchedules] = await Promise.all([
    listMeetingsPage({ user, tab, page: parsePage(searchParams.page) }),
    prisma.recurringSchedule.findMany({
      where: scheduleWhere,
      select: {
        id: true,
        frequency: true,
        dayOfWeek: true,
        timeOfDay: true,
        isActive: true,
        nextMeetingDate: true,
        employee: { select: { id: true, name: true } },
        reporter: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return (
    <MeetingsClient
      meetings={list.meetings}
      total={list.total}
      offset={list.offset}
      pageSize={list.pageSize}
      stats={list.stats}
      tab={tab}
      recurringSchedules={recurringSchedules}
      currentUserId={user.id}
      userRole={user.role}
    />
  )
}
