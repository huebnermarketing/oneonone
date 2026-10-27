import { NextRequest, NextResponse } from 'next/server'
import { ADMIN, badRequest, parseBody, parseQuery, withApiAuth } from '@/lib/api'
import { createAuditLog, logBulkImport } from '@/lib/audit'
import { importUsersQuery, importUsersSchema } from '@/lib/validation/users'
import { applyImport, errorReportCsv, exportAllUsersCsv, loadImportContext, planImport, templateCsv } from '@/lib/user-import'
import { toDateKey } from '@/lib/dates'

export const dynamic = 'force-dynamic'

function csvResponse(body: string, filename: string) {
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * GET /api/admin/import-users?format=template|export (admin only)
 * template = header + two example rows; export = every user in the same format (edit + re-import = bulk update).
 */
export const GET = withApiAuth(ADMIN, async (req: NextRequest, { user }) => {
  const { format } = parseQuery(req, importUsersQuery)
  if (format === 'template') return csvResponse(templateCsv(), 'user-import-template.csv')
  const csv = await exportAllUsersCsv()
  await createAuditLog({ userId: user.id, action: 'EXPORT', entityType: 'User', details: { format: 'csv' } })
  return csvResponse(csv, `users-${toDateKey(new Date(), user.timeZone ?? 'UTC')}.csv`)
})

/**
 * POST /api/admin/import-users { csv, commit? } (admin only)
 * Without commit: preview — what each row would do, departments to create, promotions. Nothing is written.
 * With commit: re-plans against current data and writes every valid row in one transaction; rows with
 * errors are skipped and returned as `errorCsv` (original values + error column) to fix and re-upload.
 */
export const POST = withApiAuth(ADMIN, async (req: NextRequest, { user }) => {
  const { csv, commit } = await parseBody(req, importUsersSchema)
  const ctx = await loadImportContext(user.email)
  const plan = planImport(csv, ctx)
  if (plan.fatal) throw badRequest(plan.fatal)

  const preview = {
    summary: plan.summary,
    newDepartments: plan.newDepartments,
    promotions: plan.promotions,
    ignoredColumns: plan.ignoredColumns,
    rows: plan.rows.map(({ line, email, name, action, changes, errors, warnings }) => ({ line, email, name, action, changes, errors, warnings })),
  }
  if (!commit) return NextResponse.json({ ...preview, committed: false })

  const result = await applyImport(plan, ctx)
  await logBulkImport(user.id, 'User', result.created + result.updated, {
    created: result.created,
    updated: result.updated,
    promoted: result.promoted,
    departmentsCreated: result.departmentsCreated,
    failed: result.failed,
  })
  return NextResponse.json({ ...preview, committed: true, result, errorCsv: errorReportCsv(plan) })
})
