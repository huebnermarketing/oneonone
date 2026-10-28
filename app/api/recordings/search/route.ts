import { NextRequest, NextResponse } from 'next/server'
import { UserRole, Prisma } from '@prisma/client'
import { ApiError, badRequest, parseQuery, REPORTER_OR_ADMIN, withApiAuth } from '@/lib/api'
import { isAiConfigured } from '@/lib/ai'
import { prisma } from '@/lib/prisma'
import { searchTranscripts } from '@/lib/openai'
import { checkRateLimit } from '@/lib/rate-limit'
import { recordingsSearchQuery } from '@/lib/validation/misc'

export const dynamic = 'force-dynamic'

/** Most recent recordings considered per search */
const SEARCH_POOL = 100
/** searchTranscripts sends the first 500 characters of each transcript to the model */
const TRANSCRIPT_HEAD_CHARS = 600

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

  // Only what the response needs — never whole user rows or full transcripts
  const meetings = await prisma.meeting.findMany({
    where,
    select: {
      id: true,
      meetingDate: true,
      employee: { select: { id: true, name: true, department: { select: { name: true } } } },
      reporter: { select: { id: true, name: true } },
      recording: { select: { id: true } },
    },
    orderBy: { meetingDate: 'desc' },
    take: SEARCH_POOL,
  })

  // The model only sees the start of each transcript, so only that much is read from the DB
  const recordingIds = meetings.flatMap((m) => (m.recording ? [m.recording.id] : []))
  const heads = recordingIds.length
    ? await prisma.$queryRaw<{ id: string; head: string | null }[]>`
        SELECT id, left(transcript, ${TRANSCRIPT_HEAD_CHARS}::int) AS head FROM "MeetingRecording" WHERE id IN (${Prisma.join(recordingIds)})`
    : []
  const headById = new Map(heads.map((h) => [h.id, h.head]))
  const transcripts = meetings
    .filter((m) => m.recording && headById.get(m.recording.id))
    .map((m) => ({ id: m.recording!.id, meetingId: m.id, text: headById.get(m.recording!.id)! }))

  if (transcripts.length === 0) {
    return NextResponse.json({ results: [] })
  }

  if (!(await isAiConfigured())) throw badRequest('AI provider API key not configured. Set it in Admin → Settings → AI Provider.')
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
