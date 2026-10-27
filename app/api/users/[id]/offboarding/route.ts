import { NextRequest, NextResponse } from 'next/server'
import { ADMIN, withApiAuth } from '@/lib/api'
import { offboardingImpact } from '@/lib/offboarding'

export const dynamic = 'force-dynamic'

/** GET /api/users/[id]/offboarding (admin) — what deactivating this user would cancel: { meetings, schedules }. */
export const GET = withApiAuth(ADMIN, async (_req: NextRequest, { params }) => {
  const impact = (await offboardingImpact([params.id])).get(params.id) ?? { meetings: 0, schedules: 0 }
  return NextResponse.json(impact)
})
