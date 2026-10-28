import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { RecurringSchedulesClient } from './recurring-client'
import { getPolicies } from '@/lib/settings'
import { redirect } from 'next/navigation'
import { UserRole } from '@prisma/client'
import { MeetingStatus } from '@prisma/client'

export default async function RecurringSchedulesPage() {
  const user = await getCurrentUser()
  if (!user || user.role === UserRole.EMPLOYEE) {
    redirect('/meetings')
  }

  // Get team members
  const employees = user.role === UserRole.SUPER_ADMIN
    ? await prisma.user.findMany({
        where: { isActive: true, role: 'EMPLOYEE' },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
      })
    : await prisma.user.findMany({
        where: { reportsToId: user.id, isActive: true },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
      })

  // Active schedules with their employee, plus upcoming-meeting counts in ONE grouped query (no N+1)
  const now = new Date()
  const schedules = await prisma.recurringSchedule.findMany({
    where: { reporterId: user.id, isActive: true },
    orderBy: { createdAt: 'desc' },
    include: { employee: { select: { id: true, name: true, email: true } } },
  })
  const counts = schedules.length
    ? await prisma.meeting.groupBy({
        by: ['recurringScheduleId'],
        where: { recurringScheduleId: { in: schedules.map((s) => s.id) }, status: MeetingStatus.SCHEDULED, meetingDate: { gt: now } },
        _count: { _all: true },
      })
    : []
  const upcomingBySchedule = new Map(counts.map((c) => [c.recurringScheduleId, c._count._all]))
  const schedulesWithEmployees = schedules.map((schedule) => ({
    ...schedule,
    upcomingMeetingCount: upcomingBySchedule.get(schedule.id) ?? 0,
    nextMeetingDate: schedule.nextMeetingDate?.toISOString() || null,
    createdAt: schedule.createdAt.toISOString(),
  }))

  return (
    <RecurringSchedulesClient
      employees={employees}
      initialSchedules={schedulesWithEmployees}
      workingDays={(await getPolicies()).workingDays}
    />
  )
}
