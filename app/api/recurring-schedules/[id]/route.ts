import { NextRequest, NextResponse } from 'next/server'
import { MeetingStatus, Prisma, UserRole } from '@prisma/client'
import { notFound, parseBody, parseQuery, withApiAuth, SessionUser } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit'
import { applySeriesMoveToCalendar, prepareSeriesMove } from '@/lib/recurring-edit'
import { deleteCalendarEvent, setCalendarEventDuration } from '@/lib/google-calendar'
import * as notify from '@/lib/notify'
import { getPolicies } from '@/lib/settings'
import { assertWorkingWeekday } from '@/lib/working-days'
import { DEFAULT_TIMEZONE } from '@/lib/constants'
import { deleteRecurringQuery, updateRecurringScheduleSchema } from '@/lib/validation/recurring'

export const dynamic = 'force-dynamic'

const scheduleWithParties = Prisma.validator<Prisma.RecurringScheduleDefaultArgs>()({
  include: {
    employee: { select: { id: true, name: true, email: true } },
    reporter: { select: { id: true, name: true, email: true, timeZone: true } },
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
      notify.meetingCancelled({ meetingId: m.id, date: m.meetingDate, recipients: [{ id: m.employeeId }], actorName, email: false }),
    ])
  )
}

/** Best effort: stretch/shrink the Google series and any one-off events of upcoming meetings. */
async function applyDurationToCalendar(schedule: ScheduleWithParties, durationMinutes: number) {
  if (schedule.googleRecurringEventId) {
    await setCalendarEventDuration(schedule.googleRecurringEventId, schedule.reporterId, durationMinutes).catch((e) =>
      console.error('Failed to change recurring series length', e)
    )
  }
  const events = await prisma.calendarEvent.findMany({
    where: { meeting: { recurringScheduleId: schedule.id, status: MeetingStatus.SCHEDULED, meetingDate: { gt: new Date() } } },
    select: { googleEventId: true },
  })
  await Promise.all(
    events.map((e) =>
      setCalendarEventDuration(e.googleEventId, schedule.reporterId, durationMinutes).catch((err) => console.error('Failed to change event length', err))
    )
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
 * A day/time/frequency change moves upcoming meetings onto the new pattern, ends the old Google series
 * and starts a new one (lib/recurring-edit.ts); 409 when the first new occurrence is taken.
 */
export const PATCH = withApiAuth(async (req: NextRequest, { user, params }) => {
  const body = await parseBody(req, updateRecurringScheduleSchema)
  const { frequency, dayOfWeek, timeOfDay, durationMinutes, isActive, cancelFutureMeetings, meetingType, meetingLink } = body

  const existing = await loadSchedule(params.id, user)
  // Moving to another day must land on a working day (an existing schedule on its old day stays editable)
  if (dayOfWeek !== undefined && dayOfWeek !== existing.dayOfWeek) assertWorkingWeekday(dayOfWeek, (await getPolicies()).workingDays)
  const actorName = user.name || 'Your manager'

  const cancelling = isActive === false && cancelFutureMeetings === true
  const futureMeetings = cancelling ? await findFutureScheduledMeetings(existing.id) : []

  const scheduleChanged =
    (frequency !== undefined && frequency !== existing.frequency) ||
    (dayOfWeek !== undefined && dayOfWeek !== existing.dayOfWeek) ||
    (timeOfDay !== undefined && timeOfDay !== existing.timeOfDay)

  const durationChanged = durationMinutes !== undefined && durationMinutes !== existing.durationMinutes && !cancelling
  const newDay = dayOfWeek ?? existing.dayOfWeek
  const newTime = timeOfDay ?? existing.timeOfDay
  const newFreq = frequency ?? existing.frequency
  const reporterTz = existing.reporter.timeZone || DEFAULT_TIMEZONE
  const newDuration = durationMinutes ?? existing.durationMinutes
  const newPattern = { dayOfWeek: newDay, timeOfDay: newTime, frequency: newFreq }
  // Plan + conflict check before anything is written
  const move = scheduleChanged && !cancelling && existing.isActive ? await prepareSeriesMove(existing, newPattern, newDuration, reporterTz) : null
  const newNextDate = move?.plan.nextMeetingDate

  const updateData: Prisma.RecurringScheduleUpdateInput = {
    ...(frequency !== undefined && { frequency }),
    ...(dayOfWeek !== undefined && { dayOfWeek }),
    ...(timeOfDay !== undefined && { timeOfDay }),
    ...(durationMinutes !== undefined && { durationMinutes }),
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
    if (durationChanged) {
      // Upcoming meetings of the series take the new length (past ones keep theirs)
      await tx.meeting.updateMany({
        where: { recurringScheduleId: existing.id, status: { in: [MeetingStatus.PROPOSED, MeetingStatus.SCHEDULED] }, meetingDate: { gt: new Date() } },
        data: { durationMinutes },
      })
    }
    if (move) {
      // Each upcoming meeting onto its own new date; reminders are due again for the new time
      for (const mv of move.plan.moves) {
        await tx.meeting.update({
          where: { id: mv.id },
          data: { meetingDate: mv.to, reminder24hSent: false, reminderSent: false, formReminderSent: false },
        })
      }
    }
    return tx.recurringSchedule.update({ where: { id: existing.id }, data: updateData })
  })

  await createAuditLog({
    userId: user.id,
    action: 'UPDATE',
    entityType: 'RecurringSchedule',
    entityId: existing.id,
    details: {
      changes: body,
      employeeName: existing.employee.name,
      cancelledMeetingCount: futureMeetings.length,
      ...(move && { movedMeetingCount: move.plan.moves.length, keptRescheduledCount: move.plan.kept.length }),
    },
  })

  // ---- Side effects (best effort) ----
  if (cancelling) await afterFutureMeetingsCancelled(existing, futureMeetings, actorName)

  if (move) await applySeriesMoveToCalendar(existing, newPattern, newDuration, reporterTz, move.plan, move.upcoming)
  else if (durationChanged) await applyDurationToCalendar(existing, durationMinutes!)

  if ((scheduleChanged || durationChanged) && !cancelling) {
    await notify.recurringScheduleUpdated({
      scheduleId: existing.id,
      employee: existing.employee,
      actorName,
      dayOfWeek: newDay,
      timeOfDay: newTime,
      frequency: newFreq,
      reporterTimeZone: reporterTz,
      durationMinutes: newDuration,
    })
  }

  return NextResponse.json({ ...schedule, cancelledMeetingCount: futureMeetings.length, movedMeetingCount: move?.plan.moves.length ?? 0 })
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
