/**
 * Object-level authorization for meetings. Every route and page that touches a meeting should
 * go through these predicates instead of re-implementing the checks inline.
 *
 * Vocabulary:
 *  - participant: the meeting's employee or reporter
 *  - owner: the meeting's reporter (the manager running the 1:1)
 *  - receiver: the side that did NOT make the current proposal (the one who can accept)
 *  - admin: SUPER_ADMIN, superset of everything
 */
import { UserRole } from '@prisma/client'
import { forbidden } from './api-errors'
import { getPolicies } from './settings'

export interface MeetingRef {
  id: string
  employeeId: string
  reporterId: string
  proposedById?: string | null
}

export interface ActorRef {
  id: string
  role: UserRole
}

export const isAdmin = (actor: ActorRef) => actor.role === UserRole.SUPER_ADMIN
export const isParticipant = (actor: ActorRef, m: MeetingRef) => actor.id === m.employeeId || actor.id === m.reporterId
export const isOwner = (actor: ActorRef, m: MeetingRef) => actor.id === m.reporterId
export const isEmployeeOf = (actor: ActorRef, m: MeetingRef) => actor.id === m.employeeId

/** The side that can accept the current proposal. */
export function isReceiver(actor: ActorRef, m: MeetingRef): boolean {
  if (!m.proposedById) return actor.id === m.employeeId
  const proposerIsThirdParty = m.proposedById !== m.reporterId && m.proposedById !== m.employeeId
  if (m.proposedById === m.reporterId || proposerIsThirdParty) return actor.id === m.employeeId
  return actor.id === m.reporterId
}

/** Read the meeting (detail page, notes read, attachments, availability). */
export const canViewMeeting = (actor: ActorRef, m: MeetingRef) => isAdmin(actor) || isParticipant(actor, m)

/** Change date/type/link, complete, write notes, add todos, record. */
export const canManageMeeting = (actor: ActorRef, m: MeetingRef) => isAdmin(actor) || isOwner(actor, m)

/** Fill in the employee check-in form. Admin is deliberately excluded: the form is the employee's voice. */
export const canFillForm = (actor: ActorRef, m: MeetingRef) => isEmployeeOf(actor, m)

/**
 * Correct the employee's submitted check-in answers (history is kept). Meeting owner (who scheduled
 * it) or admin; only once submitted, and not on a cancelled meeting.
 */
export const canEditFormAnswers = (actor: ActorRef, m: MeetingRef & { formSubmittedAt: Date | null; status: string }) =>
  (isAdmin(actor) || isOwner(actor, m)) && !!m.formSubmittedAt && m.status !== 'CANCELLED'

export const canAccept = (actor: ActorRef, m: MeetingRef) => isAdmin(actor) || isReceiver(actor, m)
export const canSuggest = (actor: ActorRef, m: MeetingRef) => isAdmin(actor) || isParticipant(actor, m)

/** Governed by the cancelPolicy setting. */
export async function canCancel(actor: ActorRef, m: MeetingRef): Promise<boolean> {
  if (isAdmin(actor)) return true
  const { cancelPolicy } = await getPolicies()
  switch (cancelPolicy) {
    case 'ADMIN_ONLY':
      return false
    case 'REPORTER_AND_ADMIN':
      return isOwner(actor, m)
    case 'ANY_PARTICIPANT':
      return isParticipant(actor, m)
  }
}

/** Governed by employeeCanViewRecording. Reporter + admin always can. */
export async function canViewRecording(actor: ActorRef, m: MeetingRef): Promise<boolean> {
  if (canManageMeeting(actor, m)) return true
  if (!isEmployeeOf(actor, m)) return false
  return (await getPolicies()).employeeCanViewRecording
}

/** Governed by employeeCanViewNotes. Reporter + admin always can. */
export async function canViewNotes(actor: ActorRef, m: MeetingRef): Promise<boolean> {
  if (canManageMeeting(actor, m)) return true
  if (!isEmployeeOf(actor, m)) return false
  return (await getPolicies()).employeeCanViewNotes
}

/** Throw a 403 unless the predicate holds. */
export function assertAccess(ok: boolean, message = 'You do not have access to this meeting') {
  if (!ok) throw forbidden(message)
}
