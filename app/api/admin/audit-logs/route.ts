import { NextRequest, NextResponse } from 'next/server'
import { ADMIN, parseQuery, withApiAuth } from '@/lib/api'
import { getAuditLogs } from '@/lib/audit'
import { auditLogsQuery } from '@/lib/validation/admin'

export const dynamic = 'force-dynamic'

// GET /api/admin/audit-logs?userId&action&entityType&startDate&endDate&limit&offset (admin only)
export const GET = withApiAuth(ADMIN, async (req: NextRequest) => {
  const query = parseQuery(req, auditLogsQuery)

  const { logs, total } = await getAuditLogs(query)

  return NextResponse.json({ logs, total, limit: query.limit, offset: query.offset })
})
