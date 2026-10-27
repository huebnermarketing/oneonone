import { NextRequest, NextResponse } from 'next/server'
import { badRequest, forbidden, notFound, parseBody, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit'
import { assertAccess, canFillForm, canViewMeeting } from '@/lib/meeting-access'
import * as notify from '@/lib/notify'
import { editFormAnswers, formAnswerSelect, initialChanges, recordRevision, requireComplete } from '@/lib/form-answers'
import { diffAnswers, pickAnswers } from '@/lib/form-fields'
import { meetingFormEditSchema, meetingFormSchema } from '@/lib/validation/meetings'

export const dynamic = 'force-dynamic'

const formInclude = {
  employee: { select: { name: true } },
  reporter: { select: { name: true, email: true } },
} as const

/**
 * POST /api/meetings/[id]/form — the employee saves a draft (`draft: true`, only before submitting)
 * or submits / resubmits their check-in form. Every submit is recorded in the answer history.
 */
export const POST = withApiAuth(async (req: NextRequest, { user, params }) => {
  const { draft, ...fields } = await parseBody(req, meetingFormSchema)

  const meeting = await prisma.meeting.findUnique({
    where: { id: params.id },
    select: { id: true, employeeId: true, reporterId: true, meetingDate: true, formSubmittedAt: true, ...formAnswerSelect },
  })
  if (!meeting) throw notFound('Meeting')
  assertAccess(canFillForm(user, meeting), 'Only the employee can fill in this form')

  // After the meeting time, a submitted form is locked for the employee (owner/admin can still correct it)
  if (meeting.formSubmittedAt && meeting.meetingDate.getTime() < Date.now()) {
    throw forbidden('Form cannot be edited after the meeting time.')
  }

  const answers = pickAnswers(fields)

  if (draft) {
    // Once submitted, changes go through a (recorded) resubmit, never a silent draft overwrite
    if (meeting.formSubmittedAt) throw badRequest('This form is already submitted. Use "Update answers" to change it.')
    const saved = await prisma.meeting.update({ where: { id: meeting.id }, data: answers, include: formInclude })
    return NextResponse.json(saved)
  }

  requireComplete(answers)

  const wasAlreadySubmitted = !!meeting.formSubmittedAt
  const changes = wasAlreadySubmitted ? diffAnswers(pickAnswers(meeting), answers) : initialChanges(answers)
  const [updated] = await prisma.$transaction([
    prisma.meeting.update({
      where: { id: meeting.id },
      data: { ...answers, formSubmittedAt: wasAlreadySubmitted ? meeting.formSubmittedAt : new Date() },
      include: formInclude,
    }),
    ...(changes.length > 0
      ? [recordRevision(prisma, { meetingId: meeting.id, editedById: user.id, kind: wasAlreadySubmitted ? 'RESUBMITTED' : 'SUBMITTED', changes })]
      : []),
  ])

  await createAuditLog({
    userId: user.id,
    action: 'UPDATE',
    entityType: 'Meeting',
    entityId: meeting.id,
    details: { action: wasAlreadySubmitted ? 'form_resubmitted' : 'form_submitted', fields: changes.map((c) => c.field) },
  })

  if (!wasAlreadySubmitted) {
    await notify.formSubmitted({ meetingId: updated.id, date: updated.meetingDate, reporter: { ...updated.reporter, id: meeting.reporterId }, employeeName: updated.employee.name })
  }

  return NextResponse.json(updated)
})

/**
 * PATCH /api/meetings/[id]/form — the meeting owner (who scheduled it) or a super admin corrects the
 * employee's submitted answers. Any time after submission (also after the meeting); recorded in the
 * history and the employee gets an in-app note.
 */
export const PATCH = withApiAuth(async (req: NextRequest, { user, params }) => {
  const input = await parseBody(req, meetingFormEditSchema)
  const meeting = await prisma.meeting.findUnique({
    where: { id: params.id },
    select: { id: true, employeeId: true, reporterId: true, formSubmittedAt: true, status: true },
  })
  if (!meeting) throw notFound('Meeting')
  assertAccess(canViewMeeting(user, meeting))
  const changes = await editFormAnswers(meeting, user, input)
  return NextResponse.json({ changed: changes.map((c) => c.field) })
})
