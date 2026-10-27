import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ADMIN, ApiError, badRequest, parseBody, withApiAuth } from '@/lib/api'
import { logBulkImport } from '@/lib/audit'
import { getKekaSyncStatus, runKekaSync } from '@/lib/keka-sync'
import { KekaUnavailableError } from '@/lib/keka-employees'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({ commit: z.boolean().optional() })

/** GET /api/admin/keka-sync — { configured, lastSyncAt } (lastSyncAt null = never run; daily auto-sync starts after the first). */
export const GET = withApiAuth(ADMIN, async () => NextResponse.json(await getKekaSyncStatus()))

/**
 * POST /api/admin/keka-sync { commit? } (admin only)
 * Without commit: preview of what syncing Keka employees would do (same shape as the CSV import preview,
 * plus `skipped` and `leaversIgnored`). With commit: applies valid rows, stamps the sync time.
 */
export const POST = withApiAuth(ADMIN, async (req: NextRequest, { user }) => {
  const { commit } = await parseBody(req, bodySchema)
  const status = await getKekaSyncStatus()
  if (!status.configured) throw badRequest('Keka is not configured on the server (KEKA_* environment variables).')

  let run
  try {
    run = await runKekaSync({ commit: !!commit, actorEmail: user.email })
  } catch (err) {
    if (err instanceof KekaUnavailableError) throw new ApiError(502, `Could not reach Keka: ${err.message}`)
    throw err
  }
  const { plan, result } = run
  if (result) {
    await logBulkImport(user.id, 'User', result.created + result.updated, {
      source: 'keka',
      created: result.created,
      updated: result.updated,
      deactivated: result.deactivated,
      promoted: result.promoted,
      departmentsCreated: result.departmentsCreated,
      failed: result.failed,
    })
  }
  return NextResponse.json({
    committed: !!result,
    summary: plan.summary,
    newDepartments: plan.newDepartments,
    promotions: plan.promotions,
    ignoredColumns: [],
    skipped: plan.skipped,
    leaversIgnored: plan.leaversIgnored,
    rows: plan.rows.map(({ line, email, name, action, changes, errors, warnings }) => ({ line, email, name, action, changes, errors, warnings })),
    result,
    lastSyncAt: result ? new Date().toISOString() : status.lastSyncAt,
  })
})
