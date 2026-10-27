/**
 * Who may sign in (called from NextAuth's signIn callback after the domain check).
 *
 * - In the app and active → in (a stale Keka record is refreshed in the background).
 * - In the app but inactive → AccountInactive.
 * - Not in the app: INITIAL_ADMIN_EMAILS → in (bootstrap, never locked out); otherwise looked up
 *   in Keka and created if they are an active employee. Not in Keka / left → NotInKeka.
 *   Keka down → KekaUnavailable; Keka not configured → NotRegistered (an admin must add them).
 */
import { prisma } from './prisma'
import { isKekaConfigured } from './keka'
import { provisionFromKeka, refreshFromKeka, STALE_AFTER_MS } from './keka-sync'

export function initialAdminEmails(): Set<string> {
  return new Set(
    (process.env.INITIAL_ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  )
}

export type SignInDecision = true | `/auth/signin?error=${string}`

export async function signInGate(rawEmail: string, now = new Date()): Promise<SignInDecision> {
  const email = rawEmail.trim().toLowerCase()
  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { isActive: true, kekaSyncedAt: true },
  })
  if (existing) {
    if (!existing.isActive) return '/auth/signin?error=AccountInactive'
    if (isKekaConfigured() && (!existing.kekaSyncedAt || now.getTime() - existing.kekaSyncedAt.getTime() > STALE_AFTER_MS)) {
      void refreshFromKeka(email)
    }
    return true
  }
  if (initialAdminEmails().has(email)) return true

  switch (await provisionFromKeka(email)) {
    case 'created':
      return true
    case 'unavailable':
      return '/auth/signin?error=KekaUnavailable'
    case 'not_found':
    case 'relieved':
      return '/auth/signin?error=NotInKeka'
    default:
      return '/auth/signin?error=NotRegistered'
  }
}
