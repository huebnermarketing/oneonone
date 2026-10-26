/**
 * Pure free/busy arithmetic for scheduling. No I/O — lib/google-calendar.ts fetches busy ranges
 * and work windows, these functions decide what is free. All times are epoch milliseconds.
 */

export interface Interval {
  start: number
  end: number
}

/** Sort and merge overlapping or touching busy ranges. */
export function mergeBusy(busy: Interval[]): Interval[] {
  const sorted = busy.filter((b) => b.end > b.start).sort((a, b) => a.start - b.start)
  const merged: Interval[] = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
    else merged.push({ ...r })
  }
  return merged
}

/** True when [start, end) overlaps none of the busy ranges. */
export function isIntervalFree(start: number, end: number, busy: Interval[]): boolean {
  return busy.every((b) => end <= b.start || start >= b.end)
}

/** Round `t` up to the next multiple of `stepMs` (on the UTC epoch grid; :00/:30 in whole- and half-hour zones). */
export const alignUp = (t: number, stepMs: number) => Math.ceil(t / stepMs) * stepMs

export interface FreeSlotQuery {
  /** Earliest allowed start and latest allowed end (the intersection of both people's work hours) */
  window: Interval
  busy: Interval[]
  /** Meeting length */
  durationMs: number
  /** Spacing between candidate start times (30 min → 9:00, 9:30, 10:00…) — independent of duration */
  stepMs: number
  /** Extra per-slot check (e.g. both people inside their own working hours for the whole meeting) */
  accept?: (start: number, end: number) => boolean
}

/**
 * Candidate start times on the step grid inside the window where a meeting of `durationMs`
 * fits without touching any busy range. A 60-minute meeting at a 30-minute step yields 9:00,
 * 9:30, 10:00… whenever the full hour is free.
 */
export function computeFreeSlots({ window, busy, durationMs, stepMs, accept }: FreeSlotQuery): Interval[] {
  if (durationMs <= 0 || stepMs <= 0 || window.end - window.start < durationMs) return []
  const merged = mergeBusy(busy)
  const slots: Interval[] = []
  for (let s = alignUp(window.start, stepMs); s + durationMs <= window.end; s += stepMs) {
    const e = s + durationMs
    if (!isIntervalFree(s, e, merged)) continue
    if (accept && !accept(s, e)) continue
    slots.push({ start: s, end: e })
  }
  return slots
}

/**
 * Is a specific meeting [start, start + duration) free for both people? Unlike checking for a
 * matching pre-built slot, this works for any duration and any start minute.
 */
export function isMeetingTimeFree(start: number, durationMs: number, window: Interval, busy: Interval[], accept?: (start: number, end: number) => boolean): boolean {
  const end = start + durationMs
  if (start < window.start || end > window.end) return false
  if (!isIntervalFree(start, end, mergeBusy(busy))) return false
  return accept ? accept(start, end) : true
}
