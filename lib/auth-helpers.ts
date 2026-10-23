import { getServerSession } from 'next-auth'
import { authOptions } from './auth'
import { prisma } from './prisma'
import { UserRole } from '@prisma/client'
import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

// Custom error classes for API routes
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export async function getCurrentUser() {
  const session = await getServerSession(authOptions)
  const user = session?.user
  if (!user?.id) return null

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { isActive: true },
  })
  if (!dbUser || !dbUser.isActive) return null

  return user
}

// For page routes - redirects on failure
export async function requireAuth() {
  const session = await getServerSession(authOptions)
  const user = session?.user
  if (!user?.id) {
    redirect('/auth/signin')
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { isActive: true },
  })
  if (!dbUser || !dbUser.isActive) {
    redirect('/auth/signin?error=AccountInactive')
  }

  return user
}

// For API routes - THROWS UnauthorizedError / ForbiddenError (pair with handleApiError in catch).
// In a page component the thrown error renders the route's error boundary; prefer
// getCurrentUser() + redirect()/notFound() there.
export async function requireRole(allowedRoles: UserRole[]) {
  const user = await getCurrentUser()
  if (!user) {
    throw new UnauthorizedError('Not authenticated')
  }
  if (!allowedRoles.includes(user.role)) {
    throw new ForbiddenError('Insufficient permissions')
  }
  return user
}

// Same semantics as requireRole — throws, does not redirect.
export async function requireAdmin() {
  return requireRole([UserRole.SUPER_ADMIN])
}

// Standardized API error response helper
export function handleApiError(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  console.error('API error:', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export function canAccessEmployeeData(
  currentUserRole: UserRole,
  currentUserId: string,
  employeeId: string,
  employeeReportsToId?: string | null
): boolean {
  // Super admin can access all
  if (currentUserRole === UserRole.SUPER_ADMIN) {
    return true
  }

  // Users can access their own data
  if (currentUserId === employeeId) {
    return true
  }

  // Reporters can access their direct reports' data
  if (currentUserRole === UserRole.REPORTER && employeeReportsToId === currentUserId) {
    return true
  }

  return false
}
