import { NextRequest, NextResponse } from 'next/server'
import { MeetingStatus } from '@prisma/client'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { REPORTER_OR_ADMIN, forbidden, notFound, parseQuery, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { canActOnUser } from '@/lib/team'
import { getMutualFreeSlots, isCalendarEnabled } from '@/lib/google-calendar'
import { isDateUnavailableForEitherUser } from '@/lib/keka'
import { DEFAULT_WORK_END, DEFAULT_WORK_START, formatWorkHoursLabel } from '@/lib/timezones'
import { DEFAULT_TIMEZONE, MEETING_DURATION_MINUTES } from '@/lib/constants'
import { availabilityQuery } from '@/lib/validation/meetings'

export const dynamic = 'force-dynamic'

const SLOT_MS = MEETING_DURATION_MINUTES * 60 * 1000

/**
 * GET /api/meetings/availability?employeeId=&date=YYYY-MM-DD
 * Without `date`: calendar connection status for both parties.
 * With `date`: mutual free slots (Google Calendar minus Keka leave/holidays minus existing DB meetings).
 * REPORTER may only query themselves or a direct report; ADMIN anyone.
 */
export const GET = withApiAuth(REPORTER_OR_ADMIN, async (req: NextRequest, { user }) => {
  const { employeeId, date } = parseQuery(req, availabilityQuery)

  if (!(await canActOnUser(user, employeeId))) {
    throw forbidden('You can only view availability for your own direct reports')
  }

  const profileSelect = { name: true, timeZone: true, workDayStart: true, workDayEnd: true } as const
  const [reporter, employee] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: profileSelect }),
    prisma.user.findUnique({ where: { id: employeeId }, select: profileSelect }),
  ])
  if (!employee) throw notFound('Employee')

  const [yourCalendarConnected, employeeCalendarConnected] = await Promise.all([
    isCalendarEnabled(user.id),
    isCalendarEnabled(employeeId),
  ])

  // Calendar status only (no date): when picking an employee, say whether their calendar is connected
  if (!date) {
    return NextResponse.json({
      yourCalendarConnected,
      employeeCalendarConnected,
      employeeName: employee.name ?? null,
      message: !yourCalendarConnected
        ? 'Your Google Calendar is not connected. Sign out and sign in again with Google to see mutual availability.'
        : !employeeCalendarConnected
          ? `${employee.name ?? 'This person'}'s Google Calendar is not connected. You can still propose a time; they can accept or suggest another.`
          : 'Both calendars connected. Pick a date to see free slots.',
    })
  }

  const parsedDate = new Date(date)

  if (await isDateUnavailableForEitherUser(user.id, employeeId, parsedDate)) {
    return NextResponse.json({
      slots: [],
      dateUnavailable: true,
      workingHoursLabel: null,
      message: 'This date is a public holiday or one of you is on leave (from Keka). Pick another day.',
    })
  }

  if (!yourCalendarConnected || !employeeCalendarConnected) {
    return NextResponse.json({
      slots: [],
      calendarUnavailable: true,
      workingHoursLabel: null,
      message: !yourCalendarConnected
        ? 'Your Google Calendar is not connected. Please sign out and sign in again to grant calendar access.'
        : 'The selected employee has not connected their Google Calendar.',
    })
  }

  const reporterTz = reporter?.timeZone ?? DEFAULT_TIMEZONE
  const reporterStart = reporter?.workDayStart ?? DEFAULT_WORK_START
  const reporterEnd = reporter?.workDayEnd ?? DEFAULT_WORK_END
  const employeeTz = employee.timeZone ?? DEFAULT_TIMEZONE
  const employeeStart = employee.workDayStart ?? DEFAULT_WORK_START
  const employeeEnd = employee.workDayEnd ?? DEFAULT_WORK_END

  const calendarSlots = await getMutualFreeSlots(user.id, employeeId, parsedDate, MEETING_DURATION_MINUTES, {
    reporterTimeZone: reporterTz,
    reporterWorkStart: reporterStart,
    reporterWorkEnd: reporterEnd,
    employeeTimeZone: employeeTz,
    employeeWorkStart: employeeStart,
    employeeWorkEnd: employeeEnd,
  })

  // Filter out slots that conflict with existing DB meetings (PROPOSED / SCHEDULED), using
  // day boundaries in the reporter's timezone rather than UTC midnight-to-midnight.
  const zoned = toZonedTime(parsedDate, reporterTz)
  const y = zoned.getFullYear(), mo = zoned.getMonth(), d = zoned.getDate()
  const dayStart = fromZonedTime(new Date(y, mo, d, 0, 0, 0, 0), reporterTz)
  const dayEnd = fromZonedTime(new Date(y, mo, d + 1, 0, 0, 0, 0), reporterTz)

  const existingMeetings = await prisma.meeting.findMany({
    where: {
      status: { in: [MeetingStatus.PROPOSED, MeetingStatus.SCHEDULED] },
      meetingDate: { gte: dayStart, lt: dayEnd },
      OR: [{ employeeId }, { reporterId: user.id }, { employeeId: user.id }, { reporterId: employeeId }],
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
      : `Free on both calendars (${reporterStart} – ${reporterEnd} your time)`

  return NextResponse.json({
    slots,
    calendarUnavailable: false,
    workingHoursLabel,
    reporterTimeZone: reporterTz,
  })
})
