import { requireRole } from '@/lib/auth-helpers'
import { UserRole } from '@prisma/client'
import { ScheduleMeetingClient } from './schedule-meeting-client'
import { prisma } from '@/lib/prisma'

export default async function NewMeetingPage() {
  const user = await requireRole([UserRole.REPORTER, UserRole.SUPER_ADMIN])
  const workHours = await prisma.user.findUnique({ where: { id: user.id }, select: { workDayStart: true, workDayEnd: true } })

  // Get employees that can be scheduled
  // For REPORTER: get their direct reports
  // For SUPER_ADMIN: get all active users except themselves
  const employees =
    user.role === UserRole.SUPER_ADMIN
      ? await prisma.user.findMany({
          where: { isActive: true, id: { not: user.id } },
          select: { id: true, name: true, email: true },
          orderBy: { name: 'asc' },
        })
      : await prisma.user.findMany({
          where: { isActive: true, reportsToId: user.id },
          select: { id: true, name: true, email: true },
          orderBy: { name: 'asc' },
        })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-dark-gray dark:text-white mb-2">
          Schedule Meeting
        </h1>
        <p className="text-medium-gray">One-time or recurring one-on-one with your team</p>
      </div>

      <ScheduleMeetingClient employees={employees} currentUserId={user.id} workDayStart={workHours?.workDayStart} workDayEnd={workHours?.workDayEnd} />
    </div>
  )
}
