import { NextRequest, NextResponse } from 'next/server'
import { REPORTER_OR_ADMIN, forbidden, notFound, parseQuery, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { canActOnUser } from '@/lib/team'
import { isCalendarEnabled } from '@/lib/google-calendar'
import { isDateUnavailableForEitherUser } from '@/lib/keka'
import { freeSlotsForDay, pairProfiles, workingHoursLabel } from '@/lib/availability'
import { availabilityQuery } from '@/lib/validation/meetings'

export const dynamic = 'force-dynamic'

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

  const profiles = pairProfiles(reporter, employee)
  const slots = await freeSlotsForDay(user.id, employeeId, parsedDate, profiles)

  return NextResponse.json({
    slots,
    calendarUnavailable: false,
    workingHoursLabel: workingHoursLabel(profiles),
    reporterTimeZone: profiles.reporter.timeZone,
  })
})
