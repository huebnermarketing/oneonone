import { describe, it, expect, vi } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'
import {
  applyImport,
  exportUsersCsv,
  mapHeaders,
  parseCsv,
  parseCountry,
  parseDateOnly,
  planRecords,
  parseRole,
  parseStatus,
  parseTime,
  parseTimeZone,
  planImport,
  templateCsv,
  toCsv,
  type ExistingUser,
  type ImportContext,
} from '@/lib/user-import'

const base: Omit<ExistingUser, 'id' | 'email' | 'name'> = {
  role: 'EMPLOYEE', isActive: true, departmentId: null, reportsToId: null, title: null, phone: null,
  country: null, timeZone: null, workDayStart: null, workDayEnd: null, kekaEmployeeId: null, employeeNumber: null, joiningDate: null,
}
const u = (id: string, email: string, name: string, extra: Partial<ExistingUser> = {}): ExistingUser => ({ ...base, id, email, name, ...extra })

function ctx(users: ExistingUser[] = [], departments = [{ id: 'd1', name: 'Engineering' }]): ImportContext {
  return { users: [u('admin', 'admin@example.com', 'Admin User', { role: 'SUPER_ADMIN' }), ...users], departments, actorEmail: 'admin@example.com' }
}
const row = (plan: ReturnType<typeof planImport>, email: string) => plan.rows.find((r) => r.email === email)!

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded commas/newlines, CRLF, BOM and blank lines', () => {
    const text = '﻿name,title\r\n"Doe, John","He said ""hi""\nnext"\r\n\r\nJane,Lead\r\n'
    expect(parseCsv(text)).toEqual([['name', 'title'], ['Doe, John', 'He said "hi"\nnext'], ['Jane', 'Lead']])
  })
  it('detects semicolon and tab delimiters (Excel locales)', () => {
    expect(parseCsv('email;role\na@x.com;Manager')).toEqual([['email', 'role'], ['a@x.com', 'Manager']])
    expect(parseCsv('email\trole\na@x.com\tAdmin')).toEqual([['email', 'role'], ['a@x.com', 'Admin']])
  })
  it('round-trips toCsv, guarding formula-looking cells', () => {
    const csv = toCsv([['a', 'b'], ['=SUM(A1)', '+91 98765 43210'], ['x,y', 'q"q']])
    expect(csv).toContain("'=SUM(A1)")
    expect(csv).not.toContain("'+91")
    expect(parseCsv(csv)).toEqual([['a', 'b'], ["'=SUM(A1)", '+91 98765 43210'], ['x,y', 'q"q']])
  })
})

describe('headers and values', () => {
  it('maps loose header names and reports unknown ones', () => {
    const { columns, ignored } = mapHeaders(['E-mail', 'First Name', 'Reports To', 'Dept', 'Designation', 'Favourite colour'])
    expect(columns).toEqual(['email', 'first_name', 'manager_email', 'department', 'job_title', null])
    expect(ignored).toEqual(['Favourite colour'])
  })
  it('parses joining dates without guessing day/month order', () => {
    expect(parseDateOnly('2024-12-01')).toBe('2024-12-01')
    expect(parseDateOnly('2024-12-01T00:00:00Z')).toBe('2024-12-01')
    expect(parseDateOnly('1 Dec 2024')).toBe('2024-12-01')
    expect(parseDateOnly('Dec 1, 2024')).toBe('2024-12-01')
    expect(parseDateOnly('01/12/2024')).toBeNull()
    expect(parseDateOnly('2024-02-30')).toBeNull()
  })
  it('parses roles, countries, zones, times and status', () => {
    expect(parseRole('Team Lead')).toBe('REPORTER')
    expect(parseRole('super_admin')).toBe('SUPER_ADMIN')
    expect(parseRole('boss')).toBeNull()
    expect(parseCountry('USA')).toBe('US')
    expect(parseCountry('United Kingdom')).toBe('GB')
    expect(parseTimeZone('IST')).toBe('Asia/Kolkata')
    expect(parseTimeZone('America/Chicago')).toBe('America/Chicago')
    expect(parseTimeZone('Mars/Base')).toBeNull()
    expect(parseTime('9:30 PM')).toBe('21:30')
    expect(parseTime('12 AM')).toBe('00:00')
    expect(parseTime('11:00')).toBe('11:00')
    expect(parseTime('25:00')).toBeNull()
    expect(parseStatus('Inactive')).toBe(false)
    expect(parseStatus('yes')).toBe(true)
  })
})

describe('planImport', () => {
  it('creates users, departments on demand, and resolves managers in any row order', () => {
    const csv = [
      'email,first_name,last_name,role,department,manager_email,country',
      'rahul@example.com,Rahul,Mehta,Employee,engineering ,priya@example.com,India',
      'priya@example.com,Priya,Shah,,Design Ops,,US',
    ].join('\n')
    const plan = planImport(csv, ctx())
    expect(plan.summary).toEqual({ create: 2, update: 0, unchanged: 0, error: 0 })
    const rahul = row(plan, 'rahul@example.com')
    expect(rahul.data).toMatchObject({ name: 'Rahul Mehta', role: 'EMPLOYEE', department: 'engineering', managerEmail: 'priya@example.com', timeZone: 'Asia/Kolkata', workDayStart: '11:00' })
    // Priya has a direct report → promoted from the default Employee
    expect(row(plan, 'priya@example.com').data.role).toBe('REPORTER')
    expect(row(plan, 'priya@example.com').warnings[0]).toMatch(/Manager because rahul@example.com/)
    expect(plan.newDepartments).toEqual(['Design Ops']) // "engineering " matches existing Engineering
  })

  it('updates existing users, keeping values for blank cells, and detects no-ops', () => {
    const existing = [u('e1', 'emp@example.com', 'Emp One', { title: 'Dev', departmentId: 'd1', phone: '+91 9876543210' })]
    const plan = planImport('email,first_name,last_name,job_title,department,phone\nemp@example.com,,,Senior Dev,Engineering,\n', ctx(existing))
    const r = row(plan, 'emp@example.com')
    expect(r.action).toBe('update')
    expect(r.changes).toEqual(['job title'])
    expect(r.data).toEqual({ title: 'Senior Dev' })

    const same = planImport('email,first_name,last_name,job_title\nemp@example.com,Emp,One,Dev\n', ctx(existing))
    expect(row(same, 'emp@example.com').action).toBe('unchanged')
  })

  it('accepts the old single "name" column', () => {
    const plan = planImport('name,email\nOld Format,old@example.com\n', ctx())
    expect(row(plan, 'old@example.com').data.name).toBe('Old Format')
  })

  it('reports row errors without failing the other rows', () => {
    const csv = [
      'email,first_name,role,phone,time_zone,status',
      'ok@example.com,Ok,,,,',
      'outsider@gmail.com,Out,,,,',
      'bad@example.com,Bad,boss,123,Mars/Base,maybe',
      'ok@example.com,Dup,,,,',
      'noname@example.com,,,,,',
    ].join('\n')
    const plan = planImport(csv, ctx())
    expect(plan.summary).toEqual({ create: 1, update: 0, unchanged: 0, error: 4 })
    expect(row(plan, 'outsider@gmail.com').errors[0]).toMatch(/Only @example.com/)
    expect(row(plan, 'bad@example.com').errors).toHaveLength(4)
    expect(plan.rows[3].errors[0]).toBe('Same email as line 2')
    expect(row(plan, 'noname@example.com').errors[0]).toMatch(/first_name is required/)
  })

  it('fails rows whose manager is missing, failed, or creates a loop', () => {
    const existing = [u('a', 'a@example.com', 'A', { role: 'REPORTER' }), u('b', 'b@example.com', 'B', { role: 'REPORTER', reportsToId: 'a' })]
    const csv = [
      'email,first_name,manager_email',
      'x@example.com,X,ghost@example.com',
      'y@example.com,Y,bad@example.com',
      'bad@example.com,,',
      'a@example.com,A,b@example.com', // b already reports to a → loop
    ].join('\n')
    const plan = planImport(csv, ctx(existing))
    expect(row(plan, 'x@example.com').errors[0]).toMatch(/not in the system/)
    expect(row(plan, 'y@example.com').errors[0]).toMatch(/line 4, which has errors/)
    expect(row(plan, 'a@example.com').errors[0]).toBe('Reporting loop: a@example.com → b@example.com → a@example.com')
  })

  it('in warn mode (Keka) a missing manager is dropped with a warning instead of failing the row', () => {
    const plan = planRecords([{ line: 1, values: { email: 'x@example.com', first_name: 'X', manager_email: 'ghost@example.com' } }], ctx(), { missingManager: 'warn' })
    const r = row(plan, 'x@example.com')
    expect(r.action).toBe('create')
    expect(r.data.managerEmail).toBeUndefined()
    expect(r.warnings[0]).toMatch(/isn't in the app yet/)
  })

  it('round-trips employee number and joining date', () => {
    const existing = [u('e1', 'emp@example.com', 'Emp', { employeeNumber: 'RIQ1', joiningDate: new Date('2024-12-01T00:00:00Z') })]
    const plan = planImport('email,employee_number,joining_date\nemp@example.com,RIQ1,2024-12-01\n', ctx(existing))
    expect(row(plan, 'emp@example.com').action).toBe('unchanged')
    const changed = planImport('email,joining_date\nemp@example.com,2 Dec 2024\n', ctx(existing))
    expect(row(changed, 'emp@example.com').changes).toEqual(['joining date'])
  })

  it('promotes an existing Employee outside the file who gets a report', () => {
    const plan = planImport('email,first_name,manager_email\nnew@example.com,New,lead@example.com\n', ctx([u('l', 'lead@example.com', 'Lead')]))
    expect(plan.promotions).toEqual([{ email: 'lead@example.com', name: 'Lead' }])
  })

  it('stops the admin from demoting or deactivating themselves', () => {
    const plan = planImport('email,role,status\nadmin@example.com,Employee,Inactive\n', ctx())
    expect(row(plan, 'admin@example.com').errors).toEqual(['You cannot change your own role by import', 'You cannot deactivate yourself by import'])
  })

  it('rejects files without an email column or over the row limit', () => {
    expect(planImport('first_name\nA\n', ctx()).fatal).toMatch(/No email column/)
    expect(planImport('email\n' + 'x@example.com\n'.repeat(1001), ctx()).fatal).toMatch(/Too many rows/)
  })
})

describe('export / template', () => {
  it('export → re-import is a no-op', () => {
    const users = [
      { ...u('m', 'mgr@example.com', 'Mary Ann Smith', { role: 'REPORTER', departmentId: 'd1', country: 'IN', timeZone: 'Asia/Kolkata', workDayStart: '11:00', workDayEnd: '21:00', phone: '+91 98765 43210' }), department: { name: 'Engineering' }, reportsTo: null },
      { ...u('e', 'emp@example.com', 'Raj', { reportsToId: 'm', isActive: false }), department: null, reportsTo: { email: 'mgr@example.com' } },
    ]
    const csv = exportUsersCsv(users)
    const plan = planImport(csv, ctx(users))
    expect(plan.summary).toEqual({ create: 0, update: 0, unchanged: 2, error: 0 })
  })

  it('template parses cleanly', () => {
    const plan = planImport(templateCsv(), ctx())
    expect(plan.summary.error).toBe(0)
    expect(plan.summary.create).toBe(2)
  })
})

describe('applyImport', () => {
  it('creates departments, users, then reporting lines and promotions in one transaction', async () => {
    const created: Record<string, string> = {}
    vi.mocked(prismaMock.$transaction).mockImplementation((async (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock)) as never)
    vi.mocked(prismaMock.department.create).mockImplementation((async ({ data }: { data: { name: string } }) => ({ id: `dept-${data.name}` })) as never)
    vi.mocked(prismaMock.user.create).mockImplementation((async ({ data }: { data: { email: string } }) => {
      created[data.email] = `id-${data.email}`
      return { id: created[data.email] }
    }) as never)
    vi.mocked(prismaMock.user.update).mockImplementation((async () => ({})) as never)

    const c = ctx([u('l', 'lead@example.com', 'Lead')])
    const plan = planImport('email,first_name,department,manager_email\nnew@example.com,New,QA,lead@example.com\n', c)
    const res = await applyImport(plan, c)
    expect(res).toEqual({ created: 1, updated: 0, promoted: 1, departmentsCreated: 1, deactivated: 0, failed: 0 })
    expect(prismaMock.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ email: 'new@example.com', name: 'New', departmentId: 'dept-QA' }) })
    expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: 'id-new@example.com' }, data: { reportsToId: 'l' } })
    expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: 'l' }, data: { role: 'REPORTER' } })
  })
})
