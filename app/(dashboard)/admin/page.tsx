import { requirePageAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { UserRole } from '@prisma/client'
import { UserManagement } from './user-management'
import { isKekaConfigured } from '@/lib/keka'
import { ALLOWED_EMAIL_DOMAIN } from '@/lib/constants'

/**
 * Admin → User Management. Departments, audit logs, backup, storage and settings are their own
 * pages in the sidebar; this page is only the user list and its actions.
 */
export default async function AdminPage() {
  const admin = await requirePageAdmin()

  const [users, departments, settings] = await Promise.all([
    prisma.user.findMany({
      include: { department: true, reportsTo: true },
      orderBy: { name: 'asc' },
    }),
    prisma.department.findMany({ orderBy: { name: 'asc' } }),
    prisma.systemSettings.findUnique({ where: { id: 'system' }, select: { kekaLastSyncAt: true } }),
  ])

  const reporters = users.filter((u) => u.isActive && (u.role === UserRole.REPORTER || u.role === UserRole.SUPER_ADMIN))

  return (
    <UserManagement
      users={users}
      departments={departments}
      reporters={reporters}
      currentUserId={admin.id}
      emailDomain={ALLOWED_EMAIL_DOMAIN}
      kekaConfigured={isKekaConfigured()}
      kekaLastSyncAt={settings?.kekaLastSyncAt?.toISOString() ?? null}
    />
  )
}
