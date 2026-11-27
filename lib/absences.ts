import { prisma } from './prisma'
import { countryTimeZone, fetchLeaveRequests, holidayDatesForCountry, isKekaConfigured, KEKA_LEAVE_STATUS, type KekaLeaveWithSessions } from './keka'
import { DEFAULT_TIMEZONE } from './constants'
import { DEFAULT_WORK_END, DEFAULT_WORK_START } from './timezones'
import { offsetMinutes, toDateKey } from './dates'

/**
 * Who is away when, from Keka: public holidays (by office country) and leave requests (approved block
 * scheduling, pending is only shown). Days are calendar days in the absent person's own timezone; a
 * half-day leave covers the first or second half of their working day.
 *
 * Used by the slot picker (lib/availability.ts), the "On leave" chips on meetings, and the hourly cron
 * (lib/leave-watch.ts). Keka is rate-limited: leave is fetched per calendar month for many people in one
 * call and cached for LEAVE_TTL_MS. Every entry point is fail-soft — Keka down means "no absences".
 */

export type AbsenceKind = 'holiday' | 'leave' | 'pending'
export type Half = 'FIRST' | 'SECOND'

export interface DayAbsence {
  /** Calendar day "YYYY-MM-DD" in the person's timezone */
  date: string
  kind: AbsenceKind
  /** Only part of the day (half-day leave) */
  half?: Half
}

export interface PersonProfile {
  timeZone: string
  workStart: string
  workEnd: string
}

const LEAVE_TTL_MS = 15 * 60 * 1000
const LEAVE_ERROR_TTL_MS = 5 * 60 * 1000
/** Chips and checks only look this far ahead (Keka calls stay bounded). */
const MAX_LOOKAHEAD_DAYS = 180

// ── pure helpers ────────────────────────────────────────────────────

function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Every calendar day a leave request covers, with half-days from Keka's sessions (0 = first half, 1 = second half). */
export function expandLeave(l: Pick<KekaLeaveWithSessions, 'fromDate' | 'toDate' | 'status' | 'fromSession' | 'toSession'>): DayAbsence[] {
  const from = (l.fromDate || '').slice(0, 10)
  const to = (l.toDate || l.fromDate || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return []
  const kind: AbsenceKind = l.status === KEKA_LEAVE_STATUS.APPROVED ? 'leave' : 'pending'
  const days: DayAbsence[] = []
  for (let d = from, i = 0; d <= to && i < 366; d = addDays(d, 1), i++) {
    let half: Half | undefined
    if (from === to) {
      if (l.fromSession === 0 && l.toSession === 0) half = 'FIRST'
      else if (l.fromSession === 1 && l.toSession === 1) half = 'SECOND'
    } else if (d === from && l.fromSession === 1) half = 'SECOND'
    else if (d === to && l.toSession === 0) half = 'FIRST'
    days.push(half ? { date: d, kind, half } : { date: d, kind })
  }
  return days
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Local minutes-of-day of an instant in a timezone. */
function localMinutes(at: Date, timeZone: string): number {
  const utc = at.getUTCHours() * 60 + at.getUTCMinutes()
  return (((utc + offsetMinutes(at, timeZone)) % 1440) + 1440) % 1440
}

const RANK: Record<AbsenceKind, number> = { holiday: 3, leave: 2, pending: 1 }

/** The strongest absence: holiday > leave > pending, a full day over a half day. */
export function strongest(list: DayAbsence[]): DayAbsence | null {
  let best: DayAbsence | null = null
  for (const a of list) {
    if (!best || RANK[a.kind] > RANK[best.kind] || (RANK[a.kind] === RANK[best.kind] && !a.half && best.half)) best = a
  }
  return best
}

/**
 * The absence that overlaps a meeting [start, start + duration) for this person, or null. A half-day
 * leave covers [day start, middle of their working day) or [middle, day end).
 */
export function absenceAt(days: DayAbsence[], start: Date, durationMinutes: number, profile: PersonProfile): DayAbsence | null {
  const dayKey = toDateKey(start, profile.timeZone)
  const onDay = days.filter((d) => d.date === dayKey)
  if (onDay.length === 0) return null
  const s = localMinutes(start, profile.timeZone)
  const e = s + durationMinutes
  const mid = (minutesOf(profile.workStart) + minutesOf(profile.workEnd)) / 2
  return strongest(
    onDay.filter((d) => !d.half || (d.half === 'FIRST' ? s < mid : e > mid))
  )
}

/** Approved leave and holidays block scheduling; pending leave is only shown. */
export const blocks = (a: DayAbsence | null | undefined): a is DayAbsence => !!a && a.kind !== 'pending'

export { absenceLabel } from './absence-format'

// ── Keka data (cached) ──────────────────────────────────────────────

const leaveCache = new Map<string, { expiresAt: number; rows: KekaLeaveWithSessions[] }>()

/** Test hook */
export function clearAbsenceCache() {
  leaveCache.clear()
}

function monthsBetween(fromKey: string, toKey: string): string[] {
  const months: string[] = []
  let [y, m] = fromKey.slice(0, 7).split('-').map(Number)
  const end = toKey.slice(0, 7)
  for (let i = 0; i < 24; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    months.push(key)
    if (key >= end) break
    m++
    if (m > 12) { m = 1; y++ }
  }
  return months
}

/** Leave rows per Keka employee id for the months touched by [fromKey, toKey]; one Keka call per month per 40 people. */
async function leavesByKekaId(kekaIds: string[], fromKey: string, toKey: string): Promise<Map<string, KekaLeaveWithSessions[]>> {
  const out = new Map<string, KekaLeaveWithSessions[]>(kekaIds.map((id) => [id, []]))
  const now = Date.now()
  for (const month of monthsBetween(fromKey, toKey)) {
    const missing = kekaIds.filter((id) => (leaveCache.get(`${id}:${month}`)?.expiresAt ?? 0) <= now)
    for (let i = 0; i < missing.length; i += 40) {
      const chunk = missing.slice(i, i + 40)
      const start = new Date(`${month}-01T00:00:00.000Z`)
      const end = new Date(start)
      end.setUTCMonth(end.getUTCMonth() + 1)
      try {
        const rows = await fetchLeaveRequests(chunk, start, new Date(end.getTime() - 1))
        for (const id of chunk) {
          leaveCache.set(`${id}:${month}`, { expiresAt: now + LEAVE_TTL_MS, rows: rows.filter((r) => r.employeeIdentifier === id) })
        }
      } catch (err) {
        console.warn(`[absences] Keka leave fetch failed for ${month}:`, err instanceof Error ? err.message : err)
        for (const id of chunk) leaveCache.set(`${id}:${month}`, { expiresAt: now + LEAVE_ERROR_TTL_MS, rows: [] })
      }
    }
    for (const id of kekaIds) {
      const seen = new Set(out.get(id)!.map((r) => r.id ?? `${r.fromDate}|${r.toDate}`))
      for (const r of leaveCache.get(`${id}:${month}`)?.rows ?? []) {
        const k = r.id ?? `${r.fromDate}|${r.toDate}`
        if (!seen.has(k)) { seen.add(k); out.get(id)!.push(r) }
      }
    }
  }
  return out
}

export interface PersonAbsences {
  profile: PersonProfile
  days: DayAbsence[]
}

/** Absences of these users on calendar days [fromKey, toKey] (in each person's zone). Never throws. */
export async function loadAbsences(userIds: string[], fromKey: string, toKey: string): Promise<Map<string, PersonAbsences>> {
  const result = new Map<string, PersonAbsences>()
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return result
  try {
    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, kekaEmployeeId: true, country: true, timeZone: true, workDayStart: true, workDayEnd: true },
    })
    for (const u of users) {
      result.set(u.id, {
        profile: {
          timeZone: u.timeZone || countryTimeZone(u.country) || DEFAULT_TIMEZONE,
          workStart: u.workDayStart || DEFAULT_WORK_START,
          workEnd: u.workDayEnd || DEFAULT_WORK_END,
        },
        days: [],
      })
    }
    if (!isKekaConfigured()) return result

    const inRange = (d: string) => d >= fromKey && d <= toKey
    const years = [...new Set([Number(fromKey.slice(0, 4)), Number(toKey.slice(0, 4))])]
    const holidaySets = new Map<string, Set<string>>()
    for (const country of new Set(users.map((u) => u.country ?? ''))) {
      const all = new Set<string>()
      for (const y of years) for (const d of await holidayDatesForCountry(country || null, y)) all.add(d)
      holidaySets.set(country, all)
    }

    const kekaIds = users.map((u) => u.kekaEmployeeId).filter((id): id is string => !!id)
    const leaves = await leavesByKekaId(kekaIds, fromKey, toKey)

    for (const u of users) {
      const entry = result.get(u.id)!
      for (const d of holidaySets.get(u.country ?? '') ?? []) if (inRange(d)) entry.days.push({ date: d, kind: 'holiday' })
      for (const l of (u.kekaEmployeeId && leaves.get(u.kekaEmployeeId)) || []) {
        entry.days.push(...expandLeave(l).filter((d) => inRange(d.date)))
      }
    }
  } catch (err) {
    console.warn('[absences] lookup failed:', err instanceof Error ? err.message : err)
  }
  return result
}

// ── meetings ────────────────────────────────────────────────────────

export interface MeetingAbsence {
  employee?: DayAbsence
  reporter?: DayAbsence
}

interface MeetingLike {
  id: string
  meetingDate: Date
  durationMinutes?: number | null
  employeeId: string
  reporterId: string
}

/**
 * Absence per meeting (either participant) for upcoming meetings — feeds the "On leave" / "Holiday" /
 * "Leave pending" chips and the cron's leave alerts. Past meetings and Keka-less setups get nothing.
 */
export async function absencesForMeetings(meetings: MeetingLike[], now = new Date()): Promise<Record<string, MeetingAbsence>> {
  const out: Record<string, MeetingAbsence> = {}
  if (!isKekaConfigured()) return out
  const horizon = now.getTime() + MAX_LOOKAHEAD_DAYS * 86_400_000
  const relevant = meetings.filter((m) => {
    const t = new Date(m.meetingDate).getTime()
    return t >= now.getTime() - 86_400_000 && t <= horizon
  })
  if (relevant.length === 0) return out
  const times = relevant.map((m) => new Date(m.meetingDate).getTime())
  // ±1 day: a person's local calendar day can differ from the UTC day
  const fromKey = addDays(new Date(Math.min(...times)).toISOString().slice(0, 10), -1)
  const toKey = addDays(new Date(Math.max(...times)).toISOString().slice(0, 10), 1)
  const people = await loadAbsences(relevant.flatMap((m) => [m.employeeId, m.reporterId]), fromKey, toKey)

  for (const m of relevant) {
    const at = new Date(m.meetingDate)
    const minutes = m.durationMinutes ?? 30
    const forPerson = (id: string) => {
      const p = people.get(id)
      return p ? absenceAt(p.days, at, minutes, p.profile) : null
    }
    const employee = forPerson(m.employeeId)
    const reporter = forPerson(m.reporterId)
    if (employee || reporter) out[m.id] = { ...(employee && { employee }), ...(reporter && { reporter }) }
  }
  return out
}

/** The absence that should block a meeting at this time for either person (approved leave / holiday), or null. */
export async function blockingAbsence(reporterId: string, employeeId: string, at: Date, durationMinutes: number): Promise<{ who: 'reporter' | 'employee'; absence: DayAbsence } | null> {
  const found = await absencesForMeetings([{ id: 'x', meetingDate: at, durationMinutes, employeeId, reporterId }], new Date(Math.min(Date.now(), at.getTime())))
  const a = found.x
  if (blocks(a?.employee)) return { who: 'employee', absence: a!.employee! }
  if (blocks(a?.reporter)) return { who: 'reporter', absence: a!.reporter! }
  return null
}

export interface PairDayInfo {
  date: string
  /** Either person away for the whole day (approved leave or holiday) */
  fullDay?: { who: 'reporter' | 'employee'; absence: DayAbsence }
  /** Half-day leave / pending leave that day, for hints */
  partial: { who: 'reporter' | 'employee'; absence: DayAbsence }[]
}

/**
 * Day-level view for the scheduling picker: which days in [fromKey, toKey] either person is away.
 * Day keys are taken as calendar days for both people (the picker's calendar).
 */
export async function pairAbsenceDays(reporterId: string, employeeId: string, fromKey: string, toKey: string): Promise<PairDayInfo[]> {
  if (!isKekaConfigured()) return []
  const people = await loadAbsences([reporterId, employeeId], fromKey, toKey)
  const byDate = new Map<string, PairDayInfo>()
  for (const [who, id] of [['reporter', reporterId], ['employee', employeeId]] as const) {
    for (const absence of people.get(id)?.days ?? []) {
      const info = byDate.get(absence.date) ?? { date: absence.date, partial: [] }
      if (blocks(absence) && !absence.half) {
        if (!info.fullDay || RANK[absence.kind] > RANK[info.fullDay.absence.kind]) info.fullDay = { who, absence }
      } else info.partial.push({ who, absence })
      byDate.set(absence.date, info)
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

type NameOf = (side: 'reporter' | 'employee') => string
const verb = (name: string, you: string, other: string) => (name === 'You' ? you : other)

/** "Sam is on leave that day (Keka). Pick another day." for a whole-day absence. */
export function fullDayMessage(full: NonNullable<PairDayInfo['fullDay']>, nameOf: NameOf): string {
  const name = nameOf(full.who)
  return full.absence.kind === 'holiday'
    ? `It's a public holiday for ${name === 'You' ? 'you' : name} that day (Keka). Pick another day.`
    : `${name} ${verb(name, 'are', 'is')} on leave that day (Keka). Pick another day.`
}

/** Note for a day with half-day or pending leave (slots stay, minus the leave half). */
export function leaveNoteFor(day: PairDayInfo | undefined, nameOf: NameOf): string | undefined {
  if (!day) return undefined
  const notes: string[] = []
  for (const p of day.partial) {
    const name = nameOf(p.who)
    if (p.absence.kind === 'pending') notes.push(`${name} ${verb(name, 'have', 'has')} a leave request pending in Keka for this day.`)
    else if (p.absence.half) notes.push(`${name} ${verb(name, 'are', 'is')} on leave for the ${p.absence.half === 'FIRST' ? 'first' : 'second'} half of the day; only the other half is shown.`)
  }
  return notes.length ? [...new Set(notes)].join(' ') : undefined
}

/**
 * Slot filter for one day: drops slots that overlap a blocking absence (incl. the half of a half-day leave)
 * for either person. Returns the filter plus notes for the picker.
 */
export async function pairSlotFilter(reporterId: string, employeeId: string, dayKey: string) {
  const people = isKekaConfigured() ? await loadAbsences([reporterId, employeeId], addDays(dayKey, -1), addDays(dayKey, 1)) : new Map<string, PersonAbsences>()
  const check = (id: string, start: Date, minutes: number) => {
    const p = people.get(id)
    return p ? absenceAt(p.days, start, minutes, p.profile) : null
  }
  return {
    isBlocked(start: Date, minutes: number): boolean {
      return blocks(check(reporterId, start, minutes)) || blocks(check(employeeId, start, minutes))
    },
    /** Pending leave on that day (not blocking) — shown as a note */
    pending(): ('reporter' | 'employee')[] {
      const out: ('reporter' | 'employee')[] = []
      for (const [who, id] of [['reporter', reporterId], ['employee', employeeId]] as const) {
        if ((people.get(id)?.days ?? []).some((d) => d.date === dayKey && d.kind === 'pending')) out.push(who)
      }
      return out
    },
  }
}
