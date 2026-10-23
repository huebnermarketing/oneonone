import { NextRequest, NextResponse } from 'next/server'
import { forbidden, notFound, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { canActOnUser } from '@/lib/team'

export const dynamic = 'force-dynamic'

// Simple sentiment keywords
const positiveWords = ['great', 'excellent', 'good', 'amazing', 'fantastic', 'happy', 'success', 'achieved', 'completed', 'progress', 'improved', 'better', 'love', 'excited', 'proud']
const negativeWords = ['bad', 'poor', 'issue', 'problem', 'difficult', 'struggle', 'challenge', 'frustrated', 'concerned', 'worried', 'stuck', 'blocked', 'delay', 'missed', 'failed']

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

const themeKeywords: Record<string, string[]> = {
  'Professional Growth': ['learning', 'skill', 'training', 'development', 'career'],
  'Team Collaboration': ['team', 'collaboration', 'communication', 'meeting'],
  'Process Improvement': ['process', 'efficiency', 'workflow', 'automation'],
  'Client Focus': ['client', 'customer', 'delivery', 'quality'],
  'Resource Needs': ['resource', 'tool', 'support', 'help', 'need'],
}

function extractKeyThemes(meetings: Array<{
  priorityGoalProfessional: string | null
  priorityGoalAgency: string | null
  progressReport: string | null
  supportNeeded: string | null
  priorityDiscussions: string | null
}>): string[] {
  const lowerText = meetings
    .map(m => [m.priorityGoalProfessional, m.priorityGoalAgency, m.progressReport, m.supportNeeded, m.priorityDiscussions]
      .filter(Boolean)
      .join(' '))
    .join(' ')
    .toLowerCase()

  return Object.entries(themeKeywords)
    .filter(([, keywords]) => keywords.some(kw => lowerText.includes(kw)))
    .map(([theme]) => theme)
}

/**
 * GET /api/reports/quarterly/[userId]
 * Current-quarter summary for one employee. Viewable by the employee, their manager, or an admin.
 */
export const GET = withApiAuth(async (_req: NextRequest, { user, params }) => {
  const targetUser = await prisma.user.findUnique({
    where: { id: params.userId },
    include: { department: true, reportsTo: true },
  })
  if (!targetUser) throw notFound('User')
  if (!(await canActOnUser(user, params.userId))) throw forbidden()

  // Date range for the current quarter
  const now = new Date()
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
  const quarterEnd = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3, 0)

  const [meetings, todos] = await Promise.all([
    prisma.meeting.findMany({
      where: {
        employeeId: params.userId,
        meetingDate: { gte: quarterStart, lte: quarterEnd },
      },
      include: { reporter: { select: { name: true } } },
      orderBy: { meetingDate: 'desc' },
    }),
    prisma.todo.findMany({
      where: {
        assignedToId: params.userId,
        createdAt: { gte: quarterStart, lte: quarterEnd },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  // Statistics
  const completedMeetings = meetings.filter(m => m.status === 'COMPLETED').length
  const completedTodos = todos.filter(t => t.status === 'DONE').length
  const pendingTodos = todos.filter(t => t.status !== 'DONE').length
  const highPriorityTodos = todos.filter(t => t.priority === 'HIGH').length

  // Sentiment across all meetings
  const sentimentScores = meetings
    .filter(m => m.checkInProfessional || m.goodNews || m.supportNeeded)
    .map(m => {
      const allText = [
        m.checkInPersonal,
        m.checkInProfessional,
        m.goodNews,
        m.supportNeeded,
        m.priorityDiscussions,
      ].filter(Boolean).join(' ')
      return analyzeSentiment(allText)
    })

  const avgSentiment = sentimentScores.length > 0
    ? sentimentScores.reduce((sum, s) => sum + s.score, 0) / sentimentScores.length
    : 0

  const keyThemes = extractKeyThemes(meetings)
  const quarterName = `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`

  const summary = {
    employee: {
      id: targetUser.id,
      name: targetUser.name,
      email: targetUser.email,
      department: targetUser.department?.name || 'N/A',
      reportsTo: targetUser.reportsTo?.name || 'N/A',
    },
    period: {
      quarter: quarterName,
      startDate: quarterStart.toISOString(),
      endDate: quarterEnd.toISOString(),
    },
    statistics: {
      totalMeetings: meetings.length,
      completedMeetings,
      meetingCompletionRate: meetings.length > 0
        ? `${Math.round((completedMeetings / meetings.length) * 100)}%`
        : 'N/A',
      totalTasks: todos.length,
      completedTasks: completedTodos,
      pendingTasks: pendingTodos,
      taskCompletionRate: todos.length > 0
        ? `${Math.round((completedTodos / todos.length) * 100)}%`
        : 'N/A',
      highPriorityTasks: highPriorityTodos,
    },
    sentiment: {
      averageScore: Math.round(avgSentiment * 100) / 100,
      label: avgSentiment > 0.2 ? 'Positive' : avgSentiment < -0.2 ? 'Needs Attention' : 'Neutral',
      breakdown: {
        positive: sentimentScores.filter(s => s.label === 'positive').length,
        neutral: sentimentScores.filter(s => s.label === 'neutral').length,
        negative: sentimentScores.filter(s => s.label === 'negative').length,
      },
    },
    keyThemes,
    goals: meetings
      .filter(m => m.priorityGoalProfessional || m.priorityGoalAgency)
      .slice(0, 3)
      .map(m => ({
        date: m.meetingDate,
        professional: m.priorityGoalProfessional,
        agency: m.priorityGoalAgency,
        progress: m.progressReport,
      })),
    recentAchievements: meetings
      .filter(m => m.goodNews)
      .slice(0, 5)
      .map(m => ({
        date: m.meetingDate,
        text: m.goodNews,
      })),
    supportRequests: meetings
      .filter(m => m.supportNeeded)
      .slice(0, 5)
      .map(m => ({
        date: m.meetingDate,
        text: m.supportNeeded,
      })),
    meetings: meetings.map(m => ({
      id: m.id,
      date: m.meetingDate,
      reporter: m.reporter.name,
      status: m.status,
      hasFormData: !!(m.checkInPersonal || m.checkInProfessional),
    })),
    todos: todos.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      completedAt: t.completedAt,
    })),
  }

  return NextResponse.json(summary)
})
