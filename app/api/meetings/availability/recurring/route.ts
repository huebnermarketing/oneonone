import { NextRequest, NextResponse } from 'next/server'
import { REPORTER_OR_ADMIN, forbidden, notFound, parseQuery, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { canActOnUser } from '@/lib/team'
import { CalendarUnavailableError, isCalendarEnabled } from '@/lib/google-calendar'
import { MAX_OCCURRENCES_TO_CHECK, firstFreeOccurrence, pairProfiles } from '@/lib/availability'
import { getNextOccurrenceDates } from '@/lib/recurring-dates'
import { formatMeetingLong } from '@/lib/dates'
import { recurringAvailabilityQuery } from '@/lib/validation/meetings'

export const dynamic = 'force-dynamic'

/**
 * GET /api/meetings/availability/recurring?employeeId=&dayOfWeek=&timeOfDay=&frequency=
 * Whether the first of the next few occurrences of this recurring slot is free for both reporter and employee.
 * REPORTER may only query themselves or a direct report; ADMIN anyone.
 */
export const GET = withApiAuth(REPORTER_OR_ADMIN, async (req: NextRequest, { user }) => {
  const { employeeId, dayOfWeek, timeOfDay, frequency } = parseQuery(req, recurringAvailabilityQuery)

  if (!(await canActOnUser(user, employeeId))) {
    throw forbidden('You can only view availability for your own direct reports')
  }

  const profileSelect = { timeZone: true, workDayStart: true, workDayEnd: true } as const
  const [reporter, employee] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: profileSelect }),
    prisma.user.findUnique({ where: { id: employeeId }, select: profileSelect }),
  ])
  if (!employee) throw notFound('Employee')

  const [reporterConnected, employeeConnected] = await Promise.all([
    isCalendarEnabled(user.id),
    isCalendarEnabled(employeeId),
  ])
  const unavailable = (message: string) =>
    NextResponse.json({
      available: null,
      firstDate: null,
      calendarUnavailable: true,
      yourCalendarConnected: reporterConnected,
      employeeCalendarConnected: employeeConnected,
      message,
    })
  // One connected calendar is enough: it reads the other person's free/busy
  if (!reporterConnected && !employeeConnected) {
    return unavailable('Your Google Calendar is not connected. Connect it to see mutual availability.')
  }

  const profiles = pairProfiles(reporter, employee)
  const reporterTz = profiles.reporter.timeZone

  // Use the first free occurrence among the next few
  const upcomingDates = getNextOccurrenceDates(dayOfWeek, timeOfDay, frequency, reporterTz, MAX_OCCURRENCES_TO_CHECK)
  let firstFreeDate: Date | null
  try {
    firstFreeDate = await firstFreeOccurrence(user.id, employeeId, upcomingDates, profiles)
  } catch (err) {
    if (!(err instanceof CalendarUnavailableError)) throw err
    return unavailable("Can't see the employee's calendar. You can still create the schedule.")
  }
  const firstDate = firstFreeDate ?? upcomingDates[0]!
  const available = firstFreeDate !== null

  const formatted = formatMeetingLong(firstDate, reporterTz)

  return NextResponse.json({
    available,
    firstDate: firstDate.toISOString(),
    firstDateFormatted: formatted,
    calendarUnavailable: false,
    yourCalendarConnected: true,
    employeeCalendarConnected: true,
    message: available
      ? `This time is free for both of you. First meeting: ${formatted}`
      : `Each of the next ${MAX_OCCURRENCES_TO_CHECK} occurrences has a conflict. Choose another time or create anyway.`,
  })
})
