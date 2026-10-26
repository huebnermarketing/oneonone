/**
 * Pure helpers for the scheduling UIs (one-time proposal, recurring schedule create/edit, suggest-time).
 * Everything here is timezone-explicit: callers pass the VIEWER's zone (`useFormat().timeZone`) or the
 * reporter's zone that the availability API returns. No browser-local `getDay()`/`getHours()` and no
 * `Intl` outside lib/dates.ts.
 */
import { offsetMinutes, startOfDayInTz, toDateKey } from './dates'

/** A bookable slot as the availability API returns it. `available === false` renders disabled. */
export interface FreeSlot {
  start: string
  end?: string
  available?: boolean
}

export const SLOT_STEP_MINUTES = 30
/** Fallback window when the viewer has no work hours: slot starts 09:00 … 18:30 (last slot ends 19:00). */
export const FALLBACK_WORK_START = '09:00'
export const FALLBACK_WORK_END = '19:00'
/** A slot on the current day is only offered until this local hour; after it the next week's day is used. */
export const SAME_DAY_CUTOFF_HOUR = 18

/** "09:30" → 570. Tolerates "9:30"; garbage → 0. */
export function parseHHmm(hhmm: string | null | undefined): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim())
  if (!m) return 0
  return Number(m[1]) * 60 + Number(m[2])
}

/** Wall-clock minutes since local midnight for an instant in `tz` (IST 11:30 → 690). */
export function localMinutesOfDay(d: Date | string | number, tz: string): number {
  const date = typeof d === 'number' || typeof d === 'string' ? new Date(d) : d
  const shifted = new Date(date.getTime() + offsetMinutes(date, tz) * 60_000)
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
}

/** Weekday (0 = Sunday … 6 = Saturday) of a "YYYY-MM-DD" calendar date. */
export function dayOfWeekOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()
}

/** "YYYY-MM-DD" + n days (calendar arithmetic, no zone involved). */
export function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/**
 * "YYYY-MM-DD" of the next occurrence of `dayOfWeek` (0–6) as seen from `now` in `tz`.
 * Today counts when it is that weekday and the local time is still before `cutoffHour`; otherwise the
 * same weekday next week. This only decides which day's availability is fetched.
 */
export function getNextOccurrenceDate(dayOfWeek: number, tz: string, now: Date = new Date(), cutoffHour = SAME_DAY_CUTOFF_HOUR): string {
  const todayKey = toDateKey(now, tz)
  const currentDay = dayOfWeekOf(todayKey)
  let daysUntil = dayOfWeek - currentDay
  if (daysUntil < 0 || (daysUntil === 0 && localMinutesOfDay(now, tz) >= cutoffHour * 60)) daysUntil += 7
  return addDaysToKey(todayKey, daysUntil)
}

/** Slot start (ISO instant) → "HH:mm" wall-clock in `tz` — the `timeOfDay` a recurring schedule stores. */
export function slotToTimeInTz(slotStartIso: string, tz: string): string {
  const mins = localMinutesOfDay(slotStartIso, tz)
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

/** "09:30" → "9:30 AM", "13:05" → "1:05 PM", "00:00" → "12:00 AM". Not an instant, so no zone. */
export function formatTimeOfDay(hhmm: string): string {
  const mins = parseHHmm(hhmm)
  const h24 = Math.floor(mins / 60) % 24
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(mins % 60).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`
}

/** A slot has started (or is starting now) — too late to propose. */
export function isSlotInPast(slotStartIso: string | Date, now: Date = new Date()): boolean {
  const t = slotStartIso instanceof Date ? slotStartIso.getTime() : new Date(slotStartIso).getTime()
  return t <= now.getTime()
}

/**
 * Every `stepMinutes` slot on `dateKey` whose start AND end fall inside [workStart, workEnd) in `tz` — the
 * grid shown when a calendar is not connected. Defaults give 09:00 … 18:30 (twenty 30-minute slots).
 * Instants are built from `startOfDayInTz`, so they are right across DST and for any viewer zone.
 */
export function buildFallbackSlots(
  dateKey: string,
  tz: string,
  workStart: string | null | undefined = FALLBACK_WORK_START,
  workEnd: string | null | undefined = FALLBACK_WORK_END,
  stepMinutes = SLOT_STEP_MINUTES
): FreeSlot[] {
  const startMins = parseHHmm(workStart || FALLBACK_WORK_START)
  const endMins = parseHHmm(workEnd || FALLBACK_WORK_END)
  if (endMins - startMins < stepMinutes) return []
  const dayStart = startOfDayInTz(dateKey, tz).getTime()
  const slots: FreeSlot[] = []
  for (let m = startMins; m + stepMinutes <= endMins; m += stepMinutes) {
    slots.push({
      start: new Date(dayStart + m * 60_000).toISOString(),
      end: new Date(dayStart + (m + stepMinutes) * 60_000).toISOString(),
    })
  }
  return slots
}

/** True when the calendar day of `iso` in `tz` is the same day as `now` — used to decide whether "past" applies. */
export function isSameLocalDay(iso: string | Date, now: Date, tz: string): boolean {
  return toDateKey(iso, tz) === toDateKey(now, tz)
}
