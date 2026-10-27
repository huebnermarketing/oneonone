import { describe, it, expect } from 'vitest'
import { assertWorkingDay, assertWorkingWeekday, describeWorkingDays, weekdayIn, weekdayOfKey } from '@/lib/working-days'
import { updateSettingsSchema } from '@/lib/validation/admin'

describe('working days', () => {
  it('reads weekdays from date keys and from instants in a timezone', () => {
    expect(weekdayOfKey('2026-11-01')).toBe(0) // Sunday
    expect(weekdayOfKey('2026-11-02')).toBe(1)
    // Fri 22:00 UTC is already Saturday in India
    expect(weekdayIn(new Date('2026-10-30T22:00:00Z'), 'UTC')).toBe(5)
    expect(weekdayIn(new Date('2026-10-30T22:00:00Z'), 'Asia/Kolkata')).toBe(6)
  })

  it('describes the policy compactly', () => {
    expect(describeWorkingDays([1, 2, 3, 4, 5])).toBe('Mon–Fri')
    expect(describeWorkingDays([1, 2, 3, 4, 5, 6])).toBe('Mon–Sat')
    expect(describeWorkingDays([1, 3, 5])).toBe('Mon, Wed, Fri')
    expect(describeWorkingDays([0, 1, 2, 3, 4, 5, 6])).toBe('Mon–Sun')
  })

  it('rejects non-working days in the scheduler timezone', () => {
    const sat = new Date('2026-10-31T06:00:00Z')
    expect(() => assertWorkingDay(sat, 'UTC', [1, 2, 3, 4, 5])).toThrow(/Sat\. Working days are Mon–Fri/)
    expect(() => assertWorkingDay(sat, 'UTC', [1, 2, 3, 4, 5, 6])).not.toThrow()
    expect(() => assertWorkingWeekday(0, [1, 2, 3, 4, 5])).toThrow(/Recurring 1:1s can't be on Sun/)
  })

  it('settings schema dedupes/sorts days and requires at least one', () => {
    expect(updateSettingsSchema.parse({ workingDays: [5, 1, 1, 3] }).workingDays).toEqual([1, 3, 5])
    expect(updateSettingsSchema.safeParse({ workingDays: [] }).success).toBe(false)
    expect(updateSettingsSchema.safeParse({ workingDays: [7] }).success).toBe(false)
  })
})
