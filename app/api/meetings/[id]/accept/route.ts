import { NextRequest, NextResponse } from 'next/server'
import { badRequest, notFound, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { logMeetingUpdated } from '@/lib/audit'
import { assertAccess, canAccept } from '@/lib/meeting-access'
import { assertTransition, loadMeeting } from '@/lib/meeting-state'
import { createCalendarEvent, createRecurringCalendarEvent, isCalendarEnabled } from '@/lib/google-calendar'
import { sendMeetingAcceptedEmail } from '@/lib/email'
import { notifyMeetingAccepted } from '@/lib/notifications'
import { advanceToNextOccurrence } from '@/lib/recurring-dates'
import { DEFAULT_TIMEZONE } from '@/lib/constants'

export const dynamic = 'force-dynamic'

/**
 * POST /api/meetings/[id]/accept — the receiver of a proposal (or an admin) confirms it.
 * PROPOSED → SCHEDULED, calendar event on the reporter's calendar, proposer notified.
 * For recurring meetings the next occurrence is created in the same transaction.
 */
export const POST = withApiAuth(async (_req: NextRequest, { user, params }) => {
  const meeting = await loadMeeting(params.id)
  if (!meeting) throw notFound('Meeting')

  assertTransition(meeting.status, 'SCHEDULED')
  if (meeting.meetingDate.getTime() < Date.now()) {
    throw badRequest('The proposed meeting time has already passed. Please suggest a new time instead.')
  }
  assertAccess(canAccept(user, meeting), 'Only the meeting receiver can accept this proposal')

  // Status flip + next recurring occurrence + schedule advance are one atomic unit
  const updated = await prisma.$transaction(async (tx) => {
    const accepted = await tx.meeting.update({
      where: { id: meeting.id },
      data: { status: 'SCHEDULED' },
      include: {
        employee: { select: { id: true, name: true, email: true } },
        reporter: { select: { id: true, name: true, email: true } },
      },
    })

    if (meeting.recurringScheduleId) {
      const schedule = await tx.recurringSchedule.findUnique({
        where: { id: meeting.recurringScheduleId },
        include: { reporter: { select: { timeZone: true } } },
      })
      if (schedule?.isActive && schedule.nextMeetingDate) {
        const nextDate = schedule.nextMeetingDate
        const alreadyExists = await tx.meeting.findFirst({
          where: { recurringScheduleId: schedule.id, meetingDate: nextDate, status: { not: 'CANCELLED' } },
          select: { id: true },
        })
        if (!alreadyExists) {
          await tx.meeting.create({
            data: {
              employeeId: schedule.employeeId,
              reporterId: schedule.reporterId,
              meetingDate: nextDate,
              recurringScheduleId: schedule.id,
              status: 'SCHEDULED',
              proposedById: schedule.reporterId,
            },
          })
          const futureDate = advanceToNextOccurrence(
            schedule.dayOfWeek,
            schedule.timeOfDay,
            schedule.frequency,
            nextDate,
            schedule.reporter?.timeZone || DEFAULT_TIMEZONE
          )
          await tx.recurringSchedule.update({
            where: { id: schedule.id },
            data: { nextMeetingDate: futureDate, lastGeneratedAt: new Date() },
          })
        }
      }
    }

    return accepted
  })

  // ---- Side effects (best effort, outside the transaction) ----
  try {
    if (await isCalendarEnabled(meeting.reporterId)) {
      if (meeting.recurringScheduleId) {
        const schedule = await prisma.recurringSchedule.findUnique({
          where: { id: meeting.recurringScheduleId },
          select: { googleRecurringEventId: true, frequency: true, reporter: { select: { timeZone: true } } },
        })
        if (schedule && !schedule.googleRecurringEventId) {
          await createRecurringCalendarEvent(
            meeting.recurringScheduleId,
            meeting.id,
            meeting.reporterId,
            meeting.employee.email,
            meeting.reporter.email,
            meeting.meetingDate,
            meeting.employee.name,
            meeting.reporter.name,
            schedule.frequency,
            schedule.reporter?.timeZone ?? DEFAULT_TIMEZONE
          )
        }
      } else {
        await createCalendarEvent(
          meeting.id,
          meeting.employee.email,
          meeting.reporter.email,
          meeting.reporterId,
          meeting.meetingDate,
          meeting.employee.name,
          meeting.reporter.name
        )
      }
    }
  } catch (error) {
    console.error('Failed to create calendar event on acceptance:', error)
  }

  const proposer = meeting.proposedById === meeting.reporterId ? meeting.reporter : meeting.employee
  const acceptor = user.id === meeting.employeeId ? meeting.employee : meeting.reporter

  await Promise.all([
    sendMeetingAcceptedEmail(proposer.email, proposer.name, acceptor.name, meeting.meetingDate, meeting.id).catch((e) =>
      console.error('Failed to send acceptance email:', e)
    ),
    notifyMeetingAccepted(proposer.id, acceptor.name, meeting.meetingDate, meeting.id).catch((e) =>
      console.error('Failed to create acceptance notification:', e)
    ),
    logMeetingUpdated(user.id, params.id, { action: 'accepted', acceptedBy: acceptor.name, status: 'SCHEDULED' }),
  ])

  return NextResponse.json(updated)
})
