import { NextRequest, NextResponse } from 'next/server'
import { getPolicies } from '@/lib/settings'
import { resolveTimeZone } from '@/lib/dates'
import { WEEKDAY_SHORT, describeWorkingDays, isWorkingWeekday, weekdayIn, weekdayOfKey } from '@/lib/working-days'
import { REPORTER_OR_ADMIN, forbidden, notFound, parseQuery, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { canActOnUser } from '@/lib/team'
import { CalendarUnavailableError, isCalendarEnabled } from '@/lib/google-calendar'
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
  const { employeeId, date, duration } = parseQuery(req, availabilityQuery)

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

  // One connected calendar is enough: it reads the other person's free/busy (lib/google-calendar.getPairBusy)
  const availabilityReady = yourCalendarConnected || employeeCalendarConnected
  const who = employee.name ?? 'this person'

  // Calendar status only (no date): when picking an employee
  if (!date) {
    return NextResponse.json({
      yourCalendarConnected,
      employeeCalendarConnected,
      availabilityReady,
      employeeName: employee.name ?? null,
      message: yourCalendarConnected
        ? `Pick a date to see times free on both your and ${who}'s calendars.`
        : employeeCalendarConnected
          ? `Using ${who}'s calendar to check both of you. Sign out and back in with Google to connect yours.`
          : 'Your Google Calendar is not connected. Sign out and sign in again with Google to see mutual availability.',
    })
  }

  // Non-working day (Admin → Settings → Policies): no slots, same shape as a holiday
  {
    const { workingDays } = await getPolicies()
    const wd = /^\d{4}-\d{2}-\d{2}$/.test(date) ? weekdayOfKey(date) : weekdayIn(new Date(date), resolveTimeZone(user.timeZone))
    if (!isWorkingWeekday(wd, workingDays)) {
      return NextResponse.json({
        slots: [],
        dateUnavailable: true,
        workingHoursLabel: null,
        message: `${WEEKDAY_SHORT[wd]} is not a working day (${describeWorkingDays(workingDays)}). Pick another day.`,
      })
    }
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

  const unavailable = (message: string) => NextResponse.json({ slots: [], calendarUnavailable: true, workingHoursLabel: null, message })
  if (!availabilityReady) {
    return unavailable('Your Google Calendar is not connected. Please sign out and sign in again to grant calendar access.')
  }

  const profiles = pairProfiles(reporter, employee)
  let slots
  try {
    slots = await freeSlotsForDay(user.id, employeeId, parsedDate, profiles, duration)
  } catch (err) {
    if (!(err instanceof CalendarUnavailableError)) throw err
    return unavailable(`Can't see ${who}'s calendar. Ask them to sign in to One-on-One once with Google, or propose a time below.`)
  }

  return NextResponse.json({
    slots,
    calendarUnavailable: false,
    workingHoursLabel: workingHoursLabel(profiles),
    reporterTimeZone: profiles.reporter.timeZone,
  })
})
