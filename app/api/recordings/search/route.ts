import { NextRequest, NextResponse } from 'next/server'
import { UserRole, Prisma } from '@prisma/client'
import { ApiError, parseQuery, REPORTER_OR_ADMIN, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { searchTranscripts } from '@/lib/openai'
import { checkRateLimit } from '@/lib/rate-limit'
import { recordingsSearchQuery } from '@/lib/validation/misc'

export const dynamic = 'force-dynamic'

/**
 * GET /api/recordings/search?q=&departmentId=&limit=
 * AI search across completed recording transcripts. REPORTER sees only meetings they run.
 */
export const GET = withApiAuth(REPORTER_OR_ADMIN, async (req: NextRequest, { user }) => {
  const { allowed } = checkRateLimit(req, 'api')
  if (!allowed) throw new ApiError(429, 'Too many requests')

  const { q: query, departmentId, limit } = parseQuery(req, recordingsSearchQuery)

  const where: Prisma.MeetingWhereInput = {
    recording: { is: { status: 'COMPLETED', transcript: { not: null } } },
  }
  if (user.role === UserRole.REPORTER) where.reporterId = user.id
  if (departmentId) where.employee = { departmentId }

  const meetings = await prisma.meeting.findMany({
    where,
    include: {
      employee: { include: { department: true } },
      reporter: true,
      recording: true,
    },
    orderBy: { meetingDate: 'desc' },
    take: 100, // Get more for better search results
  })

  const transcripts = meetings
    .filter((m) => m.recording?.transcript)
    .map((m) => ({
      id: m.recording!.id,
      meetingId: m.id,
      text: m.recording!.transcript!,
    }))

  if (transcripts.length === 0) {
    return NextResponse.json({ results: [] })
  }

  const searchResults = await searchTranscripts(transcripts, query)

  const results = searchResults.slice(0, limit).map((result) => {
    const meeting = meetings.find((m) => m.id === result.meetingId)
    return {
      ...result,
      meeting: meeting
        ? {
            id: meeting.id,
            date: meeting.meetingDate,
            employee: {
              id: meeting.employee.id,
              name: meeting.employee.name,
              department: meeting.employee.department?.name,
            },
            reporter: {
              id: meeting.reporter.id,
              name: meeting.reporter.name,
            },
          }
        : null,
    }
  })

  return NextResponse.json({ results })
})
