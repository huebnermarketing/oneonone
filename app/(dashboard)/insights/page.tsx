import { requirePageRole } from '@/lib/auth-helpers'
import { UserRole } from '@prisma/client'
import { InsightsClient } from './insights-client'
import { prisma } from '@/lib/prisma'

export default async function InsightsPage() {
  const user = await requirePageRole([UserRole.REPORTER, UserRole.SUPER_ADMIN])

  // Get departments for filter
  const departments = await prisma.department.findMany({
    orderBy: { name: 'asc' },
  })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-dark-gray dark:text-white mb-1">
          Organization Insights
        </h1>
        <p className="text-sm sm:text-base text-medium-gray">
          Analytics and insights from meeting recordings across the organization
        </p>
      </div>

      <InsightsClient
        departments={departments}
        isSuperAdmin={user.role === UserRole.SUPER_ADMIN}
      />
    </div>
  )
}
