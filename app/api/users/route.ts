import { NextRequest, NextResponse } from 'next/server'
import { ADMIN, badRequest, parseBody, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { logUserCreated } from '@/lib/audit'
import { ALLOWED_EMAIL_DOMAIN, isAllowedEmail } from '@/lib/constants'
import { createUserSchema } from '@/lib/validation/users'

export const dynamic = 'force-dynamic'

const userInclude = { department: true, reportsTo: true } as const

// GET /api/users - all users (admin only)
export const GET = withApiAuth(ADMIN, async () => {
  const users = await prisma.user.findMany({
    include: userInclude,
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(users)
})

// POST /api/users - create a user (admin only). Duplicate email -> 409 via wrapper.
export const POST = withApiAuth(ADMIN, async (req: NextRequest, { user: admin }) => {
  const body = await parseBody(req, createUserSchema)

  if (!isAllowedEmail(body.email)) {
    throw badRequest(`Only ${ALLOWED_EMAIL_DOMAIN} email addresses are allowed`)
  }

  const user = await prisma.user.create({
    data: {
      email: body.email,
      name: body.name,
      role: body.role,
      departmentId: body.departmentId ?? null,
      reportsToId: body.reportsToId ?? null,
      country: body.country ?? null,
      timeZone: body.timeZone ?? null,
      workDayStart: body.workDayStart ?? null,
      workDayEnd: body.workDayEnd ?? null,
    },
  })

  await logUserCreated(admin.id, user.id, { email: user.email, name: user.name, role: user.role })

  return NextResponse.json(user, { status: 201 })
})
