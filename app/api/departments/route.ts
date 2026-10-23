import { NextRequest, NextResponse } from 'next/server'
import { ADMIN, parseBody, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { logDepartmentCreated } from '@/lib/audit'
import { departmentSchema } from '@/lib/validation/users'

export const dynamic = 'force-dynamic'

// GET /api/departments - all departments with member counts (admin only)
export const GET = withApiAuth(ADMIN, async () => {
  const departments = await prisma.department.findMany({
    include: { _count: { select: { users: true } } },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(departments)
})

// POST /api/departments (admin only). Duplicate name -> 409 via wrapper.
export const POST = withApiAuth(ADMIN, async (req: NextRequest, { user: admin }) => {
  const { name } = await parseBody(req, departmentSchema)

  const department = await prisma.department.create({ data: { name } })

  await logDepartmentCreated(admin.id, department.id, { name })

  return NextResponse.json(department, { status: 201 })
})
