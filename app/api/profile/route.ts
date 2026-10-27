import { NextRequest, NextResponse } from 'next/server'
import { badRequest, notFound, parseBody, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit'
import { updateProfileSchema } from '@/lib/validation/users'
import { lockedFieldChanges, lockedMessage } from '@/lib/keka-sync'

export const dynamic = 'force-dynamic'

const profileSelect = {
  id: true,
  name: true,
  email: true,
  avatar: true,
  phone: true,
  title: true,
  bio: true,
  role: true,
  departmentId: true,
  reportsToId: true,
  country: true,
  timeZone: true,
  workDayStart: true,
  workDayEnd: true,
  department: { select: { id: true, name: true } },
  reportsTo: { select: { id: true, name: true, email: true } },
  createdAt: true,
} as const

export const GET = withApiAuth(async (_req: NextRequest, { user }) => {
  const profile = await prisma.user.findUnique({ where: { id: user.id }, select: profileSelect })
  if (!profile) throw notFound('User')
  return NextResponse.json(profile)
})

/**
 * PATCH /api/profile — self-service fields only.
 * Reporting manager and department are set during onboarding and afterwards only by an admin
 * (they decide who can see this user's meetings and recordings).
 */
export const PATCH = withApiAuth(async (req: NextRequest, { user }) => {
  const body = await parseBody(req, updateProfileSchema)

  const current = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true, title: true, phone: true, country: true, kekaSyncedAt: true } })
  if (current) {
    const locked = lockedFieldChanges(current, body)
    if (locked.length > 0) throw badRequest(lockedMessage(locked))
  }

  const data: Record<string, string | null> = {}
  if (body.name !== undefined) data.name = body.name
  if (body.phone !== undefined) data.phone = body.phone || null
  if (body.title !== undefined) data.title = body.title || null
  if (body.bio !== undefined) data.bio = body.bio || null
  if (body.country !== undefined) data.country = body.country || null
  if (body.timeZone !== undefined) data.timeZone = body.timeZone || null
  if (body.workDayStart !== undefined) data.workDayStart = body.workDayStart || null
  if (body.workDayEnd !== undefined) data.workDayEnd = body.workDayEnd || null

  const updated = await prisma.user.update({ where: { id: user.id }, data, select: profileSelect })

  await createAuditLog({ userId: user.id, action: 'UPDATE', entityType: 'User', entityId: user.id, details: { profile: data } })

  return NextResponse.json(updated)
})
