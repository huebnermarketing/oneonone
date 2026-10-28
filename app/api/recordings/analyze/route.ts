import { NextRequest, NextResponse } from 'next/server'
import { UserRole, Prisma } from '@prisma/client'
import { ApiError, badRequest, parseBody, REPORTER_OR_ADMIN, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { getAiClient, chatJson, AiNotConfiguredError } from '@/lib/ai'
import { checkRateLimit } from '@/lib/rate-limit'
import { recordingsAnalyzeSchema } from '@/lib/validation/misc'

export const dynamic = 'force-dynamic'

/** Only the columns the prompt uses (never full transcripts or whole user rows) */
const meetingForAnalysis = Prisma.validator<Prisma.MeetingDefaultArgs>()({
  select: {
    meetingDate: true,
    checkInPersonal: true,
    checkInProfessional: true,
    priorityGoalProfessional: true,
    priorityGoalAgency: true,
    progressReport: true,
    goodNews: true,
    supportNeeded: true,
    priorityDiscussions: true,
    headsUp: true,
    anythingElse: true,
    employee: { select: { name: true, department: { select: { name: true } } } },
    recording: { select: { status: true, summary: true, keyPoints: true, sentiment: true } },
  },
})
type MeetingRow = Prisma.MeetingGetPayload<typeof meetingForAnalysis>

/** Prompt size guard: each answer/summary is clipped, and meetings stop being added past the budget */
const FIELD_MAX_CHARS = 800
const CONTEXT_MAX_CHARS = 120_000
const clip = (v: string | null | undefined) => (v && v.length > FIELD_MAX_CHARS ? `${v.slice(0, FIELD_MAX_CHARS)}…` : v)

/** Flatten a meeting (form answers + recording analysis) into the shape fed to the model. */
function toMeetingData(m: MeetingRow) {
  const rec = m.recording?.status === 'COMPLETED' ? m.recording : null
  return {
    date: m.meetingDate.toISOString().split('T')[0],
    employee: m.employee.name,
    department: m.employee.department?.name || 'Unassigned',
    // Form responses
    checkInPersonal: clip(m.checkInPersonal),
    checkInProfessional: clip(m.checkInProfessional),
    priorityGoalProfessional: clip(m.priorityGoalProfessional),
    priorityGoalAgency: clip(m.priorityGoalAgency),
    progressReport: clip(m.progressReport),
    goodNews: clip(m.goodNews),
    supportNeeded: clip(m.supportNeeded),
    priorityDiscussions: clip(m.priorityDiscussions),
    headsUp: clip(m.headsUp),
    anythingElse: clip(m.anythingElse),
    // Recording analysis (the AI summary stands in for the transcript)
    summary: clip(rec?.summary),
    keyPoints: rec?.keyPoints,
    sentiment: rec?.sentiment,
  }
}

type MeetingData = ReturnType<typeof toMeetingData>

function buildPrompts(allMeetingData: MeetingData[], question: string, departmentId: string | null | undefined) {
  const blocks: string[] = []
  let size = 0
  for (const [i, m] of allMeetingData.entries()) {
    const block = meetingBlock(m, i)
    if (size + block.length > CONTEXT_MAX_CHARS && blocks.length > 0) break
    blocks.push(block)
    size += block.length
  }
  const meetingData = allMeetingData.slice(0, blocks.length)
  const context = blocks.join('\n\n---\n\n')
  return { ...prompts(meetingData, context, question, departmentId), used: meetingData.length }
}

function meetingBlock(m: MeetingData, i: number): string {
  return `
Meeting ${i + 1} (${m.date}) - ${m.employee} (${m.department}):
${m.checkInProfessional ? `Professional Check-in: ${m.checkInProfessional}` : ''}
${m.supportNeeded ? `Support Needed: ${m.supportNeeded}` : ''}
${m.priorityDiscussions ? `Priority Discussions: ${m.priorityDiscussions}` : ''}
${m.headsUp ? `Heads Up: ${m.headsUp}` : ''}
${m.anythingElse ? `Other Notes: ${m.anythingElse}` : ''}
${m.summary ? `Meeting Summary: ${m.summary}` : ''}
${m.keyPoints ? `Key Points: ${JSON.stringify(m.keyPoints)}` : ''}
${m.sentiment ? `Sentiment: ${JSON.stringify(m.sentiment)}` : ''}
`.trim()
}

function prompts(meetingData: MeetingData[], context: string, question: string, departmentId: string | null | undefined) {
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
    message = 'AI provider API key is invalid. Please check your API key in Admin > Settings.'
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

  let ai: Awaited<ReturnType<typeof getAiClient>>
  try {
    ai = await getAiClient()
  } catch (e) {
    if (e instanceof AiNotConfiguredError) throw badRequest(e.message)
    throw e
  }

  const where: Prisma.MeetingWhereInput = {}
  if (user.role === UserRole.REPORTER) where.reporterId = user.id
  if (departmentId) where.employee = { departmentId }

  const meetings = await prisma.meeting.findMany({
    where,
    ...meetingForAnalysis,
    orderBy: { meetingDate: 'desc' },
    take: 100, // Limit to recent 100 meetings
  })

  // Only include meetings with some data
  const meetingData = meetings
    .map(toMeetingData)
    .filter((m) => m.checkInPersonal || m.checkInProfessional || m.summary)

  if (meetingData.length === 0) {
    return NextResponse.json({
      answer: "I don't have enough meeting data to analyze. Please ensure there are completed meetings with form submissions or recordings.",
      sources: [],
      insights: [],
    })
  }

  const { systemPrompt, userPrompt, used } = buildPrompts(meetingData, question, departmentId)

  let analysis: Record<string, unknown>
  try {
    analysis = await chatJson<Record<string, unknown>>(ai.client, {
      model: ai.config.chatModel,
      system: systemPrompt,
      user: userPrompt,
      temperature: 0.3,
    })
  } catch (error) {
    throw toOpenAiError(error)
  }

  return NextResponse.json({
    question,
    meetingsAnalyzed: used,
    ...analysis,
  })
})
