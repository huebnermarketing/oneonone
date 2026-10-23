import { NextRequest, NextResponse } from 'next/server'
import { UserRole } from '@prisma/client'
import { badRequest, parseBody, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit'
import { onboardingSchema } from '@/lib/validation/users'

export const dynamic = 'force-dynamic'

/**
 * POST /api/onboarding
 * EMPLOYEE / REPORTER set their department and reporting manager on first login. Admins never onboard.
 */
export const POST = withApiAuth(async (req: NextRequest, { user }) => {
  // Super admins don't need onboarding (400, matching the previous behaviour)
  if (user.role === UserRole.SUPER_ADMIN) throw badRequest('Super admins do not need onboarding')

  const { departmentId, reportsToId } = await parseBody(req, onboardingSchema)

  // Manager must exist and be a Reporter or Super Admin
  const manager = await prisma.user.findUnique({ where: { id: reportsToId }, select: { role: true } })
  if (!manager || (manager.role !== UserRole.REPORTER && manager.role !== UserRole.SUPER_ADMIN)) {
    throw badRequest('Invalid reporting manager')
  }

  if (departmentId) {
    const department = await prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } })
    if (!department) throw badRequest('Invalid department')
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      departmentId: departmentId ?? null,
      reportsToId,
    },
  })

  await createAuditLog({
    userId: user.id,
    action: 'UPDATE',
    entityType: 'User',
    entityId: user.id,
    details: { onboarding: true, departmentId: departmentId ?? null, reportsToId },
  })

  return NextResponse.json({
    success: true,
    message: 'Onboarding completed successfully',
  })
})
