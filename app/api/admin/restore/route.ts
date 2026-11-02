import { NextRequest, NextResponse } from 'next/server'
import { ADMIN, badRequest, parseBody, withApiAuth } from '@/lib/api'
import { createAuditLog } from '@/lib/audit'
import { restoreBackup } from '@/lib/backup'
import { restoreSchema } from '@/lib/validation/admin'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/restore { data: <backup file>, options } (admin only)
 * Restores a file from POST /api/admin/backup (v1.0 or v1.1) — matched by email / department name,
 * all-or-nothing (lib/backup.ts). Rows that can't be linked are skipped and returned as `warnings`.
 */
export const POST = withApiAuth(ADMIN, async (req: NextRequest, { user }) => {
  const { data, options } = await parseBody(req, restoreSchema)

  let result
  try {
    result = await restoreBackup(data.data, options, user.id)
  } catch (err) {
    console.error('[restore] failed, nothing was changed:', err)
    throw badRequest(`Restore failed and nothing was changed: ${err instanceof Error ? err.message.split('\n').filter(Boolean).at(-1) : 'unknown error'}`)
  }

  await createAuditLog({
    userId: user.id,
    action: 'IMPORT',
    entityType: 'Restore',
    details: { ...result, warnings: result.warnings.slice(0, 10), warningCount: result.warnings.length, version: data.version, options },
  })

  return NextResponse.json(result)
})
