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

  // Get existing schedules (filter out soft-deleted ones)
  const schedules = await prisma.recurringSchedule.findMany({
    where: { reporterId: user.id, isActive: true },
    orderBy: { createdAt: 'desc' },
  })

  const now = new Date()
  // Add employee info and upcoming meeting count
  const schedulesWithEmployees = await Promise.all(
    schedules.map(async (schedule) => {
      const [employee, upcomingMeetingCount] = await Promise.all([
        prisma.user.findUnique({
          where: { id: schedule.employeeId },
          select: { id: true, name: true, email: true },
        }),
        prisma.meeting.count({
          where: {
            recurringScheduleId: schedule.id,
            status: MeetingStatus.SCHEDULED,
            meetingDate: { gt: now },
          },
        }),
      ])
      return {
        ...schedule,
        employee,
        upcomingMeetingCount,
        nextMeetingDate: schedule.nextMeetingDate?.toISOString() || null,
        createdAt: schedule.createdAt.toISOString(),
      }
    })
  )

  return (
    <RecurringSchedulesClient
      employees={employees}
      initialSchedules={schedulesWithEmployees}
      workingDays={(await getPolicies()).workingDays}
    />
  )
}
