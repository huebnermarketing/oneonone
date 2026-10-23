import { NextRequest, NextResponse } from 'next/server'
import { MeetingStatus } from '@prisma/client'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { notFound, parseQuery, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { assertAccess, canViewMeeting } from '@/lib/meeting-access'
import { getMutualFreeSlots, isCalendarEnabled } from '@/lib/google-calendar'
import { DEFAULT_WORK_END, DEFAULT_WORK_START, formatWorkHoursLabel } from '@/lib/timezones'
import { DEFAULT_TIMEZONE, MEETING_DURATION_MINUTES } from '@/lib/constants'
import { availabilityDateQuery } from '@/lib/validation/meetings'

export const dynamic = 'force-dynamic'

const SLOT_MS = MEETING_DURATION_MINUTES * 60 * 1000

/**
 * GET /api/meetings/[id]/availability?date=YYYY-MM-DD
 * Mutual free slots for the meeting's reporter & employee on the given date.
 * Any participant (employee or reporter) or an admin can call this, so "Suggest New Time" works for everyone.
 */
export const GET = withApiAuth(async (req: NextRequest, { user, params }) => {
  const { date } = parseQuery(req, availabilityDateQuery)

  const meeting = await prisma.meeting.findUnique({
    where: { id: params.id },
    select: { id: true, employeeId: true, reporterId: true },
  })
  if (!meeting) throw notFound('Meeting')
  assertAccess(canViewMeeting(user, meeting))

  const parsedDate = new Date(date)

  const [reporterConnected, employeeConnected] = await Promise.all([
    isCalendarEnabled(meeting.reporterId),
    isCalendarEnabled(meeting.employeeId),
  ])
  if (!reporterConnected || !employeeConnected) {
    return NextResponse.json({
      slots: [],
      calendarUnavailable: true,
      workingHoursLabel: null,
      message: !reporterConnected
        ? "Reporter's Google Calendar is not connected."
        : "Employee's Google Calendar is not connected.",
    })
  }

  const profileSelect = { timeZone: true, workDayStart: true, workDayEnd: true } as const
  const [reporter, employee] = await Promise.all([
    prisma.user.findUnique({ where: { id: meeting.reporterId }, select: profileSelect }),
    prisma.user.findUnique({ where: { id: meeting.employeeId }, select: profileSelect }),
  ])

  const reporterTz = reporter?.timeZone ?? DEFAULT_TIMEZONE
  const reporterStart = reporter?.workDayStart ?? DEFAULT_WORK_START
  const reporterEnd = reporter?.workDayEnd ?? DEFAULT_WORK_END
  const employeeTz = employee?.timeZone ?? DEFAULT_TIMEZONE
  const employeeStart = employee?.workDayStart ?? DEFAULT_WORK_START
  const employeeEnd = employee?.workDayEnd ?? DEFAULT_WORK_END

  const calendarSlots = await getMutualFreeSlots(meeting.reporterId, meeting.employeeId, parsedDate, MEETING_DURATION_MINUTES, {
    reporterTimeZone: reporterTz,
    reporterWorkStart: reporterStart,
    reporterWorkEnd: reporterEnd,
    employeeTimeZone: employeeTz,
    employeeWorkStart: employeeStart,
    employeeWorkEnd: employeeEnd,
  })

  // Exclude slots that overlap existing DB meetings. Day boundaries are in the reporter's timezone
  // so "Monday" means Monday where the reporter is, not UTC midnight-to-midnight.
  const zoned = toZonedTime(parsedDate, reporterTz)
  const yy = zoned.getFullYear(), mm = zoned.getMonth(), dd = zoned.getDate()
  const dayStart = fromZonedTime(new Date(yy, mm, dd, 0, 0, 0, 0), reporterTz)
  const dayEnd = fromZonedTime(new Date(yy, mm, dd + 1, 0, 0, 0, 0), reporterTz)

  const existingMeetings = await prisma.meeting.findMany({
    where: {
      status: { in: [MeetingStatus.PROPOSED, MeetingStatus.SCHEDULED] },
      meetingDate: { gte: dayStart, lt: dayEnd },
      OR: [
        { employeeId: meeting.employeeId },
        { reporterId: meeting.reporterId },
        { employeeId: meeting.reporterId },
        { reporterId: meeting.employeeId },
      ],
    },
    select: { meetingDate: true },
  })

  const busyRanges = existingMeetings.map((m) => {
    const start = m.meetingDate.getTime()
    return { start, end: start + SLOT_MS }
  })
  const slots = calendarSlots.filter((slot) => {
    const slotStart = new Date(slot.start).getTime()
    const slotEnd = new Date(slot.end).getTime()
    return !busyRanges.some((busy) => slotStart < busy.end && slotEnd > busy.start)
  })

  const workingHoursLabel =
    reporterTz !== employeeTz || reporterStart !== employeeStart || reporterEnd !== employeeEnd
      ? formatWorkHoursLabel({ start: reporterStart, end: reporterEnd }, reporterTz, { start: employeeStart, end: employeeEnd }, employeeTz)
      : `Free on both calendars (${reporterStart} – ${reporterEnd})`

  return NextResponse.json({ slots, calendarUnavailable: false, workingHoursLabel })
})
