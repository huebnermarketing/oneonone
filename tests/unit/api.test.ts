import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { z, ZodError } from 'zod'
import { admin, employee, reporter } from '../helpers/fixtures'

vi.mock('@/lib/auth-helpers', async (orig) => {
  const actual = await orig<typeof import('@/lib/auth-helpers')>()
  return { ...actual, getCurrentUser: vi.fn() }
})

import { getCurrentUser } from '@/lib/auth-helpers'
import { withApiAuth, withPublicRoute, toErrorResponse, parseBody, parseQuery, ApiError, badRequest, notFound } from '@/lib/api'
import { UserRole } from '@prisma/client'

const req = (url = 'http://localhost/api/x', init?: RequestInit) => new NextRequest(url, init)
const json = async (r: Response) => ({ status: r.status, body: await r.json() })

describe('toErrorResponse', () => {
  it.each([
    [new ApiError(418, 'teapot'), 418, 'teapot'],
    [notFound('Meeting'), 404, 'Meeting not found'],
    [badRequest('bad'), 400, 'bad'],
    [{ code: 'P2025' }, 404, 'Resource not found'],
    [{ code: 'P2002' }, 409, 'A record with these values already exists'],
    [new Error('boom'), 500, 'Internal server error'],
  ])('maps %o → %i', async (err, status, message) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await json(toErrorResponse(err))
    expect(r.status).toBe(status)
    expect(r.body.error).toBe(message)
  })

  it('maps zod errors to 400 with field details', async () => {
    let zerr: ZodError
    try {
      z.object({ a: z.string() }).parse({ a: 1 })
    } catch (e) {
      zerr = e as ZodError
    }
    const r = await json(toErrorResponse(zerr!))
    expect(r.status).toBe(400)
    expect(r.body.details[0].path).toBe('a')
  })

  it('includes details from ApiError when present', async () => {
    const r = await json(toErrorResponse(badRequest('x', { rows: [1] })))
    expect(r.body.details).toEqual({ rows: [1] })
  })
})

describe('withApiAuth', () => {
  it('401 when no session', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const h = withApiAuth(async () => new Response('ok'))
    expect((await h(req())).status).toBe(401)
  })
  it('403 when role not allowed', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(employee as never)
    const h = withApiAuth([UserRole.SUPER_ADMIN], async () => new Response('ok'))
    expect((await h(req())).status).toBe(403)
  })
  it('passes user + params to the handler when allowed', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(reporter as never)
    const h = withApiAuth([UserRole.REPORTER, UserRole.SUPER_ADMIN], async (_r, ctx) =>
      Response.json({ id: ctx.user.id, p: ctx.params.id })
    )
    const r = await json(await h(req(), { params: { id: 'abc' } }))
    expect(r.body).toEqual({ id: reporter.id, p: 'abc' })
  })
  it('no roles = any authenticated user', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(employee as never)
    const h = withApiAuth(async () => new Response('ok'))
    expect((await h(req())).status).toBe(200)
  })
  it('maps thrown errors from the handler', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(admin as never)
    const h = withApiAuth(async () => {
      throw notFound('Thing')
    })
    expect((await h(req())).status).toBe(404)
  })
})

describe('withPublicRoute', () => {
  it('runs without a session and still maps errors', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const ok = withPublicRoute(async () => new Response('ok'))
    expect((await ok(req())).status).toBe(200)
    const bad = withPublicRoute(async () => {
      throw new ApiError(503, 'down')
    })
    expect((await bad(req())).status).toBe(503)
  })
})

describe('parseBody / parseQuery', () => {
  const schema = z.object({ n: z.coerce.number().int().default(5), s: z.string().optional() })

  it('parses and applies defaults (output type)', async () => {
    const r = req('http://localhost/x', { method: 'POST', body: JSON.stringify({ s: 'a' }) })
    expect(await parseBody(r, schema)).toEqual({ n: 5, s: 'a' })
  })
  it('invalid JSON → 400 ApiError', async () => {
    const r = req('http://localhost/x', { method: 'POST', body: '{nope' })
    await expect(parseBody(r, schema)).rejects.toMatchObject({ status: 400 })
  })
  it('schema failure → ZodError', async () => {
    const r = req('http://localhost/x', { method: 'POST', body: JSON.stringify({ n: 'x' }) })
    await expect(parseBody(r, schema)).rejects.toBeInstanceOf(ZodError)
  })
  it('parseQuery coerces strings', () => {
    expect(parseQuery(req('http://localhost/x?n=7&s=q'), schema)).toEqual({ n: 7, s: 'q' })
    expect(() => parseQuery(req('http://localhost/x?n=abc'), schema)).toThrow(ZodError)
  })
})
