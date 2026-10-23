import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { UserRole, Prisma } from '@prisma/client'
import { ApiError, badRequest, parseBody, REPORTER_OR_ADMIN, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { checkRateLimit } from '@/lib/rate-limit'
import { recordingsAnalyzeSchema } from '@/lib/validation/misc'

export const dynamic = 'force-dynamic'

type MeetingRow = Prisma.MeetingGetPayload<{
  include: {
    employee: { include: { department: true } }
    reporter: true
    recording: true
  }
}>

/** Flatten a meeting (form answers + recording analysis) into the shape fed to the model. */
function toMeetingData(m: MeetingRow) {
  return {
    date: m.meetingDate.toISOString().split('T')[0],
    employee: m.employee.name,
    department: m.employee.department?.name || 'Unassigned',
    // Form responses
    checkInPersonal: m.checkInPersonal,
    checkInProfessional: m.checkInProfessional,
    priorityGoalProfessional: m.priorityGoalProfessional,
    priorityGoalAgency: m.priorityGoalAgency,
    progressReport: m.progressReport,
    goodNews: m.goodNews,
    supportNeeded: m.supportNeeded,
    priorityDiscussions: m.priorityDiscussions,
    headsUp: m.headsUp,
    anythingElse: m.anythingElse,
    // Recording analysis
    transcript: m.recording?.transcript,
    summary: m.recording?.summary,
    keyPoints: m.recording?.keyPoints,
    sentiment: m.recording?.sentiment,
  }
}

type MeetingData = ReturnType<typeof toMeetingData>

function buildPrompts(meetingData: MeetingData[], question: string, departmentId: string | null | undefined) {
  const context = meetingData.map((m, i) => `
Meeting ${i + 1} (${m.date}) - ${m.employee} (${m.department}):
${m.checkInProfessional ? `Professional Check-in: ${m.checkInProfessional}` : ''}
${m.supportNeeded ? `Support Needed: ${m.supportNeeded}` : ''}
${m.priorityDiscussions ? `Priority Discussions: ${m.priorityDiscussions}` : ''}
${m.headsUp ? `Heads Up: ${m.headsUp}` : ''}
${m.anythingElse ? `Other Notes: ${m.anythingElse}` : ''}
${m.summary ? `Meeting Summary: ${m.summary}` : ''}
${m.keyPoints ? `Key Points: ${JSON.stringify(m.keyPoints)}` : ''}
${m.sentiment ? `Sentiment: ${JSON.stringify(m.sentiment)}` : ''}
`.trim()).join('\n\n---\n\n')

  const systemPrompt = `You are an HR analytics expert analyzing one-on-one meeting data from an organization.
Your job is to answer questions about patterns, trends, and common themes across all meetings.

You have access to data from ${meetingData.length} meetings across the organization.
${departmentId ? 'This data is filtered to a specific department.' : 'This data includes all departments.'}

When answering:
1. Be specific and cite examples where relevant
2. Identify common patterns and themes
3. Quantify when possible (e.g., "3 out of 10 employees mentioned...")
4. Organize findings by priority or frequency
5. Suggest actionable recommendations

The data may be in English, Hindi, or Gujarati. Analyze all languages and respond in English.`

  const userPrompt = `Based on the following one-on-one meeting data, please answer this question:

"${question}"

Meeting Data:
${context}

Please provide:
1. A clear, detailed answer to the question
2. A list of the top findings/patterns (ranked by frequency or importance)
3. Specific examples from the data
4. Recommendations based on the findings

Format your response as JSON:
{
  "answer": "Your detailed answer here",
  "topFindings": [
    { "finding": "Description", "frequency": "How many mentioned", "severity": "high/medium/low" }
  ],
  "examples": [
    { "employee": "Name", "department": "Dept", "quote": "Relevant quote or summary" }
  ],
  "recommendations": ["Recommendation 1", "Recommendation 2"],
  "summary": "One-sentence executive summary"
}`

  return { systemPrompt, userPrompt }
}

/** Map OpenAI SDK failures to the user-facing messages the insights page shows. */
function toOpenAiError(error: unknown): ApiError {
  console.error('Error analyzing recordings:', error)
  const err = error as { status?: number; message?: string }
  let message = 'Failed to analyze data. Please try again.'
  if (err?.status === 401 || err?.message?.includes('API key')) {
    message = 'OpenAI API key is invalid. Please check your API key in Admin > Settings.'
  } else if (err?.status === 429) {
    message = 'Rate limit exceeded. Please try again in a few minutes.'
  } else if (err?.status === 400) {
    message = 'Invalid request. The data may be too large to process.'
  } else if (err?.message) {
    message = `Error: ${err.message}`
  }
  return new ApiError(500, message)
}

/**
 * POST /api/recordings/analyze
 * Ask a free-form question over recent meeting data (form answers + recording analysis).
 * REPORTER: only meetings they run. SUPER_ADMIN: everything, optionally filtered by department.
 */
export const POST = withApiAuth(REPORTER_OR_ADMIN, async (req: NextRequest, { user }) => {
  const { allowed } = checkRateLimit(req, 'api')
  if (!allowed) throw new ApiError(429, 'Too many requests')

  const { question, departmentId } = await parseBody(req, recordingsAnalyzeSchema)

  const settings = await getSettings()
  if (!settings.openaiApiKey) {
    throw badRequest('OpenAI API key not configured. Please configure it in Admin > Settings.')
  }

  const where: Prisma.MeetingWhereInput = {}
  if (user.role === UserRole.REPORTER) where.reporterId = user.id
  if (departmentId) where.employee = { departmentId }

  const meetings = await prisma.meeting.findMany({
    where,
    include: {
      employee: { include: { department: true } },
      reporter: true,
      recording: { where: { status: 'COMPLETED' } },
    },
    orderBy: { meetingDate: 'desc' },
    take: 100, // Limit to recent 100 meetings
  })

  // Only include meetings with some data
  const meetingData = meetings
    .map(toMeetingData)
    .filter((m) => m.checkInPersonal || m.checkInProfessional || m.transcript || m.summary)

  if (meetingData.length === 0) {
    return NextResponse.json({
      answer: "I don't have enough meeting data to analyze. Please ensure there are completed meetings with form submissions or recordings.",
      sources: [],
      insights: [],
    })
  }

  const openai = new OpenAI({ apiKey: settings.openaiApiKey })
  const { systemPrompt, userPrompt } = buildPrompts(meetingData, question, departmentId)

  let analysis: Record<string, unknown>
  try {
    const response = await openai.chat.completions.create({
      model: settings.openaiModel || 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    })
    const content = response.choices[0].message.content
    if (!content) throw new Error('No response from OpenAI')
    analysis = JSON.parse(content)
  } catch (error) {
    throw toOpenAiError(error)
  }

  return NextResponse.json({
    question,
    meetingsAnalyzed: meetingData.length,
    ...analysis,
  })
})
