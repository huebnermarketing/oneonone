import { describe, it, expect } from 'vitest'
import { isTodoOverdue } from '@/lib/utils'

describe('isTodoOverdue', () => {
  const dateOnly = new Date('2026-11-10T00:00:00.000Z')
  const withTime = new Date('2026-11-10T14:30:00.000Z')

  it('never overdue when DONE or no due date', () => {
    expect(isTodoOverdue(dateOnly, new Date('2030-01-01'), 'DONE')).toBe(false)
    expect(isTodoOverdue(null, new Date('2030-01-01'), 'NOT_STARTED')).toBe(false)
  })
  it('date-only due date is overdue only after end of that UTC day', () => {
    expect(isTodoOverdue(dateOnly, new Date('2026-11-10T23:59:59.000Z'), 'IN_PROGRESS')).toBe(false)
    expect(isTodoOverdue(dateOnly, new Date('2026-11-11T00:00:00.000Z'), 'IN_PROGRESS')).toBe(true)
  })
  it('timed due date is overdue after that instant', () => {
    expect(isTodoOverdue(withTime, new Date('2026-11-10T14:29:59.000Z'), 'NOT_STARTED')).toBe(false)
    expect(isTodoOverdue(withTime, new Date('2026-11-10T14:30:01.000Z'), 'NOT_STARTED')).toBe(true)
  })
  it('accepts ISO strings', () => {
    expect(isTodoOverdue('2026-11-10T00:00:00.000Z', new Date('2026-11-12'), 'NOT_STARTED')).toBe(true)
  })
})
