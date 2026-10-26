import { requirePageAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { DepartmentsClient } from './departments-client'

export default async function DepartmentsPage() {
  await requirePageAdmin()

  const departments = await prisma.department.findMany({
    include: {
      _count: {
        select: { users: true },
      },
    },
    orderBy: { name: 'asc' },
  })

  return <DepartmentsClient departments={departments} />
}
