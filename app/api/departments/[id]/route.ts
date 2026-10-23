import { NextRequest, NextResponse } from 'next/server'
import { ADMIN, notFound, parseBody, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { logDepartmentUpdated, logDepartmentDeleted } from '@/lib/audit'
import { departmentSchema } from '@/lib/validation/users'

export const dynamic = 'force-dynamic'

// GET /api/departments/[id] - department with its members (admin only)
export const GET = withApiAuth(ADMIN, async (_req: NextRequest, { params }) => {
  const department = await prisma.department.findUnique({
    where: { id: params.id },
    include: {
      _count: { select: { users: true } },
      users: { select: { id: true, name: true, email: true, role: true } },
    },
  })
  if (!department) throw notFound('Department')
  return NextResponse.json(department)
})

// PATCH /api/departments/[id] - rename (admin only). Missing -> 404, duplicate name -> 409 via wrapper.
export const PATCH = withApiAuth(ADMIN, async (req: NextRequest, { user: admin, params }) => {
  const { name } = await parseBody(req, departmentSchema)

  const department = await prisma.department.update({ where: { id: params.id }, data: { name } })

  await logDepartmentUpdated(admin.id, params.id, { name })

  return NextResponse.json(department)
})

// DELETE /api/departments/[id] (admin only). Detaches members and deletes in one transaction.
export const DELETE = withApiAuth(ADMIN, async (_req: NextRequest, { user: admin, params }) => {
  const existing = await prisma.department.findUnique({ where: { id: params.id }, select: { id: true, name: true } })
  if (!existing) throw notFound('Department')

  await prisma.$transaction(async (tx) => {
    await tx.user.updateMany({ where: { departmentId: params.id }, data: { departmentId: null } })
    await tx.department.delete({ where: { id: params.id } })
  })

  await logDepartmentDeleted(admin.id, params.id, { name: existing.name })

  return NextResponse.json({ success: true })
})
