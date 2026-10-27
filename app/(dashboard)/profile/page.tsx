import { getCurrentUser } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { ProfileClient } from './profile-client'
import { isKekaManaged } from '@/lib/keka-sync'

export default async function ProfilePage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/auth/signin')

  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    include: {
      department: { select: { id: true, name: true } },
      reportsTo: { select: { id: true, name: true, email: true } },
    },
  })

  if (!user) redirect('/auth/signin')

  const [departments, managers] = await Promise.all([
    prisma.department.findMany({
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({
      where: {
        isActive: true,
        id: { not: currentUser.id },
        role: { in: ['REPORTER', 'SUPER_ADMIN'] },
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return (
    <ProfileClient
      kekaManaged={isKekaManaged(user)}
      user={{
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        phone: user.phone,
        title: user.title,
        role: user.role,
        departmentId: user.departmentId,
        reportsToId: user.reportsToId,
        country: user.country ?? null,
        timeZone: user.timeZone ?? null,
        workDayStart: user.workDayStart ?? null,
        workDayEnd: user.workDayEnd ?? null,
        department: user.department,
        reportsTo: user.reportsTo,
        createdAt: user.createdAt.toISOString(),
      }}
      departments={departments}
      managers={managers}
    />
  )
}
