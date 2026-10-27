/**
 * Working days policy (Admin → Settings → Policies → Working days). Client-safe.
 * Days are 0 = Sunday … 6 = Saturday and are evaluated in the SCHEDULER's timezone.
 */
import { toDateKey } from './dates'
import { badRequest } from './api-errors'

export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5]
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
/** Display order for pickers: Monday first */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

/** Weekday of a YYYY-MM-DD calendar date. */
export function weekdayOfKey(dateKey: string): number {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay()
}

/** Weekday of an instant in a timezone. */
export function weekdayIn(date: Date, timeZone: string): number {
  return weekdayOfKey(toDateKey(date, timeZone))
}

export const isWorkingWeekday = (weekday: number, workingDays: number[]) => workingDays.includes(weekday)

/** "Mon–Fri", "Mon–Sat", "Mon, Wed, Fri" */
export function describeWorkingDays(days: number[]): string {
  const ordered = WEEK_ORDER.filter((d) => days.includes(d))
  if (ordered.length === 0) return 'none'
  const idx = ordered.map((d) => WEEK_ORDER.indexOf(d))
  const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1)
  if (contiguous && ordered.length > 2) return `${WEEKDAY_SHORT[ordered[0]]}–${WEEKDAY_SHORT[ordered[ordered.length - 1]]}`
  return ordered.map((d) => WEEKDAY_SHORT[d]).join(', ')
}

/** Throws 400 when `date` (in `timeZone`) is not a working day. */
export function assertWorkingDay(date: Date, timeZone: string, workingDays: number[]) {
  const wd = weekdayIn(date, timeZone)
  if (!isWorkingWeekday(wd, workingDays)) {
    throw badRequest(`Meetings can't be scheduled on ${WEEKDAY_SHORT[wd]}. Working days are ${describeWorkingDays(workingDays)}.`)
  }
}

export function assertWorkingWeekday(weekday: number, workingDays: number[]) {
  if (!isWorkingWeekday(weekday, workingDays)) {
    throw badRequest(`Recurring 1:1s can't be on ${WEEKDAY_SHORT[weekday]}. Working days are ${describeWorkingDays(workingDays)}.`)
  }
}
