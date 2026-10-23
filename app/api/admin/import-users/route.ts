import { NextRequest, NextResponse } from 'next/server'
import { UserRole } from '@prisma/client'
import { ADMIN, badRequest, parseBody, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { logBulkImport } from '@/lib/audit'
import { ALLOWED_EMAIL_DOMAIN, isAllowedEmail } from '@/lib/constants'
import { importUsersSchema } from '@/lib/validation/users'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

type ImportRow = z.infer<typeof importUsersSchema>['users'][number]

function parseRole(raw: string | undefined): UserRole {
  const upper = raw?.toUpperCase()
  if (upper === 'REPORTER' || upper === 'TEAM_LEAD' || upper === 'MANAGER') return 'REPORTER'
  if (upper === 'SUPER_ADMIN' || upper === 'ADMIN') return 'SUPER_ADMIN'
  return 'EMPLOYEE'
}

/** Per-row business validation (domain, duplicates, phone). Returns one message per invalid row. */
function validateRows(rows: ImportRow[], existingEmails: Set<string>): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!isAllowedEmail(row.email)) {
      errors.push(`Only ${ALLOWED_EMAIL_DOMAIN} emails allowed: ${row.email}`)
      continue
    }
    if (existingEmails.has(row.email)) {
      errors.push(`User already exists: ${row.email}`)
      continue
    }
    if (seen.has(row.email)) {
      errors.push(`Duplicate email in import: ${row.email}`)
      continue
    }
    seen.add(row.email)
    if (row.phone && row.phone.replace(/\D/g, '').length < 10) {
      errors.push(`Phone number must be at least 10 digits for: ${row.email}`)
    }
  }
  return errors
}

/**
 * POST /api/admin/import-users { users: [...] } (admin only)
 * All rows are validated first; if any row is invalid nothing is inserted (400 with the errors).
 * Otherwise every row is created in one transaction. Rows are processed in order so a manager
 * listed earlier in the file can be referenced by `reportsTo` on a later row. Unknown departments are created.
 */
export const POST = withApiAuth(ADMIN, async (req: NextRequest, { user }) => {
  const { users } = await parseBody(req, importUsersSchema)

  const [departments, existingUsers] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({ select: { id: true, email: true } }),
  ])
  const departmentMap = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]))
  const userMap = new Map(existingUsers.map((u) => [u.email.toLowerCase(), u.id]))

  const errors = validateRows(users, new Set(userMap.keys()))
  if (errors.length > 0) {
    throw badRequest(
      `Import aborted: ${errors.length} of ${users.length} row(s) failed validation. ${errors.slice(0, 5).join('; ')}${
        errors.length > 5 ? `; and ${errors.length - 5} more` : ''
      }`,
      errors
    )
  }

  const created = await prisma.$transaction(
    async (tx) => {
      let count = 0
      for (const row of users) {
        let departmentId: string | null = null
        if (row.department) {
          const key = row.department.toLowerCase()
          departmentId = departmentMap.get(key) ?? null
          if (!departmentId) {
            const dept = await tx.department.create({ data: { name: row.department } })
            departmentId = dept.id
            departmentMap.set(key, dept.id)
          }
        }

        const reportsToId = row.reportsTo ? userMap.get(row.reportsTo) ?? null : null

        const newUser = await tx.user.create({
          data: {
            name: row.name,
            email: row.email,
            role: parseRole(row.role),
            departmentId,
            reportsToId,
            title: row.title || null,
            phone: row.phone || null,
          },
        })
        userMap.set(row.email, newUser.id)
        count++
      }
      return count
    },
    { timeout: 60_000 }
  )

  const results = { success: created, failed: 0, errors: [] as string[] }

  await logBulkImport(user.id, 'User', results.success, { failed: results.failed, errors: results.errors })

  return NextResponse.json(results)
})
