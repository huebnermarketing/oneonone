/**
 * Reporting-hierarchy helpers. The hierarchy is one level deep (User.reportsToId); a REPORTER's
 * "team" is themselves plus their direct reports. SUPER_ADMIN sees everyone.
 */
import { UserRole } from '@prisma/client'
import { prisma } from './prisma'

export interface ActorRef {
  id: string
  role: UserRole
}

/** Ids of users whose data the actor may see. `null` means "no restriction" (admin). */
export async function getTeamUserIds(actor: ActorRef): Promise<string[] | null> {
  if (actor.role === UserRole.SUPER_ADMIN) return null
  if (actor.role === UserRole.EMPLOYEE) return [actor.id]
  const reports = await prisma.user.findMany({
    where: { reportsToId: actor.id, isActive: true },
    select: { id: true },
  })
  return [actor.id, ...reports.map((r) => r.id)]
}

/** True when `targetUserId` is the actor, one of their direct reports, or the actor's own manager. */
export async function canActOnUser(actor: ActorRef, targetUserId: string): Promise<boolean> {
  if (actor.role === UserRole.SUPER_ADMIN || actor.id === targetUserId) return true
  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { reportsToId: true, id: true } })
  if (!target) return false
  if (actor.role === UserRole.REPORTER && target.reportsToId === actor.id) return true
  // An employee may assign a follow-up to their own manager
  const me = await prisma.user.findUnique({ where: { id: actor.id }, select: { reportsToId: true } })
  return me?.reportsToId === targetUserId
}
