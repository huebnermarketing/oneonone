import { NextRequest, NextResponse } from 'next/server'
import { ADMIN, badRequest, conflict, notFound, parseBody, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { logUserUpdated, logUserDeleted } from '@/lib/audit'
import { ALLOWED_EMAIL_DOMAIN, isAllowedEmail } from '@/lib/constants'
import { updateUserSchema } from '@/lib/validation/users'
import { lockedFieldChanges, lockedMessage } from '@/lib/keka-sync'

export const dynamic = 'force-dynamic'

const userInclude = { department: true, reportsTo: true } as const

// GET /api/users/[id] (admin only)
export const GET = withApiAuth(ADMIN, async (_req: NextRequest, { params }) => {
  const user = await prisma.user.findUnique({ where: { id: params.id }, include: userInclude })
  if (!user) throw notFound('User')
  return NextResponse.json(user)
})

// PATCH /api/users/[id] (admin only). Omitted fields are untouched; null clears optional fields.
export const PATCH = withApiAuth(ADMIN, async (req: NextRequest, { user: admin, params }) => {
  const body = await parseBody(req, updateUserSchema)

  const existingUser = await prisma.user.findUnique({ where: { id: params.id } })
  if (!existingUser) throw notFound('User')

  // HR fields of Keka-synced users are owned by Keka (lib/keka-sync.ts)
  const locked = lockedFieldChanges(existingUser, body)
  if (locked.length > 0) throw badRequest(lockedMessage(locked))

  // Email change: domain + uniqueness
  if (body.email && body.email !== existingUser.email) {
    if (!isAllowedEmail(body.email)) {
      throw badRequest(`Only ${ALLOWED_EMAIL_DOMAIN} email addresses are allowed`)
    }
    const emailExists = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } })
    if (emailExists) throw conflict('Email already in use')
  }

  // Prevent circular reporting structure
  if (body.reportsToId) {
    if (body.reportsToId === params.id) throw badRequest('A user cannot report to themselves')
    const manager = await prisma.user.findUnique({ where: { id: body.reportsToId }, select: { reportsToId: true } })
    if (!manager) throw notFound('Manager')
    if (manager.reportsToId === params.id) throw badRequest('Cannot assign manager who reports to this user')
  }

  const updatedUser = await prisma.user.update({
    where: { id: params.id },
    data: {
      name: body.name,
      email: body.email,
      role: body.role,
      isActive: body.isActive,
      ...(body.departmentId !== undefined && { departmentId: body.departmentId }),
      ...(body.reportsToId !== undefined && { reportsToId: body.reportsToId }),
      ...(body.country !== undefined && { country: body.country || null }),
      ...(body.timeZone !== undefined && { timeZone: body.timeZone || null }),
      ...(body.workDayStart !== undefined && { workDayStart: body.workDayStart || null }),
      ...(body.workDayEnd !== undefined && { workDayEnd: body.workDayEnd || null }),
      ...(body.kekaEmployeeId !== undefined && { kekaEmployeeId: body.kekaEmployeeId || null }),
    },
    include: userInclude,
  })

  await logUserUpdated(admin.id, params.id, {
    changes: {
      name: body.name,
      email: body.email,
      role: body.role,
      departmentId: body.departmentId,
      reportsToId: body.reportsToId,
      isActive: body.isActive,
    },
  })

  return NextResponse.json(updatedUser)
})

/**
 * DELETE /api/users/[id] (admin only).
 * Removes the user and everything that hangs off them (meetings as employee/reporter and their
 * recordings/attachments/calendar events/todos, own todos, recurring schedules, audit logs) in one transaction.
 */
export const DELETE = withApiAuth(ADMIN, async (_req: NextRequest, { user: admin, params }) => {
  if (admin.id === params.id) throw badRequest('You cannot delete your own account')

  const user = await prisma.user.findUnique({ where: { id: params.id }, select: { id: true, email: true } })
  if (!user) throw notFound('User')

  await prisma.$transaction(async (tx) => {
    await tx.user.updateMany({ where: { reportsToId: params.id }, data: { reportsToId: null } })
    await tx.meeting.updateMany({ where: { proposedById: params.id }, data: { proposedById: null } })

    const userMeetings = await tx.meeting.findMany({
      where: { OR: [{ employeeId: params.id }, { reporterId: params.id }] },
      select: { id: true },
    })
    const meetingIds = userMeetings.map((m) => m.id)

    if (meetingIds.length > 0) {
      await tx.calendarEvent.deleteMany({ where: { meetingId: { in: meetingIds } } })
      await tx.meetingRecording.deleteMany({ where: { meetingId: { in: meetingIds } } })
      await tx.attachment.deleteMany({ where: { meetingId: { in: meetingIds } } })
      await tx.todo.deleteMany({ where: { meetingId: { in: meetingIds } } })
      await tx.meeting.deleteMany({ where: { id: { in: meetingIds } } })
    }

    await tx.todo.deleteMany({ where: { OR: [{ assignedToId: params.id }, { createdById: params.id }] } })
    await tx.recurringSchedule.deleteMany({ where: { OR: [{ reporterId: params.id }, { employeeId: params.id }] } })
    await tx.auditLog.deleteMany({ where: { userId: params.id } })
    await tx.user.delete({ where: { id: params.id } })
  })

  await logUserDeleted(admin.id, params.id, user.email)

  return NextResponse.json({ success: true })
})
