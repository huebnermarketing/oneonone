import { NextRequest, NextResponse } from 'next/server'
import { badRequest, forbidden, notFound, parseBody, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit'
import { assertAccess, canFillForm } from '@/lib/meeting-access'
import { sendFormSubmittedEmail } from '@/lib/email'
import { notifyFormSubmitted } from '@/lib/notifications'
import { meetingFormSchema } from '@/lib/validation/meetings'

export const dynamic = 'force-dynamic'

const REQUIRED_ON_SUBMIT = [
  ['checkInPersonal', 'Personal best since we last met'],
  ['checkInProfessional', 'Professional best since we last met'],
  ['priorityGoalProfessional', 'Professional growth goals'],
  ['progressReport', 'Report on progress'],
] as const

const formInclude = {
  employee: { select: { name: true } },
  reporter: { select: { name: true, email: true } },
} as const

/**
 * POST /api/meetings/[id]/form — the employee saves a draft (`draft: true`) or submits their check-in form.
 * Submitting sets `formSubmittedAt` once; the reporter marks the meeting completed separately.
 */
export const POST = withApiAuth(async (req: NextRequest, { user, params }) => {
  const { draft, ...fields } = await parseBody(req, meetingFormSchema)

  const meeting = await prisma.meeting.findUnique({
    where: { id: params.id },
    select: { id: true, employeeId: true, reporterId: true, meetingDate: true, formSubmittedAt: true },
  })
  if (!meeting) throw notFound('Meeting')
  assertAccess(canFillForm(user, meeting), 'Only the employee can fill in this form')

  // After the meeting time, a submitted form is locked
  if (meeting.formSubmittedAt && meeting.meetingDate.getTime() < Date.now()) {
    throw forbidden('Form cannot be edited after the meeting time.')
  }

  // Empty strings are stored as null
  const data = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, value ? value : null])
  ) as { [K in keyof typeof fields]: string | null }

  if (draft) {
    const saved = await prisma.meeting.update({ where: { id: meeting.id }, data, include: formInclude })
    return NextResponse.json(saved)
  }

  const missing = REQUIRED_ON_SUBMIT.filter(([key]) => !data[key]).map(([, label]) => label)
  if (missing.length > 0) throw badRequest(`Please fill in the required fields: ${missing.join(', ')}`)

  const wasAlreadySubmitted = !!meeting.formSubmittedAt
  const updated = await prisma.meeting.update({
    where: { id: meeting.id },
    data: { ...data, formSubmittedAt: wasAlreadySubmitted ? meeting.formSubmittedAt : new Date() },
    include: formInclude,
  })

  await createAuditLog({
    userId: user.id,
    action: 'UPDATE',
    entityType: 'Meeting',
    entityId: meeting.id,
    details: { action: wasAlreadySubmitted ? 'form_resubmitted' : 'form_submitted' },
  })

  if (!wasAlreadySubmitted) {
    await Promise.all([
      sendFormSubmittedEmail(updated.reporter.email, updated.reporter.name, updated.employee.name, updated.meetingDate, updated.id).catch(
        (e) => console.error('Failed to send email notification:', e)
      ),
      notifyFormSubmitted(meeting.reporterId, updated.employee.name, updated.id).catch((e) =>
        console.error('Failed to create notification:', e)
      ),
    ])
  }

  return NextResponse.json(updated)
})
