/**
 * The one place dates are formatted. Every instant is stored in UTC; it is rendered in the
 * VIEWER's timezone (`User.timeZone`, auto-detected from the browser on first visit, editable in
 * Profile), never in a hardcoded one. Date-only values (todo due dates, report ranges) are calendar
 * dates stored at 00:00 UTC and must be rendered with `formatDateOnly` so they never shift a day.
 *
 * Server components: `formatX(date, user.timeZone)`. Client components: `const f = useFormat()`
 * from `components/providers/timezone-provider`. Emails/notifications: the recipient's timezone.
 */
import { DEFAULT_TIMEZONE } from './constants'

export { DEFAULT_TIMEZONE }

type DateInput = Date | string | number

const toDate = (d: DateInput): Date => (d instanceof Date ? d : new Date(d))

const tzCache = new Map<string, boolean>()
/** True when Intl knows the zone. */
export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false
  const hit = tzCache.get(tz)
  if (hit !== undefined) return hit
  let ok = false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    ok = true
  } catch {
    ok = false
  }
  tzCache.set(tz, ok)
  return ok
}

/** A usable timezone from whatever is stored: the user's, else the app default. */
export function resolveTimeZone(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE
}

function fmt(d: DateInput, tz: string, opts: Intl.DateTimeFormatOptions): string {
  const date = toDate(d)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: resolveTimeZone(tz) }).format(date)
}

// ---- instants, rendered in the viewer's timezone ----------------------------------------------

/** "February 18, 2026" (long) / "Feb 18, 2026" (short) */
export const formatDate = (d: DateInput, tz: string, style: 'long' | 'short' = 'long') =>
  fmt(d, tz, { year: 'numeric', month: style, day: 'numeric' })

/** "February 18, 2026 at 11:30 AM" (long) / "Feb 18, 2026, 11:30 AM" (short) */
export const formatDateTime = (d: DateInput, tz: string, style: 'long' | 'short' = 'long') =>
  fmt(d, tz, { year: 'numeric', month: style, day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** "11:30 AM" */
export const formatTime = (d: DateInput, tz: string) => fmt(d, tz, { hour: 'numeric', minute: '2-digit' })

/** "Wed, Feb 18, 11:30 AM" — meeting lists, notifications */
export const formatMeetingShort = (d: DateInput, tz: string) =>
  fmt(d, tz, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** "Wednesday, February 18, 2026 at 11:30 AM" — meeting detail, emails */
export const formatMeetingLong = (d: DateInput, tz: string) =>
  fmt(d, tz, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** "Wednesday, February 18" / "Wed, Feb 18" — calendar headings (no year, no time) */
export const formatDayHeading = (d: DateInput, tz: string, style: 'long' | 'short' = 'long') =>
  fmt(d, tz, { weekday: style, month: style, day: 'numeric' })

/** "Feb 18" — compact chips */
export const formatMonthDay = (d: DateInput, tz: string) => fmt(d, tz, { month: 'short', day: 'numeric' })

/** Short zone name for the instant, e.g. "IST", "MDT", "GMT+8" — append when two parties are in different zones. */
export function timeZoneAbbrev(d: DateInput, tz: string): string {
  const zone = resolveTimeZone(tz)
  const date = toDate(d)
  // en-US only knows North American abbreviations ("IST" comes back as "GMT+5:30"); other English locales fill the gaps
  for (const locale of ['en-US', 'en-IN', 'en-GB', 'en-SG', 'en-AU']) {
    const name = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' }).formatToParts(date).find((p) => p.type === 'timeZoneName')?.value
    if (name && !/^(GMT|UTC)[+-]/.test(name)) return name
  }
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? ''
}

// ---- calendar dates (no time of day) -----------------------------------------------------------

/** "YYYY-MM-DD" string or a Date at exactly 00:00:00.000 UTC — a calendar date, not an instant. */
export function isDateOnly(d: DateInput): boolean {
  if (typeof d === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(d)
  const date = toDate(d)
  return date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0
}

/** "YYYY-MM-DD" → Date at 00:00 UTC. Other inputs pass through `new Date()`. */
export const parseDateOnly = (s: string): Date => new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00.000Z` : s)

/**
 * Render a calendar date without any timezone shift: "February 18, 2026" / "Feb 18, 2026" / "Wed, Feb 18".
 * Use for todo due dates, report ranges, birthdays — anything that is a date, not a moment.
 */
export function formatDateOnly(d: DateInput, style: 'long' | 'short' | 'weekday' = 'long'): string {
  const date = typeof d === 'string' ? parseDateOnly(d) : toDate(d)
  const opts: Intl.DateTimeFormatOptions =
    style === 'weekday' ? { weekday: 'short', month: 'short', day: 'numeric' } : { year: 'numeric', month: style, day: 'numeric' }
  return fmt(date, 'UTC', opts)
}

/** The calendar date ("YYYY-MM-DD") an instant falls on in a timezone. */
export function toDateKey(d: DateInput, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: resolveTimeZone(tz), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(toDate(d))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Offset of `tz` from UTC in minutes at a given instant (IST → 330, MDT → -360). */
export function offsetMinutes(d: DateInput, tz: string): number {
  const date = toDate(d)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: resolveTimeZone(tz),
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
  return Math.round((asUtc - date.getTime()) / 60_000)
}

/** Instant at which a calendar day ("YYYY-MM-DD") ends in `tz` (23:59:59.999 local). */
export function endOfDayInTz(dateKey: string, tz: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number)
  const naive = Date.UTC(y, m - 1, d, 23, 59, 59, 999)
  // Two passes handle DST transitions on that day
  let guess = naive - offsetMinutes(naive, tz) * 60_000
  guess = naive - offsetMinutes(guess, tz) * 60_000
  return new Date(guess)
}

/** Instant at which a calendar day ("YYYY-MM-DD") starts in `tz`. */
export function startOfDayInTz(dateKey: string, tz: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number)
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0, 0)
  let guess = naive - offsetMinutes(naive, tz) * 60_000
  guess = naive - offsetMinutes(guess, tz) * 60_000
  return new Date(guess)
}

/**
 * A todo is overdue once its due date has fully passed FOR THE VIEWER:
 * - date-only due dates: after 23:59:59 of that calendar day in `tz`
 * - due dates with a time: after that exact instant
 */
export function isTodoOverdue(dueDate: DateInput | null | undefined, now: Date, status: string, tz: string): boolean {
  if (!dueDate || status === 'DONE') return false
  const d = typeof dueDate === 'string' ? parseDateOnly(dueDate) : toDate(dueDate)
  if (Number.isNaN(d.getTime())) return false
  if (!isDateOnly(d)) return now.getTime() > d.getTime()
  return now.getTime() > endOfDayInTz(d.toISOString().slice(0, 10), tz).getTime()
}

/** "today" / "tomorrow" / "yesterday" / undefined, judged on calendar days in `tz`. */
export function relativeDayLabel(d: DateInput, now: Date, tz: string): 'today' | 'tomorrow' | 'yesterday' | undefined {
  const key = toDateKey(d, tz)
  const today = toDateKey(now, tz)
  if (key === today) return 'today'
  const dayMs = 86_400_000
  if (key === toDateKey(now.getTime() + dayMs, tz)) return 'tomorrow'
  if (key === toDateKey(now.getTime() - dayMs, tz)) return 'yesterday'
  return undefined
}

/** Bound formatters for one timezone — what `useFormat()` returns on the client. */
export function formattersFor(tz: string) {
  const z = resolveTimeZone(tz)
  return {
    timeZone: z,
    date: (d: DateInput, style?: 'long' | 'short') => formatDate(d, z, style),
    dateTime: (d: DateInput, style?: 'long' | 'short') => formatDateTime(d, z, style),
    time: (d: DateInput) => formatTime(d, z),
    meetingShort: (d: DateInput) => formatMeetingShort(d, z),
    meetingLong: (d: DateInput) => formatMeetingLong(d, z),
    dayHeading: (d: DateInput, style?: 'long' | 'short') => formatDayHeading(d, z, style),
    monthDay: (d: DateInput) => formatMonthDay(d, z),
    dateOnly: formatDateOnly,
    dateKey: (d: DateInput) => toDateKey(d, z),
    abbrev: (d: DateInput = new Date()) => timeZoneAbbrev(d, z),
    isTodoOverdue: (due: DateInput | null | undefined, status: string, now: Date = new Date()) => isTodoOverdue(due, now, status, z),
    relativeDay: (d: DateInput, now: Date = new Date()) => relativeDayLabel(d, now, z),
  }
}
export type Formatters = ReturnType<typeof formattersFor>
