/**
 * User import/export (Admin → Bulk Import).
 *
 * One CSV format for the template, the export and the import, so "export → edit in Sheets →
 * re-import" is a bulk update. Import is two-phase: `planImport` (pure, no I/O) decides per row
 * what would happen — create / update / unchanged / error — and `applyImport` writes the valid
 * rows in one transaction. The route runs plan for the preview and plan + apply on confirm, so
 * nothing is written from a stale preview.
 *
 * Rules (agreed with product):
 * - email is the key: new email → create, existing email → update.
 * - A blank cell never clears a value on an existing user ("keep current").
 * - Rows with errors are skipped; valid rows are imported; an error report CSV lists the rest.
 * - Users missing from the file are untouched; deactivation only via status=Inactive.
 * - Departments are created on demand (case/space-insensitive match).
 * - Managers can be referenced by email in any row order; anyone who ends up with a direct
 *   report and is an Employee is promoted to Manager (REPORTER).
 */
import type { Prisma, UserRole } from '@prisma/client'
import { prisma } from './prisma'
import { isAllowedEmail, ALLOWED_EMAIL_DOMAIN } from './constants'
import { isValidTimeZone } from './dates'
import { IMPORT_COLUMNS, type ImportColumn } from './user-import-columns'
import { COUNTRY_OPTIONS, getDefaultTimeZoneForCountry, getDefaultWorkHoursForCountry } from './timezones'

export const MAX_IMPORT_ROWS = 1000

// ── CSV ─────────────────────────────────────────────────────────────

/** Pick the delimiter Excel used (comma, semicolon in some locales, or tab) from the header line. */
function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/))
  let best = ','
  let bestCount = -1
  for (const d of [',', ';', '\t']) {
    let count = 0
    let inQuotes = false
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes
      else if (ch === d && !inQuotes) count++
    }
    if (count > bestCount) {
      best = d
      bestCount = count
    }
  }
  return best
}

/**
 * RFC 4180 parser: quoted fields, "" escapes, commas/newlines inside quotes, CRLF/LF/CR line
 * endings, UTF-8 BOM, and comma/semicolon/tab delimiters. Fully blank lines are dropped.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '')
  const delimiter = detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    if (row.some((c) => c.trim() !== '')) rows.push(row)
    row = []
  }
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
      } else {
        field += ch
      }
      i++
      continue
    }
    if (ch === '"' && field === '') inQuotes = true
    else if (ch === delimiter) endField()
    else if (ch === '\r') {
      endRow()
      if (text[i + 1] === '\n') i++
    } else if (ch === '\n') endRow()
    else field += ch
    i++
  }
  if (field !== '' || row.length > 0) endRow()
  return rows
}

/** Cells that Excel/Sheets would run as a formula get a leading apostrophe (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/

/** Plain numbers / phone numbers ("+91 98765 43210", "-5") are not formulas and stay readable. */
const PHONE_LIKE = /^[+-]?[\d\s().-]+$/
const needsGuard = (v: string) => FORMULA_START.test(v) && !PHONE_LIKE.test(v)

function csvCell(value: string): string {
  const v = needsGuard(value) ? `'${value}` : value
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** Undo csvCell's formula guard on the way back in ("'+91 98…" → "+91 98…"). */
const unguard = (v: string) => (v.startsWith("'") && FORMULA_START.test(v.slice(1)) ? v.slice(1) : v)

// ── Columns ─────────────────────────────────────────────────────────

export { IMPORT_COLUMNS, COLUMN_HELP, type ImportColumn } from './user-import-columns'
/** `name` (full name) is accepted for files made with the old template; not exported. */
type InputColumn = ImportColumn | 'full_name'

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const HEADER_ALIASES: Record<string, InputColumn> = {}
const alias = (col: InputColumn, ...names: string[]) => names.forEach((n) => (HEADER_ALIASES[squash(n)] = col))
alias('email', 'email', 'email address', 'work email', 'mail', 'e-mail')
alias('first_name', 'first_name', 'first name', 'fname', 'given name', 'first')
alias('last_name', 'last_name', 'last name', 'lname', 'surname', 'family name', 'last')
alias('full_name', 'name', 'full name', 'employee name', 'display name')
alias('role', 'role', 'user role', 'access', 'access role')
alias('department', 'department', 'dept', 'team', 'department name')
alias('manager_email', 'manager_email', 'manager email', 'manager', 'reports to', 'reportsTo', 'reporting manager', 'reporting to', 'supervisor', 'supervisor email', 'line manager')
alias('job_title', 'job_title', 'job title', 'title', 'designation', 'position')
alias('phone', 'phone', 'phone number', 'mobile', 'mobile number', 'contact', 'contact number')
alias('country', 'country', 'location')
alias('time_zone', 'time_zone', 'time zone', 'timezone', 'tz')
alias('work_start', 'work_start', 'work start', 'work day start', 'start time', 'shift start')
alias('work_end', 'work_end', 'work end', 'work day end', 'end time', 'shift end')
alias('keka_employee_id', 'keka_employee_id', 'keka employee id', 'keka id', 'employee id', 'emp id', 'employee code')
alias('status', 'status', 'active', 'is active')

export function mapHeaders(headers: string[]): { columns: (InputColumn | null)[]; ignored: string[] } {
  const seen = new Set<InputColumn>()
  const ignored: string[] = []
  const columns = headers.map((h) => {
    const col = HEADER_ALIASES[squash(h)] ?? null
    if (!col || seen.has(col)) {
      if (h.trim()) ignored.push(h.trim())
      return null
    }
    seen.add(col)
    return col
  })
  return { columns, ignored }
}

// ── Value parsers (exported for tests) ──────────────────────────────

const ROLE_ALIASES: Record<string, UserRole> = {
  employee: 'EMPLOYEE', member: 'EMPLOYEE', staff: 'EMPLOYEE', user: 'EMPLOYEE',
  manager: 'REPORTER', reporter: 'REPORTER', teamlead: 'REPORTER', lead: 'REPORTER', teamleadreporter: 'REPORTER',
  admin: 'SUPER_ADMIN', superadmin: 'SUPER_ADMIN', administrator: 'SUPER_ADMIN',
}
export const parseRole = (v: string): UserRole | null => ROLE_ALIASES[squash(v)] ?? null
export const ROLE_LABEL: Record<UserRole, string> = { EMPLOYEE: 'Employee', REPORTER: 'Manager', SUPER_ADMIN: 'Admin' }

const COUNTRY_ALIASES: Record<string, string> = {
  in: 'IN', ind: 'IN', india: 'IN',
  us: 'US', usa: 'US', unitedstates: 'US', unitedstatesofamerica: 'US', america: 'US',
  sg: 'SG', sgp: 'SG', singapore: 'SG',
  gb: 'GB', uk: 'GB', unitedkingdom: 'GB', england: 'GB', greatbritain: 'GB', britain: 'GB',
  au: 'AU', aus: 'AU', australia: 'AU',
  other: 'OTHER',
}
export const parseCountry = (v: string): string | null => COUNTRY_ALIASES[squash(v)] ?? null
const countryLabel = (code: string | null) => COUNTRY_OPTIONS.find((c) => c.value === code)?.label ?? code ?? ''

const TZ_ALIASES: Record<string, string> = {
  ist: 'Asia/Kolkata', india: 'Asia/Kolkata',
  sgt: 'Asia/Singapore',
  est: 'America/New_York', edt: 'America/New_York', et: 'America/New_York', eastern: 'America/New_York',
  cst: 'America/Chicago', cdt: 'America/Chicago', ct: 'America/Chicago', central: 'America/Chicago',
  mst: 'America/Denver', mdt: 'America/Denver', mt: 'America/Denver', mountain: 'America/Denver',
  pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles', pt: 'America/Los_Angeles', pacific: 'America/Los_Angeles',
  gmt: 'Europe/London', bst: 'Europe/London', uk: 'Europe/London',
  aest: 'Australia/Sydney', aedt: 'Australia/Sydney',
  utc: 'UTC',
}
export function parseTimeZone(v: string): string | null {
  const a = TZ_ALIASES[squash(v)]
  if (a) return a
  return isValidTimeZone(v.trim()) ? v.trim() : null
}

/** "9", "9:30", "09:30", "9:30 PM", "21:00" → "HH:mm" */
export function parseTime(v: string): string | null {
  const m = v.trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  const ampm = m[3]?.[0]
  if (min > 59) return null
  if (ampm) {
    if (h < 1 || h > 12) return null
    if (ampm === 'p' && h !== 12) h += 12
    if (ampm === 'a' && h === 12) h = 0
  } else if (h > 23) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

const STATUS_ALIASES: Record<string, boolean> = {
  active: true, yes: true, y: true, true: true, '1': true, enabled: true,
  inactive: false, no: false, n: false, false: false, '0': false, disabled: false, deactivated: false,
}
export const parseStatus = (v: string): boolean | null => STATUS_ALIASES[squash(v)] ?? null

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ── Planning ────────────────────────────────────────────────────────

export interface ExistingUser {
  id: string
  email: string
  name: string
  role: UserRole
  isActive: boolean
  departmentId: string | null
  reportsToId: string | null
  title: string | null
  phone: string | null
  country: string | null
  timeZone: string | null
  workDayStart: string | null
  workDayEnd: string | null
  kekaEmployeeId: string | null
}

export interface ImportContext {
  users: ExistingUser[]
  departments: { id: string; name: string }[]
  /** The admin running the import — cannot change their own role or deactivate themselves here. */
  actorEmail: string
}

/** Resolved values; `undefined` = leave as is (blank cell on an existing user). */
export interface RowData {
  name?: string
  role?: UserRole
  /** lower-cased, space-collapsed department key */
  department?: string
  managerEmail?: string
  title?: string
  phone?: string
  country?: string
  timeZone?: string
  workDayStart?: string
  workDayEnd?: string
  kekaEmployeeId?: string
  isActive?: boolean
}

export type RowAction = 'create' | 'update' | 'unchanged' | 'error'

export interface PlannedRow {
  /** 1-based line number in the file (header = line 1) */
  line: number
  email: string
  name: string
  action: RowAction
  /** Human labels of fields that change, for the preview */
  changes: string[]
  errors: string[]
  warnings: string[]
  /** Raw cell values, for the error report */
  raw: Record<string, string>
  data: RowData
  existingId?: string
}

export interface ImportPlan {
  rows: PlannedRow[]
  ignoredColumns: string[]
  /** Departments that will be created (display names) */
  newDepartments: string[]
  /** Existing users outside the file promoted to Manager because someone now reports to them */
  promotions: { email: string; name: string }[]
  summary: Record<RowAction, number>
  /** File-level problem (no header, no email column, too many rows) — nothing can be planned */
  fatal?: string
}

const deptKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()
const FIELD_LABEL: Record<keyof RowData, string> = {
  name: 'name', role: 'role', department: 'department', managerEmail: 'manager', title: 'job title', phone: 'phone',
  country: 'country', timeZone: 'time zone', workDayStart: 'work start', workDayEnd: 'work end',
  kekaEmployeeId: 'Keka ID', isActive: 'status',
}

function emptyPlan(fatal: string, ignoredColumns: string[] = []): ImportPlan {
  return { rows: [], ignoredColumns, newDepartments: [], promotions: [], summary: { create: 0, update: 0, unchanged: 0, error: 0 }, fatal }
}

/** Decide what importing `csv` would do. Pure — safe to call for the preview. */
export function planImport(csv: string, ctx: ImportContext): ImportPlan {
  const table = parseCsv(csv)
  if (table.length === 0) return emptyPlan('The file is empty.')
  const { columns, ignored } = mapHeaders(table[0])
  if (!columns.includes('email')) return emptyPlan('No email column found. Download the template to see the expected columns.', ignored)
  const dataRows = table.slice(1)
  if (dataRows.length === 0) return emptyPlan('The file has a header row but no users.', ignored)
  if (dataRows.length > MAX_IMPORT_ROWS) return emptyPlan(`Too many rows (${dataRows.length}). Import at most ${MAX_IMPORT_ROWS} at a time.`, ignored)

  const byEmail = new Map(ctx.users.map((u) => [u.email.toLowerCase(), u]))
  const byId = new Map(ctx.users.map((u) => [u.id, u]))
  const deptById = new Map(ctx.departments.map((d) => [d.id, d]))
  const deptByKey = new Map(ctx.departments.map((d) => [deptKey(d.name), d]))
  const actorEmail = ctx.actorEmail.toLowerCase()

  // 1. Per-row parsing and field validation
  const seenEmails = new Map<string, number>()
  const rows: PlannedRow[] = dataRows.map((cells, idx) => {
    const raw: Record<string, string> = {}
    const val: Partial<Record<InputColumn, string>> = {}
    columns.forEach((col, i) => {
      const cell = unguard((cells[i] ?? '').trim())
      if (col) {
        val[col] = cell
        raw[col === 'full_name' ? 'name' : col] = cell
      }
    })
    const line = idx + 2
    const errors: string[] = []
    const warnings: string[] = []
    const data: RowData = {}
    const email = (val.email ?? '').toLowerCase()
    const existing = byEmail.get(email)

    if (!email) errors.push('Email is missing')
    else if (!EMAIL_RE.test(email) || email.length > 254) errors.push(`"${val.email}" is not a valid email`)
    else if (!existing && !isAllowedEmail(email)) errors.push(`Only ${ALLOWED_EMAIL_DOMAIN} emails can be imported`)
    else if (seenEmails.has(email)) errors.push(`Same email as line ${seenEmails.get(email)}`)
    if (email && !seenEmails.has(email)) seenEmails.set(email, line)

    // Name: first + last, or the old single "name" column
    const first = val.first_name ?? ''
    const last = val.last_name ?? ''
    const full = val.full_name ?? ''
    const name = first || last ? [first, last].filter(Boolean).join(' ') : full
    if (first === '' && last !== '') errors.push('first_name is required when last_name is set')
    else if (name) {
      if (name.length > 120) errors.push('Name is longer than 120 characters')
      else data.name = name
    } else if (!existing) errors.push('first_name is required for new users')

    if (val.role) {
      const role = parseRole(val.role)
      if (role) data.role = role
      else errors.push(`Unknown role "${val.role}" — use Employee, Manager or Admin`)
    }
    if (val.department) {
      if (val.department.length > 80) errors.push('Department is longer than 80 characters')
      else data.department = deptKey(val.department)
    }
    if (val.manager_email) {
      const m = val.manager_email.toLowerCase()
      if (!EMAIL_RE.test(m)) errors.push(`manager_email "${val.manager_email}" is not an email — use the manager's email address`)
      else if (m === email) errors.push('A user cannot report to themselves')
      else data.managerEmail = m
    }
    if (val.job_title) {
      if (val.job_title.length > 120) errors.push('Job title is longer than 120 characters')
      else data.title = val.job_title
    }
    if (val.phone) {
      if (val.phone.replace(/\D/g, '').length < 10 || val.phone.length > 30) errors.push(`Phone "${val.phone}" needs at least 10 digits`)
      else data.phone = val.phone
    }
    if (val.country) {
      const c = parseCountry(val.country)
      if (c) data.country = c
      else errors.push(`Unknown country "${val.country}" — use India, United States, Singapore, United Kingdom, Australia or Other`)
    }
    if (val.time_zone) {
      const tz = parseTimeZone(val.time_zone)
      if (tz) data.timeZone = tz
      else errors.push(`Unknown time zone "${val.time_zone}" — use IST, EST, CST, MST, PST or a zone like Asia/Kolkata`)
    }
    for (const [col, key] of [['work_start', 'workDayStart'], ['work_end', 'workDayEnd']] as const) {
      if (!val[col]) continue
      const t = parseTime(val[col]!)
      if (t) data[key] = t
      else errors.push(`${col} "${val[col]}" is not a time — use 11:00 or 11:00 AM`)
    }
    if (val.keka_employee_id) {
      if (val.keka_employee_id.length > 50) errors.push('Keka employee ID is longer than 50 characters')
      else data.kekaEmployeeId = val.keka_employee_id
    }
    if (val.status) {
      const s = parseStatus(val.status)
      if (s === null) errors.push(`Unknown status "${val.status}" — use Active or Inactive`)
      else data.isActive = s
    }

    // The admin running the import can't lock themselves out
    if (email && email === actorEmail && existing) {
      if (data.role && data.role !== existing.role) errors.push('You cannot change your own role by import')
      if (data.isActive === false) errors.push('You cannot deactivate yourself by import')
    }

    // Country fills time zone / hours that are blank in the file and not set on the user yet
    const country = data.country ?? existing?.country ?? null
    if (country && data.country) {
      if (!data.timeZone && !existing?.timeZone && country !== 'OTHER') data.timeZone = getDefaultTimeZoneForCountry(country)
      const hours = getDefaultWorkHoursForCountry(country)
      if (!data.workDayStart && !existing?.workDayStart && country !== 'OTHER') data.workDayStart = hours.start
      if (!data.workDayEnd && !existing?.workDayEnd && country !== 'OTHER') data.workDayEnd = hours.end
    }
    if (data.workDayStart && data.workDayEnd && data.workDayStart === data.workDayEnd) errors.push('work_start and work_end are the same')

    return {
      line,
      email,
      name: data.name ?? existing?.name ?? email,
      action: errors.length ? 'error' : existing ? 'update' : 'create',
      changes: [],
      errors,
      warnings,
      raw,
      data,
      existingId: existing?.id,
    }
  })

  const rowByEmail = new Map<string, PlannedRow>()
  for (const r of rows) if (r.email && !rowByEmail.has(r.email)) rowByEmail.set(r.email, r)
  const isValid = (r: PlannedRow | undefined) => !!r && r.action !== 'error'
  const fail = (r: PlannedRow, msg: string) => {
    r.errors.push(msg)
    r.action = 'error'
  }

  // 2. Managers: must exist (in a valid row or in the system), no reporting loops.
  //    Repeat until stable: a failed manager row fails the rows that report to it.
  const managerOf = (email: string): string | null => {
    const r = rowByEmail.get(email)
    if (isValid(r) && r!.data.managerEmail) return r!.data.managerEmail
    const u = byEmail.get(email)
    return u?.reportsToId ? byId.get(u.reportsToId)?.email.toLowerCase() ?? null : null
  }
  for (let changed = true; changed; ) {
    changed = false
    for (const r of rows) {
      const m = r.data.managerEmail
      if (!isValid(r) || !m) continue
      const mRow = rowByEmail.get(m)
      if (mRow && !isValid(mRow)) {
        fail(r, `Manager ${m} is on line ${mRow.line}, which has errors`)
        changed = true
        continue
      }
      if (!mRow && !byEmail.has(m)) {
        fail(r, `Manager ${m} is not in the system or in this file`)
        changed = true
        continue
      }
      // Walk up the chain; coming back to this user is a loop
      const chain = [r.email, m]
      for (let cur: string | null = m, hops = 0; cur && hops < 500; hops++) {
        cur = managerOf(cur)
        if (!cur) break
        chain.push(cur)
        if (cur === r.email) {
          fail(r, `Reporting loop: ${chain.join(' → ')}`)
          changed = true
          break
        }
      }
    }
  }

  // 3. Promote managers who would otherwise be Employees
  const promotions: { email: string; name: string }[] = []
  const promotedOutsideFile = new Set<string>()
  for (const r of rows) {
    const m = r.data.managerEmail
    if (!isValid(r) || !m) continue
    const mRow = rowByEmail.get(m)
    const mUser = byEmail.get(m)
    if (mRow) {
      const finalRole = mRow.data.role ?? mUser?.role ?? 'EMPLOYEE'
      if (finalRole === 'EMPLOYEE') {
        mRow.data.role = 'REPORTER'
        mRow.warnings.push(`Set to Manager because ${r.email} reports to them`)
      }
    } else if (mUser && mUser.role === 'EMPLOYEE' && !promotedOutsideFile.has(m)) {
      promotedOutsideFile.add(m)
      promotions.push({ email: mUser.email, name: mUser.name })
    }
    if (mUser && !mUser.isActive && rowByEmail.get(m)?.data.isActive !== true) r.warnings.push(`Manager ${m} is inactive`)
  }

  // 4. Departments to create + diff against existing users
  const newDepartments = new Map<string, string>()
  for (const r of rows) {
    if (!isValid(r) || !r.data.department) continue
    if (!deptByKey.has(r.data.department) && !newDepartments.has(r.data.department)) {
      newDepartments.set(r.data.department, (r.raw.department ?? '').trim().replace(/\s+/g, ' '))
    }
  }
  for (const r of rows) {
    if (!isValid(r)) continue
    const u = r.existingId ? byId.get(r.existingId) : undefined
    if (!u) {
      r.changes = (Object.keys(r.data) as (keyof RowData)[]).map((k) => FIELD_LABEL[k])
      continue
    }
    const current: Record<keyof RowData, unknown> = {
      name: u.name,
      role: u.role,
      department: u.departmentId ? deptKey(deptById.get(u.departmentId)?.name ?? '') : undefined,
      managerEmail: u.reportsToId ? byId.get(u.reportsToId)?.email.toLowerCase() : undefined,
      title: u.title ?? undefined,
      phone: u.phone ?? undefined,
      country: u.country ?? undefined,
      timeZone: u.timeZone ?? undefined,
      workDayStart: u.workDayStart ?? undefined,
      workDayEnd: u.workDayEnd ?? undefined,
      kekaEmployeeId: u.kekaEmployeeId ?? undefined,
      isActive: u.isActive,
    }
    for (const k of Object.keys(r.data) as (keyof RowData)[]) {
      if (r.data[k] === current[k]) delete r.data[k]
      else r.changes.push(FIELD_LABEL[k])
    }
    if (r.changes.length === 0) r.action = 'unchanged'
  }

  const summary = { create: 0, update: 0, unchanged: 0, error: 0 }
  for (const r of rows) summary[r.action]++
  // Departments only referenced by rows that are now "unchanged" don't need creating
  const neededDepts = new Set(rows.filter((r) => r.action === 'create' || r.action === 'update').map((r) => r.data.department))
  return {
    rows,
    ignoredColumns: ignored,
    newDepartments: [...newDepartments].filter(([k]) => neededDepts.has(k)).map(([, display]) => display),
    promotions,
    summary,
  }
}

// ── Apply ───────────────────────────────────────────────────────────

export interface ImportResult {
  created: number
  updated: number
  promoted: number
  departmentsCreated: number
  failed: number
}

export async function loadImportContext(actorEmail: string): Promise<ImportContext> {
  const [users, departments] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true, email: true, name: true, role: true, isActive: true, departmentId: true, reportsToId: true, title: true,
        phone: true, country: true, timeZone: true, workDayStart: true, workDayEnd: true, kekaEmployeeId: true,
      },
    }),
    prisma.department.findMany({ select: { id: true, name: true } }),
  ])
  return { users, departments, actorEmail }
}

/** Write every create/update row of the plan in one transaction. Error and unchanged rows are skipped. */
export async function applyImport(plan: ImportPlan, ctx: ImportContext): Promise<ImportResult> {
  const work = plan.rows.filter((r) => r.action === 'create' || r.action === 'update')
  const result: ImportResult = { created: 0, updated: 0, promoted: plan.promotions.length, departmentsCreated: 0, failed: plan.summary.error }
  if (work.length === 0 && plan.promotions.length === 0) return result

  await prisma.$transaction(
    async (tx) => {
      const deptIds = new Map(ctx.departments.map((d) => [deptKey(d.name), d.id]))
      for (const name of plan.newDepartments) {
        const d = await tx.department.create({ data: { name } })
        deptIds.set(deptKey(name), d.id)
        result.departmentsCreated++
      }
      const ids = new Map(ctx.users.map((u) => [u.email.toLowerCase(), u.id]))

      const fields = (d: RowData) => {
        const out: Prisma.UserUncheckedUpdateInput = {}
        if (d.name !== undefined) out.name = d.name
        if (d.role !== undefined) out.role = d.role
        if (d.department !== undefined) out.departmentId = deptIds.get(d.department) ?? null
        if (d.title !== undefined) out.title = d.title
        if (d.phone !== undefined) out.phone = d.phone
        if (d.country !== undefined) out.country = d.country
        if (d.timeZone !== undefined) out.timeZone = d.timeZone
        if (d.workDayStart !== undefined) out.workDayStart = d.workDayStart
        if (d.workDayEnd !== undefined) out.workDayEnd = d.workDayEnd
        if (d.kekaEmployeeId !== undefined) out.kekaEmployeeId = d.kekaEmployeeId
        if (d.isActive !== undefined) out.isActive = d.isActive
        return out
      }

      // Users first (managers may be new rows anywhere in the file), then reporting lines
      for (const r of work) {
        if (r.action === 'create') {
          const u = await tx.user.create({ data: { ...fields(r.data), email: r.email } as Prisma.UserUncheckedCreateInput })
          ids.set(r.email, u.id)
          result.created++
        } else {
          const data = fields(r.data)
          if (Object.keys(data).length > 0) await tx.user.update({ where: { id: r.existingId! }, data })
          result.updated++
        }
      }
      for (const r of work) {
        if (r.data.managerEmail === undefined) continue
        await tx.user.update({ where: { id: ids.get(r.email)! }, data: { reportsToId: ids.get(r.data.managerEmail) ?? null } })
      }
      for (const p of plan.promotions) {
        await tx.user.update({ where: { id: ids.get(p.email.toLowerCase())! }, data: { role: 'REPORTER' } })
      }
    },
    { timeout: 120_000 }
  )
  return result
}

// ── CSV outputs ─────────────────────────────────────────────────────

/** Failed rows with their original values and an `error` column, ready to fix and re-upload. */
export function errorReportCsv(plan: ImportPlan): string | null {
  const failed = plan.rows.filter((r) => r.action === 'error')
  if (failed.length === 0) return null
  return toCsv([
    ['line', ...IMPORT_COLUMNS, 'error'],
    ...failed.map((r) => [String(r.line), ...IMPORT_COLUMNS.map((c) => r.raw[c] ?? (c === 'first_name' ? r.raw.name ?? '' : '')), r.errors.join('; ')]),
  ])
}

/** Template: header plus two example rows (a manager and their report). */
export function templateCsv(): string {
  const d = ALLOWED_EMAIL_DOMAIN
  return toCsv([
    [...IMPORT_COLUMNS],
    [`priya.shah${d}`, 'Priya', 'Shah', 'Manager', 'Engineering', '', 'Engineering Manager', '+91 98765 43210', 'India', 'IST', '11:00', '20:00', 'WLIQ001', 'Active'],
    [`rahul.mehta${d}`, 'Rahul', 'Mehta', 'Employee', 'Engineering', `priya.shah${d}`, 'Software Engineer', '', 'India', '', '', '', '', 'Active'],
  ])
}

type ExportUser = ExistingUser & { department: { name: string } | null; reportsTo: { email: string } | null }

/** Every user in import format; name split at the first space so re-import rebuilds it unchanged. */
export function exportUsersCsv(users: ExportUser[]): string {
  return toCsv([
    [...IMPORT_COLUMNS],
    ...users.map((u) => {
      const [first, ...rest] = u.name.trim().split(/\s+/)
      return [
        u.email, first ?? '', rest.join(' '), ROLE_LABEL[u.role], u.department?.name ?? '', u.reportsTo?.email ?? '', u.title ?? '',
        u.phone ?? '', u.country ? countryLabel(u.country) : '', u.timeZone ?? '', u.workDayStart ?? '', u.workDayEnd ?? '',
        u.kekaEmployeeId ?? '', u.isActive ? 'Active' : 'Inactive',
      ]
    }),
  ])
}

export async function exportAllUsersCsv(): Promise<string> {
  const users = await prisma.user.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: {
      id: true, email: true, name: true, role: true, isActive: true, departmentId: true, reportsToId: true, title: true,
      phone: true, country: true, timeZone: true, workDayStart: true, workDayEnd: true, kekaEmployeeId: true,
      department: { select: { name: true } },
      reportsTo: { select: { email: true } },
    },
  })
  return exportUsersCsv(users)
}
