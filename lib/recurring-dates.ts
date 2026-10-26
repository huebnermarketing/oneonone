import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { addDays, addWeeks, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns'
import { RecurringFrequency } from '@prisma/client'

const FALLBACK_TZ = 'Asia/Kolkata'

/*
 * MONTHLY means "the Nth weekday of the month" (1st–4th Monday, …), capped at 4 so every month has
 * exactly one occurrence. Google Calendar gets the same rule (RRULE BYDAY=2MO), so the app's rows and
 * the calendar series always agree. A first date in a month's 5th week moves to the next week.
 */
const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

/** Which weekday-of-month a local date is: day 1–7 → 1, 8–14 → 2, … capped at 4. */
export function monthlyOrdinal(localDayOfMonth: number): 1 | 2 | 3 | 4 {
  return Math.min(4, Math.ceil(localDayOfMonth / 7)) as 1 | 2 | 3 | 4
}

/** Day-of-month of the `ordinal`-th `weekday` (0=Sun) in a month (month is 0-based). */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, ordinal: number): number {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay()
  return 1 + ((weekday - firstWeekday + 7) % 7) + (ordinal - 1) * 7
}

/** RRULE lines for a series starting at `firstOccurrence` (1 year of occurrences). */
export function buildRecurrenceRule(frequency: RecurringFrequency, firstOccurrence: Date, timeZone = FALLBACK_TZ): string[] {
  switch (frequency) {
    case 'BIWEEKLY':
      return ['RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=MO;COUNT=26']
    case 'MONTHLY': {
      const local = toZonedTime(firstOccurrence, timeZone)
      return [`RRULE:FREQ=MONTHLY;BYDAY=${monthlyOrdinal(local.getDate())}${RRULE_DAYS[local.getDay()]};COUNT=12`]
    }
    case 'WEEKLY':
    default:
      return ['RRULE:FREQ=WEEKLY;WKST=MO;COUNT=52']
  }
}

/**
 * Calculate the first upcoming occurrence of a recurring meeting from now.
 */
export function calculateFirstOccurrence(
  dayOfWeek: number,
  timeOfDay: string,
  frequency: RecurringFrequency,
  timeZone = FALLBACK_TZ
): Date {
  const [hours, minutes] = timeOfDay.split(':').map(Number)
  const now = new Date()
  const zoned = toZonedTime(now, timeZone)
  const currentDay = zoned.getDay()
  let daysUntil = dayOfWeek - currentDay
  if (daysUntil < 0) daysUntil += 7
  else if (daysUntil === 0) {
    if (zoned.getHours() > hours || (zoned.getHours() === hours && zoned.getMinutes() >= minutes)) {
      daysUntil += 7
    }
  }
  let nextLocal = addDays(zoned, daysUntil)
  nextLocal = setHours(nextLocal, hours)
  nextLocal = setMinutes(nextLocal, minutes)
  nextLocal = setSeconds(nextLocal, 0)
  nextLocal = setMilliseconds(nextLocal, 0)
  if (frequency === 'BIWEEKLY' && daysUntil < 7) {
    nextLocal = addWeeks(nextLocal, 1)
  }
  if (frequency === 'MONTHLY' && nextLocal.getDate() > 28) {
    // 5th-week dates don't exist every month; start from the next 1st-week occurrence instead
    nextLocal = addWeeks(nextLocal, 1)
  }
  return fromZonedTime(nextLocal, timeZone)
}

/**
 * Return the next N occurrence dates for a recurring slot (e.g. next 4 Mondays at 3pm).
 * Used to find the first free occurrence when the immediate next one may be blocked (holiday, leave).
 */
export function getNextOccurrenceDates(
  dayOfWeek: number,
  timeOfDay: string,
  frequency: RecurringFrequency,
  timeZone = FALLBACK_TZ,
  count: number
): Date[] {
  const dates: Date[] = []
  let current = calculateFirstOccurrence(dayOfWeek, timeOfDay, frequency, timeZone)
  for (let i = 0; i < count; i++) {
    dates.push(current)
    current = advanceToNextOccurrence(dayOfWeek, timeOfDay, frequency, current, timeZone)
  }
  return dates
}

/**
 * Given an already-generated meeting date, advance to the next occurrence.
 */
export function advanceToNextOccurrence(
  dayOfWeek: number,
  timeOfDay: string,
  frequency: RecurringFrequency,
  lastDate: Date,
  timeZone = FALLBACK_TZ
): Date {
  const [hours, minutes] = timeOfDay.split(':').map(Number)
  let zoned = toZonedTime(lastDate, timeZone)

  switch (frequency) {
    case 'WEEKLY':
      zoned = addDays(zoned, 7)
      break
    case 'BIWEEKLY':
      zoned = addDays(zoned, 14)
      break
    case 'MONTHLY': {
      // Same weekday-of-month next month (2nd Monday → 2nd Monday); never drifts
      const ordinal = monthlyOrdinal(zoned.getDate())
      const year = zoned.getMonth() === 11 ? zoned.getFullYear() + 1 : zoned.getFullYear()
      const month = (zoned.getMonth() + 1) % 12
      zoned = new Date(year, month, nthWeekdayOfMonth(year, month, dayOfWeek, ordinal), zoned.getHours(), zoned.getMinutes())
      break
    }
  }

  zoned = setHours(zoned, hours)
  zoned = setMinutes(zoned, minutes)
  zoned = setSeconds(zoned, 0)
  zoned = setMilliseconds(zoned, 0)

  return fromZonedTime(zoned, timeZone)
}
