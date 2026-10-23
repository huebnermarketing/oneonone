import { NextRequest, NextResponse } from 'next/server'
import { UserRole, Prisma, MeetingStatus } from '@prisma/client'
import { ApiError, parseQuery, REPORTER_OR_ADMIN, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { generateOrganizationInsights } from '@/lib/openai'
import { checkRateLimit } from '@/lib/rate-limit'
import { recordingsInsightsQuery } from '@/lib/validation/misc'

export const dynamic = 'force-dynamic'

type MeetingWithRecording = Prisma.MeetingGetPayload<{
  include: { employee: { include: { department: true } }; recording: true }
}>

type DepartmentStat = {
  meetings: number
  avgQuality: number
  sentiments: Array<{ score: number; label: string } | unknown>
  themes: string[]
}

function buildDepartmentStats(meetings: MeetingWithRecording[]): Record<string, DepartmentStat> {
  const departmentStats: Record<string, DepartmentStat> = {}

  for (const meeting of meetings) {
    const deptName = meeting.employee.department?.name || 'Unassigned'
    if (!departmentStats[deptName]) {
      departmentStats[deptName] = { meetings: 0, avgQuality: 0, sentiments: [], themes: [] }
    }
    departmentStats[deptName].meetings++
    if (meeting.recording?.qualityScore) departmentStats[deptName].avgQuality += meeting.recording.qualityScore
    if (meeting.recording?.sentiment) departmentStats[deptName].sentiments.push(meeting.recording.sentiment)
    if (meeting.recording?.keyPoints) departmentStats[deptName].themes.push(...(meeting.recording.keyPoints as string[]))
  }

  // Turn quality sums into averages
  for (const dept of Object.keys(departmentStats)) {
    const meetingsWithQuality = meetings.filter(
      (m) => m.employee.department?.name === dept && m.recording?.qualityScore
    ).length
    if (meetingsWithQuality > 0) {
      departmentStats[dept].avgQuality = Math.round(departmentStats[dept].avgQuality / meetingsWithQuality)
    }
  }

  return departmentStats
}

function buildDistributions(meetings: MeetingWithRecording[]) {
  const languageDistribution: Record<string, number> = {}
  const sentimentDistribution = { positive: 0, neutral: 0, negative: 0 }

  for (const meeting of meetings) {
    const lang = meeting.recording?.language
    if (lang) languageDistribution[lang] = (languageDistribution[lang] || 0) + 1

    if (meeting.recording?.sentiment) {
      const label = (meeting.recording.sentiment as { label?: string }).label as
        | 'positive'
        | 'neutral'
        | 'negative'
        | undefined
      if (label && label in sentimentDistribution) sentimentDistribution[label]++
    }
  }

  return { languageDistribution, sentimentDistribution }
}

/**
 * GET /api/recordings/insights?period=30&departmentId=
 * Aggregate meeting + recording analytics for the period. REPORTER sees only meetings they run.
 */
export const GET = withApiAuth(REPORTER_OR_ADMIN, async (req: NextRequest, { user }) => {
  const { allowed } = checkRateLimit(req, 'api')
  if (!allowed) throw new ApiError(429, 'Too many requests')

  const { departmentId, period } = parseQuery(req, recordingsInsightsQuery)

  const startDate = new Date()
  startDate.setDate(startDate.getDate() - period)

  const baseWhere: Prisma.MeetingWhereInput = { meetingDate: { gte: startDate } }
  if (user.role === UserRole.REPORTER) baseWhere.reporterId = user.id
  if (departmentId) baseWhere.employee = { departmentId }

  const allMeetings = await prisma.meeting.findMany({
    where: baseWhere,
    select: { status: true, meetingDate: true },
  })

  const now = new Date()
  const meetingOverview = {
    total: allMeetings.length,
    upcoming: allMeetings.filter((m) => m.status === MeetingStatus.SCHEDULED && new Date(m.meetingDate) > now).length,
    completed: allMeetings.filter((m) => m.status === MeetingStatus.COMPLETED).length,
    proposed: allMeetings.filter((m) => m.status === MeetingStatus.PROPOSED).length,
    cancelled: allMeetings.filter((m) => m.status === MeetingStatus.CANCELLED).length,
  }

  // Recording-based analytics: completed recordings that have a sentiment
  const meetings = await prisma.meeting.findMany({
    where: {
      ...baseWhere,
      recording: { is: { status: 'COMPLETED', sentiment: { not: Prisma.JsonNull } } },
    },
    include: {
      employee: { include: { department: true } },
      recording: true,
    },
    orderBy: { meetingDate: 'desc' },
  })

  const recordingsWithAnalysis = meetings.filter((m) => m.recording?.qualityScore)
  const avgQualityScore =
    recordingsWithAnalysis.length > 0
      ? Math.round(
          recordingsWithAnalysis.reduce((acc, m) => acc + (m.recording?.qualityScore || 0), 0) /
            recordingsWithAnalysis.length
        )
      : 0

  const departmentStats = buildDepartmentStats(meetings)
  const { languageDistribution, sentimentDistribution } = buildDistributions(meetings)

  // AI insights only once there is enough data; best-effort
  let aiInsights = null
  if (recordingsWithAnalysis.length >= 3) {
    const summariesForAI = recordingsWithAnalysis.map((m) => ({
      department: m.employee.department?.name || 'Unassigned',
      sentiment: (m.recording?.sentiment as { score: number; label: string } | null) ?? null,
      keyPoints: (m.recording?.keyPoints as string[]) || [],
      commonThemes: [] as string[],
      qualityScore: m.recording?.qualityScore || 0,
    }))
    try {
      aiInsights = await generateOrganizationInsights(summariesForAI)
    } catch (err) {
      console.error('Failed to generate AI insights:', err)
    }
  }

  const recentMeetings = meetings.slice(0, 10).map((m) => ({
    id: m.id,
    date: m.meetingDate,
    employee: m.employee.name,
    department: m.employee.department?.name,
    qualityScore: m.recording?.qualityScore,
    sentiment: (m.recording?.sentiment as { label?: string } | null)?.label,
  }))

  return NextResponse.json({
    period,
    meetingOverview,
    stats: {
      totalMeetings: meetings.length,
      totalRecordings: recordingsWithAnalysis.length,
      avgQualityScore,
    },
    departmentStats,
    languageDistribution,
    sentimentDistribution,
    recentMeetings,
    aiInsights,
  })
})
