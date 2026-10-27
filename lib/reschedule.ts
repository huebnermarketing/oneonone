/**
 * Rescheduling a SCHEDULED meeting (one-off or a single occurrence of a recurring series).
 *
 * Either participant asks for a new time → the meeting keeps its current time (still on both
 * calendars) and shows "Reschedule pending" → the OTHER participant accepts (meeting + calendar
 * move, reminders re-arm) or declines; the requester can withdraw. Asking again replaces the
 * pending request, so the other side can counter with their own time. Only that meeting moves;
 * the recurring schedule and its other occurrences are untouched.
 */
import { MeetingStatus } from '@prisma/client'
import { prisma } from './prisma'
import { badRequest, forbidden } from './api-errors'
import { logMeetingUpdated } from './audit'
import { assertNoConflict } from './meeting-conflicts'
import { CLEAR_RESCHEDULE, meetingWithParties, type MeetingWithParties } from './meeting-state'
import { moveCalendarOccurrence, updateCalendarEvent } from './google-calendar'
import { getPolicies } from './settings'
import { resolveTimeZone } from './dates'
import { assertWorkingDay } from './working-days'
import * as notify from './notify'

export interface RescheduleActor {
  id: string
  name?: string | null
  timeZone?: string | null
}

type MeetingParties = Pick<MeetingWithParties, 'employeeId' | 'reporterId' | 'rescheduleRequestedById'>

/** 'requester' asked for the pending change, 'responder' is the other participant; null = no pending request or not a participant. */
export function rescheduleRole(actorId: string, m: MeetingParties): 'requester' | 'responder' | null {
  if (!m.rescheduleRequestedById) return null
  if (actorId === m.rescheduleRequestedById) return 'requester'
  if (actorId === m.employeeId || actorId === m.reporterId) return 'responder'
  return null
}

const isParticipant = (actorId: string, m: MeetingParties) => actorId === m.employeeId || actorId === m.reporterId

const otherParty = (actorId: string, m: MeetingWithParties) => (actorId === m.employeeId ? m.reporter : m.employee)

function assertScheduled(m: MeetingWithParties) {
  if (m.status !== MeetingStatus.SCHEDULED) throw badRequest('Only a scheduled meeting can be rescheduled')
}

/** Ask to move the meeting. Replaces any pending request (a counter-proposal from the other side). */
export async function requestReschedule(
  meeting: MeetingWithParties,
  actor: RescheduleActor,
  input: { meetingDate: Date; durationMinutes?: number; reason?: string | null },
  now = new Date()
) {
  assertScheduled(meeting)
  if (!isParticipant(actor.id, meeting)) throw forbidden('Only the two people in this meeting can reschedule it')
  const { meetingDate } = input
  const durationMinutes = input.durationMinutes ?? meeting.durationMinutes
  if (meetingDate.getTime() <= now.getTime()) throw badRequest('Pick a time in the future')
  if (meetingDate.getTime() === meeting.meetingDate.getTime() && durationMinutes === meeting.durationMinutes) {
    throw badRequest('That is the current time. Pick a different time.')
  }
  assertWorkingDay(meetingDate, resolveTimeZone(actor.timeZone), (await getPolicies()).workingDays)
  await assertNoConflict(meeting.employeeId, meeting.reporterId, meetingDate, { durationMinutes, excludeMeetingId: meeting.id })

  const reason = input.reason?.trim() || null
  const updated = await prisma.meeting.update({
    where: { id: meeting.id },
    data: {
      rescheduleDate: meetingDate,
      rescheduleDuration: durationMinutes,
      rescheduleRequestedById: actor.id,
      rescheduleRequestedAt: now,
      rescheduleReason: reason,
    },
    ...meetingWithParties,
  })

  await logMeetingUpdated(actor.id, meeting.id, {
    action: 'reschedule_requested',
    from: meeting.meetingDate.toISOString(),
    to: meetingDate.toISOString(),
    durationMinutes,
    reason,
  })
  await notify.rescheduleRequested({
    meetingId: meeting.id,
    currentDate: meeting.meetingDate,
    newDate: meetingDate,
    durationMinutes,
    to: otherParty(actor.id, meeting),
    from: { name: actor.name ?? null },
    reason,
  })
  return updated
}

/** The other participant accepts: the meeting (and its calendar event / series occurrence) moves. */
export async function acceptReschedule(meeting: MeetingWithParties, actor: RescheduleActor, now = new Date()) {
  assertScheduled(meeting)
  if (!meeting.rescheduleDate || !meeting.rescheduleRequestedById) throw badRequest('There is no reschedule request to accept')
  if (rescheduleRole(actor.id, meeting) !== 'responder') {
    throw forbidden(actor.id === meeting.rescheduleRequestedById ? 'Waiting for the other person to accept your request' : 'Only the other participant can accept')
  }
  const newDate = meeting.rescheduleDate
  const durationMinutes = meeting.rescheduleDuration ?? meeting.durationMinutes
  if (newDate.getTime() <= now.getTime()) throw badRequest('The requested time has already passed. Ask for a new time instead.')
  await assertNoConflict(meeting.employeeId, meeting.reporterId, newDate, { durationMinutes, excludeMeetingId: meeting.id })

  const from = meeting.meetingDate
  const requesterId = meeting.rescheduleRequestedById
  const updated = await prisma.meeting.update({
    where: { id: meeting.id },
    data: {
      meetingDate: newDate,
      durationMinutes,
      // reminders are due again for the new time
      reminder24hSent: false,
      reminderSent: false,
      formReminderSent: false,
      ...CLEAR_RESCHEDULE,
    },
    ...meetingWithParties,
  })

  // Calendar (best effort): the meeting's own event, or its day in the recurring series
  try {
    if (meeting.calendarEvent) {
      await updateCalendarEvent(meeting.calendarEvent.googleEventId, meeting.reporterId, newDate, meeting.employee.name ?? '', meeting.reporter.name ?? '', durationMinutes)
    } else if (meeting.recurringSchedule?.googleRecurringEventId) {
      const moved = await moveCalendarOccurrence(meeting.recurringSchedule.googleRecurringEventId, meeting.reporterId, from, newDate, durationMinutes)
      if (!moved) console.warn(`[reschedule] series occurrence not found for meeting ${meeting.id}`)
    }
  } catch (err) {
    console.error('[reschedule] calendar update failed', err)
  }

  await logMeetingUpdated(actor.id, meeting.id, {
    action: 'reschedule_accepted',
    from: from.toISOString(),
    to: newDate.toISOString(),
    durationMinutes,
  })
  const requester = requesterId === meeting.employeeId ? meeting.employee : meeting.reporter
  await notify.rescheduleAccepted({ meetingId: meeting.id, newDate, durationMinutes, to: requester, acceptorName: actor.name ?? null })
  return updated
}

/** Decline (other participant) or withdraw (requester). The meeting keeps its time. */
export async function dropReschedule(meeting: MeetingWithParties, actor: RescheduleActor) {
  if (!meeting.rescheduleRequestedById) throw badRequest('There is no reschedule request')
  const role = rescheduleRole(actor.id, meeting)
  if (!role) throw forbidden('Only the two people in this meeting can respond')
  const withdrawn = role === 'requester'

  const updated = await prisma.meeting.update({ where: { id: meeting.id }, data: CLEAR_RESCHEDULE, ...meetingWithParties })

  await logMeetingUpdated(actor.id, meeting.id, {
    action: withdrawn ? 'reschedule_withdrawn' : 'reschedule_declined',
    requestedDate: meeting.rescheduleDate?.toISOString() ?? null,
  })
  await notify.rescheduleDeclined({ meetingId: meeting.id, keptDate: meeting.meetingDate, to: otherParty(actor.id, meeting), actorName: actor.name ?? null, withdrawn })
  return { meeting: updated, withdrawn }
}
