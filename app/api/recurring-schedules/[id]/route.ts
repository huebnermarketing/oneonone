import { NextRequest, NextResponse } from 'next/server'
import { MeetingStatus, Prisma, UserRole } from '@prisma/client'
import { notFound, parseBody, parseQuery, withApiAuth, SessionUser } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit'
import { calculateFirstOccurrence } from '@/lib/recurring-dates'
import { deleteCalendarEvent } from '@/lib/google-calendar'
import { sendRecurringScheduleUpdatedEmail } from '@/lib/email'
import { createNotification, notifyMeetingCancelled } from '@/lib/notifications'
import { DEFAULT_TIMEZONE } from '@/lib/constants'
import { deleteRecurringQuery, updateRecurringScheduleSchema } from '@/lib/validation/recurring'

export const dynamic = 'force-dynamic'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const scheduleWithParties = Prisma.validator<Prisma.RecurringScheduleDefaultArgs>()({
  include: {
    employee: { select: { id: true, name: true, email: true } },
    reporter: { select: { id: true, name: true, timeZone: true } },
  },
})
type ScheduleWithParties = Prisma.RecurringScheduleGetPayload<typeof scheduleWithParties>

/** A reporter sees only their own schedules; an admin sees all. */
async function loadSchedule(id: string, user: SessionUser): Promise<ScheduleWithParties> {
  const schedule = await prisma.recurringSchedule.findFirst({
    where: user.role === UserRole.SUPER_ADMIN ? { id } : { id, reporterId: user.id },
    ...scheduleWithParties,
  })
  if (!schedule) throw notFound('Schedule')
  return schedule
}

type FutureMeeting = Prisma.MeetingGetPayload<{ include: { calendarEvent: true } }>

/** Future SCHEDULED meetings generated from this schedule (the ones "cancel future meetings" affects). */
function findFutureScheduledMeetings(scheduleId: string): Promise<FutureMeeting[]> {
  return prisma.meeting.findMany({
    where: { recurringScheduleId: scheduleId, status: MeetingStatus.SCHEDULED, meetingDate: { gt: new Date() } },
    include: { calendarEvent: true },
  })
}

/**
 * Best-effort side effects after future meetings were cancelled in the DB:
 * remove the Google Calendar series + per-meeting events, tell the employee about each cancellation.
 */
async function afterFutureMeetingsCancelled(schedule: ScheduleWithParties, meetings: FutureMeeting[], actorName: string) {
  if (schedule.googleRecurringEventId) {
    await deleteCalendarEvent(schedule.googleRecurringEventId, schedule.reporterId).catch((e) =>
      console.error('Failed to delete recurring calendar series', e)
    )
  }
  await Promise.all(
    meetings.flatMap((m) => [
      m.calendarEvent
        ? deleteCalendarEvent(m.calendarEvent.googleEventId, m.reporterId).catch((e) =>
            console.error('Failed to delete calendar event for meeting', m.id, e)
          )
        : Promise.resolve(),
      notifyMeetingCancelled(m.employeeId, actorName, m.meetingDate, m.id).catch((e) =>
        console.error('Failed to notify cancellation for meeting', m.id, e)
      ),
    ])
  )
}

/** GET /api/recurring-schedules/[id] — schedule with its last 10 meetings and the count of upcoming ones. */
export const GET = withApiAuth(async (_req: NextRequest, { user, params }) => {
  const schedule = await prisma.recurringSchedule.findFirst({
    where: user.role === UserRole.SUPER_ADMIN ? { id: params.id } : { id: params.id, reporterId: user.id },
    include: {
      employee: { select: { id: true, name: true, email: true } },
      meetings: { orderBy: { meetingDate: 'desc' }, take: 10 },
    },
  })
  if (!schedule) throw notFound('Schedule')

  const upcomingMeetingCount = await prisma.meeting.count({
    where: { recurringScheduleId: schedule.id, status: MeetingStatus.SCHEDULED, meetingDate: { gt: new Date() } },
  })

  return NextResponse.json({ ...schedule, upcomingMeetingCount })
})

/**
 * PATCH /api/recurring-schedules/[id] — change timing / type / active flag.
 * `isActive: false` + `cancelFutureMeetings: true` also cancels future SCHEDULED meetings.
 * A timing change recalculates nextMeetingDate and moves future PROPOSED meetings to it.
 */
export const PATCH = withApiAuth(async (req: NextRequest, { user, params }) => {
  const body = await parseBody(req, updateRecurringScheduleSchema)
  const { frequency, dayOfWeek, timeOfDay, isActive, cancelFutureMeetings, meetingType, meetingLink } = body

  const existing = await loadSchedule(params.id, user)
  const actorName = user.name || 'Your manager'

  const cancelling = isActive === false && cancelFutureMeetings === true
  const futureMeetings = cancelling ? await findFutureScheduledMeetings(existing.id) : []

  const scheduleChanged =
    (frequency !== undefined && frequency !== existing.frequency) ||
    (dayOfWeek !== undefined && dayOfWeek !== existing.dayOfWeek) ||
    (timeOfDay !== undefined && timeOfDay !== existing.timeOfDay)

  const newDay = dayOfWeek ?? existing.dayOfWeek
  const newTime = timeOfDay ?? existing.timeOfDay
  const newFreq = frequency ?? existing.frequency
  const reporterTz = existing.reporter.timeZone || DEFAULT_TIMEZONE
  const newNextDate = scheduleChanged ? calculateFirstOccurrence(newDay, newTime, newFreq, reporterTz) : undefined

  const updateData: Prisma.RecurringScheduleUpdateInput = {
    ...(frequency !== undefined && { frequency }),
    ...(dayOfWeek !== undefined && { dayOfWeek }),
    ...(timeOfDay !== undefined && { timeOfDay }),
    ...(isActive !== undefined && { isActive }),
    ...(meetingType !== undefined && { meetingType }),
    ...(meetingType === 'ZOOM' && meetingLink !== undefined && { meetingLink: meetingLink ?? null }),
    ...(meetingType === 'IN_PERSON' && { meetingLink: null }),
    ...(newNextDate && { nextMeetingDate: newNextDate }),
    ...(cancelling && { googleRecurringEventId: null, googleCalendarLink: null }),
  }

  const schedule = await prisma.$transaction(async (tx) => {
    if (futureMeetings.length > 0) {
      await tx.meeting.updateMany({
        where: { id: { in: futureMeetings.map((m) => m.id) } },
        data: { status: MeetingStatus.CANCELLED },
      })
    }
    if (newNextDate) {
      await tx.meeting.updateMany({
        where: { recurringScheduleId: existing.id, status: MeetingStatus.PROPOSED, meetingDate: { gt: new Date() } },
        data: { meetingDate: newNextDate },
      })
    }
    return tx.recurringSchedule.update({ where: { id: existing.id }, data: updateData })
  })

  await createAuditLog({
    userId: user.id,
    action: 'UPDATE',
    entityType: 'RecurringSchedule',
    entityId: existing.id,
    details: { changes: body, employeeName: existing.employee.name, cancelledMeetingCount: futureMeetings.length },
  })

  // ---- Side effects (best effort) ----
  if (cancelling) await afterFutureMeetingsCancelled(existing, futureMeetings, actorName)

  if (scheduleChanged) {
    const [hh, mm] = newTime.split(':').map(Number)
    const displayTime = `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}`
    await Promise.all([
      sendRecurringScheduleUpdatedEmail(existing.employee.email, existing.employee.name, user.name, newDay, newTime, newFreq).catch((e) =>
        console.error('Failed to send schedule update email:', e)
      ),
      createNotification({
        userId: existing.employeeId,
        type: 'MEETING_SCHEDULED',
        title: 'Recurring Schedule Updated',
        message: `${actorName} updated your recurring meeting to ${DAY_NAMES[newDay]}s at ${displayTime}.`,
        link: '/meetings',
      }).catch((e) => console.error('Failed to send schedule update notification:', e)),
    ])
  }

  return NextResponse.json({ ...schedule, cancelledMeetingCount: futureMeetings.length })
})

/**
 * DELETE /api/recurring-schedules/[id]?cancelFutureMeetings=true — soft delete (isActive = false).
 * By default future SCHEDULED meetings are cancelled too; the calendar series is always removed.
 */
export const DELETE = withApiAuth(async (req: NextRequest, { user, params }) => {
  const { cancelFutureMeetings } = parseQuery(req, deleteRecurringQuery)

  const existing = await loadSchedule(params.id, user)
  const futureMeetings = cancelFutureMeetings ? await findFutureScheduledMeetings(existing.id) : []

  await prisma.$transaction(async (tx) => {
    if (futureMeetings.length > 0) {
      await tx.meeting.updateMany({
        where: { id: { in: futureMeetings.map((m) => m.id) } },
        data: { status: MeetingStatus.CANCELLED },
      })
    }
    await tx.recurringSchedule.update({
      where: { id: existing.id },
      data: { isActive: false, googleRecurringEventId: null, googleCalendarLink: null },
    })
  })

  await createAuditLog({
    userId: user.id,
    action: 'DELETE',
    entityType: 'RecurringSchedule',
    entityId: existing.id,
    details: { employeeName: existing.employee.name, cancelFutureMeetings, cancelledMeetingCount: futureMeetings.length },
  })

  await afterFutureMeetingsCancelled(existing, futureMeetings, user.name || 'Your manager')

  return NextResponse.json({ success: true, message: 'Schedule deleted', cancelledMeetingCount: futureMeetings.length })
})
