import { NextRequest, NextResponse } from 'next/server'
import { ADMIN, parseQuery, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { pagination } from '@/lib/validation/common'

export const dynamic = 'force-dynamic'

const recordingsQuery = pagination(50, 200)

// GET /api/admin/recordings?limit&offset - paginated recording list for storage management (admin only)
export const GET = withApiAuth(ADMIN, async (req: NextRequest) => {
  const { limit, offset } = parseQuery(req, recordingsQuery)

  const [rows, total] = await Promise.all([
    prisma.meetingRecording.findMany({
      orderBy: { recordedAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        meeting: {
          select: {
            meetingDate: true,
            employee: { select: { name: true, email: true } },
            reporter: { select: { name: true } },
          },
        },
      },
    }),
    prisma.meetingRecording.count(),
  ])

  const recordings = rows.map((r) => ({
    id: r.id,
    meetingId: r.meetingId,
    meetingDate: r.meeting?.meetingDate ? r.meeting.meetingDate.toISOString() : null,
    employeeName: r.meeting?.employee?.name ?? null,
    reporterName: r.meeting?.reporter?.name ?? null,
    status: r.status,
    duration: r.duration,
    fileSize: r.fileSize,
    recordedAt: r.recordedAt ? r.recordedAt.toISOString() : null,
  }))

  return NextResponse.json({ recordings, total, limit, offset })
})
