import { NextRequest, NextResponse } from 'next/server'
import { UserRole, Prisma } from '@prisma/client'
import { parseQuery, REPORTER_OR_ADMIN, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { formatDate, isTodoOverdue } from '@/lib/dates'
import { getTeamUserIds } from '@/lib/team'
import { logDataExport } from '@/lib/audit'
import { DEFAULT_TIMEZONE } from '@/lib/constants'
import { reportsQuery } from '@/lib/validation/misc'

export const dynamic = 'force-dynamic'

// Simple sentiment keywords
const positiveWords = ['great', 'excellent', 'good', 'amazing', 'fantastic', 'happy', 'success', 'achieved', 'completed', 'progress', 'improved', 'better', 'love', 'excited', 'proud', 'wonderful', 'awesome']
const negativeWords = ['bad', 'poor', 'issue', 'problem', 'difficult', 'struggle', 'challenge', 'frustrated', 'concerned', 'worried', 'stuck', 'blocked', 'delay', 'missed', 'failed', 'stress', 'overwhelmed']

function analyzeSentiment(text: string): { score: number; label: string } {
  if (!text) return { score: 0, label: 'neutral' }

  const words = text.toLowerCase().split(/\s+/)
  let positiveCount = 0
  let negativeCount = 0

  words.forEach(word => {
    if (positiveWords.some(pw => word.includes(pw))) positiveCount++
    if (negativeWords.some(nw => word.includes(nw))) negativeCount++
  })

  const total = positiveCount + negativeCount
  if (total === 0) return { score: 0, label: 'neutral' }

  const score = (positiveCount - negativeCount) / total
  const label = score > 0.2 ? 'positive' : score < -0.2 ? 'negative' : 'neutral'

  return { score: Math.round(score * 100) / 100, label }
}

function extractCommonIssues(meetings: Array<{ supportNeeded: string | null; priorityDiscussions: string | null; headsUp: string | null }>): Array<{ text: string; count: number; category: string }> {
  const issueKeywords: Record<string, string[]> = {
    'Workload': ['workload', 'too much', 'overwhelmed', 'capacity', 'bandwidth', 'busy'],
    'Communication': ['communication', 'unclear', 'miscommunication', 'feedback', 'response'],
    'Resources': ['resources', 'tools', 'equipment', 'access', 'software', 'hardware'],
    'Training': ['training', 'learning', 'skills', 'development', 'knowledge'],
    'Process': ['process', 'workflow', 'efficiency', 'bottleneck', 'approval'],
    'Timeline': ['deadline', 'timeline', 'delay', 'schedule', 'time'],
    'Support': ['support', 'help', 'guidance', 'assistance', 'mentor'],
    'Client': ['client', 'customer', 'stakeholder', 'expectation'],
  }

  const issueCounts: Record<string, number> = {}

  meetings.forEach(meeting => {
    const textFields = [
      meeting.supportNeeded,
      meeting.priorityDiscussions,
      meeting.headsUp,
    ].filter(Boolean).join(' ').toLowerCase()

    Object.entries(issueKeywords).forEach(([category, keywords]) => {
      if (keywords.some(kw => textFields.includes(kw))) {
        issueCounts[category] = (issueCounts[category] || 0) + 1
      }
    })
  })

  return Object.entries(issueCounts)
    .map(([category, count]) => ({ text: category, count, category }))
    .filter(issue => issue.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
}

function calculateTrends(meetings: Array<{ status: string }>, todos: Array<{ status: string; priority: string }>): Record<string, string> {
  const trends: Record<string, string> = {}

  // Meeting completion rate
  const completedMeetings = meetings.filter(m => m.status === 'COMPLETED').length
  const totalMeetings = meetings.length
  trends['Meeting Completion Rate'] = totalMeetings > 0
    ? `${Math.round((completedMeetings / totalMeetings) * 100)}%`
    : 'N/A'

  // Task completion rate
  const completedTasks = todos.filter(t => t.status === 'DONE').length
  const totalTasks = todos.length
  trends['Task Completion Rate'] = totalTasks > 0
    ? `${Math.round((completedTasks / totalTasks) * 100)}%`
    : 'N/A'

  // Average tasks per meeting
  trends['Avg Tasks per Meeting'] = totalMeetings > 0
    ? `${(totalTasks / totalMeetings).toFixed(1)}`
    : 'N/A'

  // High priority tasks
  const highPriorityTasks = todos.filter(t => t.priority === 'HIGH').length
  trends['High Priority Tasks'] = `${highPriorityTasks}`

  return trends
}

type ReportMeeting = Prisma.MeetingGetPayload<{
  include: {
    employee: { select: { name: true; department: { select: { name: true } } } }
    reporter: { select: { name: true } }
  }
}>

type ReportData = {
  generatedAt: string
  period: { start: string; end: string }
  summary: {
    totalMeetings: number
    completedMeetings: number
    totalTasks: number
    completedTasks: number
    pendingTasks: number
    overdueTasks: number
  }
}

function buildCsv(
  reportData: ReportData,
  trends: Record<string, string>,
  commonIssues: Array<{ text: string; count: number }>,
  meetings: ReportMeeting[],
  timeZone: string
): string {
  const csvRows = [
    ['Report Generated', reportData.generatedAt],
    ['Period', `${reportData.period.start} to ${reportData.period.end}`],
    [''],
    ['Summary'],
    ['Total Meetings', reportData.summary.totalMeetings],
    ['Completed Meetings', reportData.summary.completedMeetings],
    ['Total Tasks', reportData.summary.totalTasks],
    ['Completed Tasks', reportData.summary.completedTasks],
    ['Pending Tasks', reportData.summary.pendingTasks],
    ['Overdue Tasks', reportData.summary.overdueTasks],
    [''],
    ['Trends'],
    ...Object.entries(trends).map(([key, value]) => [key, value]),
    [''],
    ['Common Issues'],
    ...commonIssues.map(issue => [issue.text, `${issue.count} mentions`]),
    [''],
    ['Meetings'],
    ['Date', 'Employee', 'Department', 'Reporter', 'Status', 'Form Submitted'],
    ...meetings.map(m => [
      formatDate(m.meetingDate, timeZone, 'short'),
      m.employee.name,
      m.employee.department?.name || 'N/A',
      m.reporter.name,
      m.status,
      m.formSubmittedAt ? 'Yes' : 'No',
    ]),
  ]

  return csvRows.map(row => row.join(',')).join('\n')
}

/**
 * GET /api/reports?departmentId=&startDate=&endDate=&format=csv
 * SUPER_ADMIN: all active users (optionally one department).
 * REPORTER: their own meetings; employee count + todos scoped to themselves and their direct reports.
 */
export const GET = withApiAuth(REPORTER_OR_ADMIN, async (req: NextRequest, { user }) => {
  const { departmentId, startDate, endDate, format } = parseQuery(req, reportsQuery)

  // Build date range filter
  const dateFilter: { gte?: Date; lt?: Date } = {}
  if (startDate) {
    dateFilter.gte = new Date(startDate)
  }
  if (endDate) {
    const endDt = new Date(endDate)
    endDt.setUTCDate(endDt.getUTCDate() + 1)
    dateFilter.lt = endDt
  }
  const hasDateFilter = Object.keys(dateFilter).length > 0

  // Scope: active users, optionally filtered by department (for employee count + todos).
  // REPORTER is further limited to their team (self + direct reports).
  const teamIds = await getTeamUserIds(user)
  const userWhere: Prisma.UserWhereInput = { isActive: true }
  if (departmentId) userWhere.departmentId = departmentId
  if (teamIds) userWhere.id = { in: teamIds }

  const usersInScope = await prisma.user.findMany({
    where: userWhere,
    select: { id: true, name: true, email: true, department: { select: { name: true } } },
  })
  const userIds = usersInScope.map(u => u.id)

  // Meetings where either the employee OR the reporter is in scope so recurring-originated and
  // cross-role meetings are never missed. REPORTER users are restricted to their own meetings
  // (matching the meetings page behaviour).
  const meetingWhere: Prisma.MeetingWhereInput = {
    ...(hasDateFilter ? { meetingDate: dateFilter } : {}),
    OR:
      user.role === UserRole.REPORTER
        ? [{ reporterId: user.id }, { employeeId: user.id }]
        : [{ employeeId: { in: userIds } }, { reporterId: { in: userIds } }],
  }

  const [meetings, todos] = await Promise.all([
    prisma.meeting.findMany({
      where: meetingWhere,
      include: {
        employee: { select: { name: true, department: { select: { name: true } } } },
        reporter: { select: { name: true } },
      },
      orderBy: { meetingDate: 'desc' },
    }),
    prisma.todo.findMany({
      where: { assignedToId: { in: userIds } },
      include: { assignedTo: { select: { name: true } } },
    }),
  ])

  // Calculate summary
  const completedMeetings = meetings.filter(m => m.status === 'COMPLETED').length
  const scheduledMeetings = meetings.filter(m => m.status === 'SCHEDULED').length
  const completedTasks = todos.filter(t => t.status === 'DONE').length
  const pendingTasks = todos.filter(t => t.status !== 'DONE').length
  const now = new Date()
  const timeZone = user.timeZone ?? DEFAULT_TIMEZONE
  const overdueTasks = todos.filter(t => isTodoOverdue(t.dueDate, now, t.status, timeZone)).length

  // Analyze sentiment from meeting responses
  const sentimentData = meetings
    .filter(m => m.checkInProfessional || m.goodNews || m.supportNeeded)
    .map(m => {
      const text = [m.checkInProfessional, m.goodNews, m.supportNeeded].filter(Boolean).join(' ')
      return analyzeSentiment(text)
    })

  const overallSentiment = sentimentData.length > 0
    ? {
        positive: sentimentData.filter(s => s.label === 'positive').length,
        neutral: sentimentData.filter(s => s.label === 'neutral').length,
        negative: sentimentData.filter(s => s.label === 'negative').length,
        averageScore: Math.round(sentimentData.reduce((sum, s) => sum + s.score, 0) / sentimentData.length * 100) / 100,
      }
    : null

  const commonIssues = extractCommonIssues(meetings)
  const trends = calculateTrends(meetings, todos)

  const reportData = {
    generatedAt: new Date().toISOString(),
    period: {
      start: startDate || 'All time',
      end: endDate || 'Present',
    },
    filters: {
      departmentId: departmentId || 'All departments',
    },
    summary: {
      totalMeetings: meetings.length,
      completedMeetings,
      scheduledMeetings,
      totalTasks: todos.length,
      completedTasks,
      pendingTasks,
      overdueTasks,
      totalEmployees: usersInScope.length,
    },
    sentiment: overallSentiment,
    commonIssues,
    trends,
    meetings: meetings.map(m => ({
      id: m.id,
      date: m.meetingDate,
      employee: m.employee.name,
      department: m.employee.department?.name || 'N/A',
      reporter: m.reporter.name,
      status: m.status,
      hasFormData: !!m.formSubmittedAt,
    })),
  }

  if (format === 'csv') {
    const csv = buildCsv(reportData, trends, commonIssues, meetings, timeZone)
    await logDataExport(user.id, 'Report', {
      format: 'csv',
      departmentId: departmentId ?? null,
      startDate: startDate ?? null,
      endDate: endDate ?? null,
      meetings: meetings.length,
    })
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="report-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    })
  }

  return NextResponse.json(reportData)
})
