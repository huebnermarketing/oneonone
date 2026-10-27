/**
 * API route helpers: one wrapper for auth + error handling, and zod-based input parsing.
 *
 * Usage:
 *   export const POST = withApiAuth([UserRole.REPORTER, UserRole.SUPER_ADMIN], async (req, { user, params }) => {
 *     const body = await parseBody(req, createMeetingSchema)
 *     ...
 *     return NextResponse.json(result)
 *   })
 *
 * - Throw `new ApiError(status, message)` anywhere inside the handler for a clean JSON error.
 * - `withApiAuth()` with no roles = any authenticated, active user.
 * - `withPublicRoute(handler)` = no auth, same error handling (health, webhooks, cron).
 */
import { NextRequest, NextResponse } from 'next/server'
import { UserRole } from '@prisma/client'
import { z, ZodError, ZodTypeAny } from 'zod'
import { getCurrentUser, ForbiddenError, UnauthorizedError } from './auth-helpers'

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message)
    this.name = 'ApiError'
  }
}

export const notFound = (what = 'Resource') => new ApiError(404, `${what} not found`)
export const forbidden = (message = 'Insufficient permissions') => new ApiError(403, message)
export const badRequest = (message: string, details?: unknown) => new ApiError(400, message, details)
export const conflict = (message: string) => new ApiError(409, message)

/** Next 15+: dynamic route params arrive as a Promise. */
type RouteContext = { params: Promise<Record<string, string>> }
type Handler = (req: NextRequest, ctx: { user: SessionUser; params: Record<string, string> }) => Promise<Response>
type PublicHandler = (req: NextRequest, ctx: { params: Record<string, string> }) => Promise<Response>

export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      error.details !== undefined ? { error: error.message, details: error.details } : { error: error.message },
      { status: error.status }
    )
  }
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // AI features with no provider key: tell the user what to fix instead of a generic 500
  if (error instanceof Error && error.name === 'AiNotConfiguredError') {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400 }
    )
  }
  // Prisma "record not found" from update/delete
  if (typeof error === 'object' && error && (error as { code?: string }).code === 'P2025') {
    return NextResponse.json({ error: 'Resource not found' }, { status: 404 })
  }
  // Prisma unique constraint
  if (typeof error === 'object' && error && (error as { code?: string }).code === 'P2002') {
    return NextResponse.json({ error: 'A record with these values already exists' }, { status: 409 })
  }
  console.error('[api] unhandled error:', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

/**
 * Wrap a route handler with authentication (+ optional role check) and uniform error mapping.
 * Pass `[]` or omit roles to allow any authenticated user.
 */
export function withApiAuth(roles: UserRole[], handler: Handler): (req: NextRequest, ctx: RouteContext) => Promise<Response>
export function withApiAuth(handler: Handler): (req: NextRequest, ctx: RouteContext) => Promise<Response>
export function withApiAuth(rolesOrHandler: UserRole[] | Handler, maybeHandler?: Handler) {
  const roles = Array.isArray(rolesOrHandler) ? rolesOrHandler : []
  const handler = (Array.isArray(rolesOrHandler) ? maybeHandler : rolesOrHandler) as Handler

  return async (req: NextRequest, ctx: RouteContext) => {
    try {
      const user = await getCurrentUser()
      if (!user) throw new UnauthorizedError()
      if (roles.length > 0 && !roles.includes(user.role)) throw new ForbiddenError()
      return await handler(req, { user, params: (await ctx.params) ?? {} })
    } catch (error) {
      return toErrorResponse(error)
    }
  }
}

/** Same error mapping, no session. For /api/health, webhooks and cron (which do their own secret check). */
export function withPublicRoute(handler: PublicHandler) {
  return async (req: NextRequest, ctx: RouteContext) => {
    try {
      return await handler(req, { params: (await ctx.params) ?? {} })
    } catch (error) {
      return toErrorResponse(error)
    }
  }
}

/** Parse + validate a JSON body. Invalid JSON and schema failures both become 400s. */
export async function parseBody<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.output<S>> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    throw badRequest('Request body must be valid JSON')
  }
  return schema.parse(raw)
}

/** Parse + validate URL search params (all values are strings; use z.coerce in schemas). */
export function parseQuery<S extends ZodTypeAny>(req: NextRequest, schema: S): z.output<S> {
  const obj: Record<string, string> = {}
  req.nextUrl.searchParams.forEach((v, k) => {
    obj[k] = v
  })
  return schema.parse(obj)
}

export const ADMIN = [UserRole.SUPER_ADMIN]
export const REPORTER_OR_ADMIN = [UserRole.REPORTER, UserRole.SUPER_ADMIN]
