/**
 * Check-in form answers + their history. Employee submit/resubmit and owner/admin edits all go
 * through here so every change to submitted answers lands in MeetingFormRevision.
 */
import { FormRevisionKind, Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { badRequest, forbidden } from './api-errors'
import { createAuditLog } from './audit'
import { canEditFormAnswers, type ActorRef } from './meeting-access'
import * as notify from './notify'
import { FORM_FIELDS, diffAnswers, missingRequired, pickAnswers, type FormAnswerChange, type FormAnswers } from './form-fields'

export const formAnswerSelect = Object.fromEntries(FORM_FIELDS.map((f) => [f.key, true])) as Record<keyof FormAnswers, true>

export function requireComplete(answers: FormAnswers) {
  const missing = missingRequired(answers)
  if (missing.length > 0) throw badRequest(`Please fill in the required fields: ${missing.join(', ')}`)
}

export function recordRevision(
  db: Prisma.TransactionClient | typeof prisma,
  args: { meetingId: string; editedById: string; kind: FormRevisionKind; changes: FormAnswerChange[] }
) {
  return db.meetingFormRevision.create({
    data: { meetingId: args.meetingId, editedById: args.editedById, kind: args.kind, changes: args.changes as unknown as Prisma.InputJsonValue },
  })
}

/** Answers for a first submission = every filled field, "before" empty. */
export const initialChanges = (answers: FormAnswers) => diffAnswers({}, answers)

interface EditableMeeting {
  id: string
  employeeId: string
  reporterId: string
  formSubmittedAt: Date | null
  status: string
}

/**
 * Owner/admin edit of submitted answers. `input` may hold any subset of fields; omitted fields keep
 * their value. Returns the changed fields (empty = nothing saved).
 */
export async function editFormAnswers(meeting: EditableMeeting, actor: ActorRef & { name?: string | null }, input: Partial<FormAnswers>) {
  if (!canEditFormAnswers(actor, meeting)) {
    throw meeting.formSubmittedAt ? forbidden('Only the person who scheduled this meeting or an admin can edit the answers') : badRequest('The employee has not submitted the form yet')
  }
  const row = await prisma.meeting.findUniqueOrThrow({ where: { id: meeting.id }, select: formAnswerSelect })
  const current = pickAnswers(row)
  const provided = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
  const next = pickAnswers({ ...current, ...provided })
  requireComplete(next)
  const changes = diffAnswers(current, next)
  if (changes.length === 0) return changes

  await prisma.$transaction([
    prisma.meeting.update({ where: { id: meeting.id }, data: Object.fromEntries(changes.map((c) => [c.field, c.after])) }),
    recordRevision(prisma, { meetingId: meeting.id, editedById: actor.id, kind: 'EDITED', changes }),
  ])
  await createAuditLog({
    userId: actor.id,
    action: 'UPDATE',
    entityType: 'Meeting',
    entityId: meeting.id,
    details: { action: 'form_answers_edited', fields: changes.map((c) => c.field) },
  })
  if (actor.id !== meeting.employeeId) {
    await notify.formEdited({ meetingId: meeting.id, employeeId: meeting.employeeId, editorName: actor.name ?? null, fieldCount: changes.length })
  }
  return changes
}
