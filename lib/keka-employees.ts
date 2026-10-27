/**
 * Keka employee directory (HRIS) — the read side of lib/keka-sync.ts.
 *
 * Every Keka record is reduced to the handful of work fields we use (pickEmployee) the moment it
 * arrives, so personal data Keka also returns (date of birth, addresses, personal email, family,
 * blood group…) never reaches the rest of the app, the logs or the database.
 *
 * Verified against the live tenant: `employmentStatus` 0 = working; department is the `groups`
 * entry with groupType 2 (3 = location, 9 = legal entity); `reportsTo` carries the manager's email.
 * The list endpoint's status filter is not trusted — status is read per record.
 */
import { getBaseUrl, getKekaAccessToken } from './keka'

export interface KekaEmployee {
  id: string
  email: string
  firstName: string
  lastName: string
  employeeNumber: string | null
  jobTitle: string | null
  /** groupType 2 */
  department: string | null
  managerEmail: string | null
  countryCode: string | null
  workPhone: string | null
  mobilePhone: string | null
  /** YYYY-MM-DD */
  joiningDate: string | null
  /** ISO timestamp */
  exitDate: string | null
  employmentStatus: number | null
}

export const KEKA_DEPARTMENT_GROUP_TYPE = 2

/** Keka or the network failed — callers decide whether that blocks (sign-in) or is retried (sync). */
export class KekaUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KekaUnavailableError'
  }
}

type Raw = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Keep only the work fields we use. */
export function pickEmployee(raw: Raw): KekaEmployee | null {
  const id = str(raw.id)
  if (!id) return null
  const groups = Array.isArray(raw.groups) ? (raw.groups as Raw[]) : []
  const dept = groups.find((g) => g?.groupType === KEKA_DEPARTMENT_GROUP_TYPE)
  const jobTitle = raw.jobTitle as Raw | null | undefined
  const reportsTo = raw.reportsTo as Raw | null | undefined
  return {
    id,
    email: (str(raw.email) ?? '').toLowerCase(),
    firstName: str(raw.firstName) ?? str(raw.displayName) ?? '',
    lastName: str(raw.lastName) ?? '',
    employeeNumber: str(raw.employeeNumber),
    jobTitle: str(jobTitle?.title),
    department: str(dept?.title),
    managerEmail: str(reportsTo?.email)?.toLowerCase() ?? null,
    countryCode: str(raw.countryCode),
    workPhone: str(raw.workPhone),
    mobilePhone: str(raw.mobilePhone),
    joiningDate: str(raw.joiningDate)?.slice(0, 10) ?? null,
    exitDate: str(raw.exitDate),
    employmentStatus: typeof raw.employmentStatus === 'number' ? raw.employmentStatus : null,
  }
}

/** Working and not past an exit date. */
export function isKekaActive(e: KekaEmployee, now = new Date()): boolean {
  if (e.employmentStatus !== null && e.employmentStatus !== 0) return false
  if (e.exitDate && new Date(e.exitDate).getTime() <= now.getTime()) return false
  return true
}

async function kekaRequest(path: string, init?: RequestInit): Promise<{ status: number; body: Raw | null }> {
  const base = getBaseUrl()
  const token = await getKekaAccessToken()
  if (!base || !token) throw new KekaUnavailableError('Keka is not configured or the token request failed')
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'oneonone', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    throw new KekaUnavailableError(`Keka request failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (res.status === 404) return { status: 404, body: null }
  if (!res.ok) throw new KekaUnavailableError(`Keka ${path.split('?')[0]} returned ${res.status}`)
  return { status: res.status, body: (await res.json().catch(() => null)) as Raw | null }
}

/** Every employee the directory lists (working ones; leavers are found per id). 200 per page. */
export async function fetchKekaEmployees(): Promise<KekaEmployee[]> {
  const out: KekaEmployee[] = []
  for (let page = 1; page <= 50; page++) {
    const { body } = await kekaRequest(`/hris/employees?pageNumber=${page}&pageSize=200`)
    const data = Array.isArray(body?.data) ? (body!.data as Raw[]) : []
    for (const raw of data) {
      const e = pickEmployee(raw)
      if (e) out.push(e)
    }
    const totalPages = typeof body?.totalPages === 'number' ? body.totalPages : 1
    if (page >= totalPages || data.length === 0) break
  }
  return out
}

export async function fetchKekaEmployee(id: string): Promise<KekaEmployee | null> {
  const { body } = await kekaRequest(`/hris/employees/${encodeURIComponent(id)}`)
  const data = body?.data
  return data && typeof data === 'object' && !Array.isArray(data) ? pickEmployee(data as Raw) : null
}

/** Exact work-email lookup (the generic list `searchKey` does not match emails). */
export async function findKekaEmployeeByEmail(email: string): Promise<KekaEmployee | null> {
  const { body } = await kekaRequest('/hris/employees/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workEmail: email }),
  })
  const data = body?.data
  const raw = Array.isArray(data) ? (data[0] as Raw | undefined) : (data as Raw | undefined)
  if (!raw || typeof raw !== 'object') return null
  const e = pickEmployee(raw)
  return e && e.email === email.toLowerCase() ? e : null
}
