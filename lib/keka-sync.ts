/**
 * Keka → app user sync. Keka is the source of truth for who works here; this module turns Keka
 * employees into import rows and runs them through the same planner/applier as the CSV import
 * (lib/user-import.ts), so departments, managers, promotions and diffs behave identically.
 *
 * Ownership (agreed with product):
 * - Keka owns: name, job title, department, manager, phone, country, Keka ID, employee number,
 *   joining date, and "left the company" (Relieved → deactivated + sessions revoked).
 * - The app owns: role (auto-promoted to Manager on gaining a report, never auto-demoted), time
 *   zone, working hours, avatar, and manual deactivation (sync never re-activates anyone).
 * - Users not in Keka (manual / CSV) are never deactivated for being absent.
 *
 * Triggers: daily via cron once an admin has confirmed a first sync (kekaSyncDue), Admin → "Sync
 * from Keka" (preview + confirm), and sign-in (provision a new hire / refresh a stale user).
 */
import { prisma } from './prisma'
import { isAllowedEmail } from './constants'
import { isKekaConfigured } from './keka'
import {
  fetchKekaEmployee,
  fetchKekaEmployees,
  findKekaEmployeeByEmail,
  isKekaActive,
  KekaUnavailableError,
  type KekaEmployee,
} from './keka-employees'
import {
  applyImport,
  loadImportContext,
  parseCountry,
  planRecords,
  type ImportContext,
  type ImportPlan,
  type ImportResult,
  type InputRecord,
} from './user-import'

/** Department values HR uses for "none". */
const PLACEHOLDER = /^(na|n\/a|none|nil|null|-+|—|\.)$/i
const usable = (v: string | null | undefined) => (v && !PLACEHOLDER.test(v.trim()) ? v.trim() : '')
const validPhone = (v: string | null) => (v && v.replace(/\D/g, '').length >= 10 && v.length <= 30 ? v : '')

/** Re-sync a signed-in user from Keka when their data is older than this. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000
/** Daily auto-sync cadence (a little under a day so the hourly cron doesn't drift later each day). */
const AUTO_SYNC_EVERY_MS = 23 * 60 * 60 * 1000

/** One Keka employee as an import row. `existing` decides whether status is sent (see ownership). */
export function kekaToRecord(e: KekaEmployee, line: number, existing: boolean, now = new Date()): InputRecord {
  const active = isKekaActive(e, now)
  // Left the company: just switch them off; their last HR details stay as they were.
  if (existing && !active) return { line, values: { email: e.email, status: 'Inactive' } }
  const country = e.countryCode ? (parseCountry(e.countryCode) ?? 'Other') : ''
  const values: InputRecord['values'] = {
    email: e.email,
    first_name: e.firstName.slice(0, 60),
    last_name: e.lastName.slice(0, 60),
    job_title: usable(e.jobTitle).slice(0, 120),
    department: usable(e.department).slice(0, 80),
    manager_email: e.managerEmail && e.managerEmail !== e.email ? e.managerEmail : '',
    phone: validPhone(e.workPhone) || validPhone(e.mobilePhone),
    country,
    keka_employee_id: e.id,
    employee_number: (e.employeeNumber ?? '').slice(0, 50),
    joining_date: e.joiningDate ?? '',
  }
  // Status is never sent for active people: the sync never re-activates someone an admin switched off.
  return { line, values }
}

export interface KekaSyncPlan extends ImportPlan {
  /** Keka employees not imported, with the reason (no work email, other domain) */
  skipped: { name: string; email: string; reason: string }[]
  /** Leavers who were never in the app — nothing to do */
  leaversIgnored: number
  /** Emails matched to a Keka record (stamped with kekaSyncedAt on apply) */
  syncedEmails: string[]
}

/** Pure: what syncing these Keka employees would do. */
export function planKekaSync(employees: KekaEmployee[], ctx: ImportContext, now = new Date()): KekaSyncPlan {
  const existingEmails = new Set(ctx.users.map((u) => u.email.toLowerCase()))
  const skipped: KekaSyncPlan['skipped'] = []
  const seen = new Set<string>()
  let leaversIgnored = 0
  const records: InputRecord[] = []
  employees.forEach((e, i) => {
    const name = [e.firstName, e.lastName].filter(Boolean).join(' ') || e.id
    if (!e.email) return skipped.push({ name, email: '', reason: 'No work email in Keka' })
    if (seen.has(e.email)) return
    seen.add(e.email)
    const existing = existingEmails.has(e.email)
    if (!existing && !isAllowedEmail(e.email)) return skipped.push({ name, email: e.email, reason: 'Not a company email' })
    if (!existing && !isKekaActive(e, now)) return void leaversIgnored++
    records.push(kekaToRecord(e, i + 1, existing, now))
  })
  const plan = planRecords(records, ctx, { missingManager: 'warn' })
  return {
    ...plan,
    skipped,
    leaversIgnored,
    syncedEmails: plan.rows.filter((r) => r.action !== 'error').map((r) => r.email),
  }
}

async function stampSynced(emails: string[], at: Date) {
  if (emails.length === 0) return
  await prisma.user.updateMany({ where: { email: { in: emails } }, data: { kekaSyncedAt: at } })
}

export interface KekaSyncRun {
  plan: KekaSyncPlan
  result?: ImportResult
}

/**
 * Full sync. Preview unless `commit`. Users linked to Keka (kekaEmployeeId) but missing from the
 * directory listing are looked up one by one, so leavers are caught even if the list omits them.
 */
export async function runKekaSync({ commit, actorEmail }: { commit: boolean; actorEmail: string }): Promise<KekaSyncRun> {
  const now = new Date()
  const [employees, ctx] = await Promise.all([fetchKekaEmployees(), loadImportContext(actorEmail)])
  const listed = new Set(employees.map((e) => e.id))
  const missing = ctx.users.filter((u) => u.isActive && u.kekaEmployeeId && !listed.has(u.kekaEmployeeId)).slice(0, 100)
  const extra = await Promise.all(missing.map((u) => fetchKekaEmployee(u.kekaEmployeeId!).catch(() => null)))
  const plan = planKekaSync([...employees, ...extra.filter((e): e is KekaEmployee => !!e)], ctx, now)
  if (!commit) return { plan }

  const result = await applyImport(plan, ctx)
  await stampSynced(plan.syncedEmails, now)
  await prisma.systemSettings.upsert({ where: { id: 'system' }, update: { kekaLastSyncAt: now }, create: { id: 'system', kekaLastSyncAt: now } })
  return { plan, result }
}

/** Daily auto-sync runs only after an admin's first confirmed sync, then every ~23 h. */
export async function kekaSyncDue(now = new Date()): Promise<boolean> {
  if (!isKekaConfigured()) return false
  const s = await prisma.systemSettings.findUnique({ where: { id: 'system' }, select: { kekaLastSyncAt: true } })
  return !!s?.kekaLastSyncAt && now.getTime() - s.kekaLastSyncAt.getTime() >= AUTO_SYNC_EVERY_MS
}

export async function getKekaSyncStatus() {
  const s = await prisma.systemSettings.findUnique({ where: { id: 'system' }, select: { kekaLastSyncAt: true } })
  return { configured: isKekaConfigured(), lastSyncAt: s?.kekaLastSyncAt ?? null }
}

/** Sync a single Keka employee into the app (sign-in provisioning / refresh). */
async function syncOne(e: KekaEmployee): Promise<'applied' | 'invalid'> {
  const ctx = await loadImportContext('')
  const plan = planKekaSync([e], ctx)
  const row = plan.rows[0]
  if (!row || row.action === 'error') {
    console.warn(`[keka-sync] employee ${e.id} could not be synced: ${row?.errors.join('; ') ?? plan.skipped[0]?.reason ?? 'skipped'}`)
    return 'invalid'
  }
  await applyImport(plan, ctx)
  await stampSynced([row.email], new Date())
  return 'applied'
}

export type ProvisionOutcome = 'created' | 'not_found' | 'relieved' | 'invalid' | 'unavailable' | 'not_configured'

/** Sign-in of an email that isn't in the app: create them from Keka if they are an active employee. */
export async function provisionFromKeka(email: string): Promise<ProvisionOutcome> {
  if (!isKekaConfigured()) return 'not_configured'
  let e: KekaEmployee | null
  try {
    e = await findKekaEmployeeByEmail(email)
  } catch (err) {
    console.error('[keka-sync] lookup failed during sign-in:', err instanceof KekaUnavailableError ? err.message : err)
    return 'unavailable'
  }
  if (!e) return 'not_found'
  if (!isKekaActive(e)) return 'relieved'
  try {
    return (await syncOne(e)) === 'applied' ? 'created' : 'invalid'
  } catch (err) {
    // Two sign-ins racing: the other one created the user — that's a success
    const exists = await prisma.user.findUnique({ where: { email: e.email }, select: { id: true } })
    if (exists) return 'created'
    console.error('[keka-sync] provisioning failed:', err instanceof Error ? err.message : err)
    return 'unavailable'
  }
}

/** Background refresh for a signed-in user whose Keka data is stale. Never throws. */
export async function refreshFromKeka(email: string): Promise<void> {
  try {
    const e = await findKekaEmployeeByEmail(email)
    if (e) await syncOne(e)
  } catch (err) {
    console.warn('[keka-sync] background refresh failed:', err instanceof Error ? err.message : err)
  }
}

// ── Keka-owned fields are read-only in the app for synced users ─────

/** User columns the Keka sync owns. Editing them in the app would be reverted by the next sync. */
export const KEKA_OWNED_FIELDS = ['name', 'email', 'title', 'departmentId', 'reportsToId', 'phone', 'country', 'kekaEmployeeId'] as const
export type KekaOwnedField = (typeof KEKA_OWNED_FIELDS)[number]

const FIELD_NAMES: Record<KekaOwnedField, string> = {
  name: 'name', email: 'email', title: 'job title', departmentId: 'department', reportsToId: 'manager', phone: 'phone',
  country: 'country', kekaEmployeeId: 'Keka ID',
}
const norm = (v: unknown) => (v === undefined || v === '' ? null : v)

/** True when this user's HR fields come from Keka (synced at least once and Keka still configured). */
export const isKekaManaged = (user: { kekaSyncedAt: Date | null }) => isKekaConfigured() && !!user.kekaSyncedAt

/**
 * Human names of Keka-owned fields the patch would change on a Keka-managed user (empty = allowed).
 * Fields absent from the patch, or equal to the current value, are fine.
 */
export function lockedFieldChanges(user: Partial<Record<KekaOwnedField, unknown>> & { kekaSyncedAt: Date | null }, patch: Record<string, unknown>): string[] {
  if (!isKekaManaged(user)) return []
  return KEKA_OWNED_FIELDS.filter((f) => patch[f] !== undefined && norm(patch[f]) !== norm(user[f])).map((f) => FIELD_NAMES[f])
}

export const lockedMessage = (fields: string[]) =>
  `${fields.join(', ')} ${fields.length === 1 ? 'is' : 'are'} managed in Keka. Change it in Keka; the app picks it up on the next daily sync.`
