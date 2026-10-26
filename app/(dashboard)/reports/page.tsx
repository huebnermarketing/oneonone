import { requirePageRole } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { UserRole } from '@prisma/client'
import { ReportsClient } from './reports-client'

export default async function ReportsPage() {
  await requirePageRole([UserRole.REPORTER, UserRole.SUPER_ADMIN])

  const departments = await prisma.department.findMany({
    orderBy: { name: 'asc' },
  })

  return <ReportsClient departments={departments} />
}
