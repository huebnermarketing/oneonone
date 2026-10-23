import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { ApiError, parseBody, withPublicRoute } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'
import { testLoginSchema } from '@/lib/validation/misc'

export const dynamic = 'force-dynamic'

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60 // 30 days

/**
 * POST /api/auth/test-login { role }
 * Dev-only: finds/creates a @test.com user for the role and sets a real NextAuth session cookie.
 * Disabled in production unless ENABLE_TEST_LOGIN=true.
 */
export const POST = withPublicRoute(async (req: NextRequest) => {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_TEST_LOGIN !== 'true') {
    throw new ApiError(404, 'Not available')
  }

  const { allowed } = checkRateLimit(req, 'auth')
  if (!allowed) throw new ApiError(429, 'Too many requests')

  const { role } = await parseBody(req, testLoginSchema)
  const email = `test-${role.toLowerCase()}@test.com`

  let user = await prisma.user.findFirst({ where: { email, role } })
  if (!user) {
    user = await prisma.user.create({
      data: { email, name: `Test ${role.replace('_', ' ')}`, role, isActive: true },
    })
  }

  // Session token in NextAuth's database-session format
  const sessionToken = randomBytes(32).toString('base64url')
  await prisma.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
    },
  })

  const response = NextResponse.json({
    success: true,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  })

  const cookieName =
    process.env.NODE_ENV === 'production' ? '__Secure-next-auth.session-token' : 'next-auth.session-token'
  response.cookies.set(cookieName, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: '/',
  })

  return response
})
