import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import '@/lib/zod-messages'
import { restoreSchema } from '@/lib/validation/admin'
import { deleteRecurringQuery } from '@/lib/validation/recurring'
import { isoDate, pagination } from '@/lib/validation/common'

const msgs = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? [] : r.error!.issues.map((i) => i.message))

describe('zod 4 behaviour we depend on', () => {
  it('global error map keeps friendly wording', () => {
    expect(msgs(z.object({ a: z.string() }).safeParse({}))).toEqual(['Required'])
    expect(msgs(z.string().min(1).safeParse(''))).toEqual(['Required'])
    expect(msgs(z.string().max(5).safeParse('toolong'))).toEqual(['Must be at most 5 characters'])
    expect(msgs(isoDate.safeParse('not a date'))).toEqual(['Invalid date'])
    expect(msgs(z.enum(['A', 'B']).safeParse('C'))).toEqual(["Invalid value. Expected 'A' | 'B'"])
    expect(msgs(z.string().email().safeParse('nope'))).toEqual(['Invalid email address'])
  })
  it('explicit schema messages still win over the global map', () => {
    expect(msgs(z.string().min(1, 'Title is required').safeParse(''))).toEqual(['Title is required'])
  })
  it('restore options default to the inner defaults (prefault, not default)', () => {
    const r = restoreSchema.parse({ data: { version: '1', data: {} } })
    expect(r.options).toEqual({ clearExisting: false, restoreUsers: true, restoreMeetings: true })
    expect(r.data.data).toEqual({ departments: [], users: [], meetings: [] })
  })
  it('boolean query param defaults to true and parses strings', () => {
    expect(deleteRecurringQuery.parse({}).cancelFutureMeetings).toBe(true)
    expect(deleteRecurringQuery.parse({ cancelFutureMeetings: 'false' }).cancelFutureMeetings).toBe(false)
  })
  it('pagination coerces query strings', () => {
    expect(pagination(20, 100).parse({ limit: '50', offset: '10' })).toMatchObject({ limit: 50, offset: 10 })
  })
})
