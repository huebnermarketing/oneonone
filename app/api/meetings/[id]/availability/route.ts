import { NextRequest, NextResponse } from 'next/server'
import { getPolicies } from '@/lib/settings'
import { resolveTimeZone } from '@/lib/dates'
import { WEEKDAY_SHORT, describeWorkingDays, isWorkingWeekday, weekdayIn, weekdayOfKey } from '@/lib/working-days'
import { notFound, parseQuery, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { assertAccess, canViewMeeting } from '@/lib/meeting-access'
import { CalendarUnavailableError } from '@/lib/google-calendar'
import { calendarsConnected, freeSlotsForDay, loadPairProfiles, workingHoursLabel } from '@/lib/availability'
import { availabilityDateQuery } from '@/lib/validation/meetings'

export const dynamic = 'force-dynamic'

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

  const unavailable = (message: string) => NextResponse.json({ slots: [], calendarUnavailable: true, workingHoursLabel: null, message })
  // One connected calendar is enough: it reads the other person's free/busy
  const connected = await calendarsConnected(meeting.reporterId, meeting.employeeId)
  if (!connected.either) return unavailable('Neither Google Calendar is connected.')

  const profiles = await loadPairProfiles(meeting.reporterId, meeting.employeeId)
  let slots
  try {
    slots = await freeSlotsForDay(meeting.reporterId, meeting.employeeId, parsedDate, profiles)
  } catch (err) {
    if (!(err instanceof CalendarUnavailableError)) throw err
    return unavailable("Can't see the other person's calendar. They need to sign in to One-on-One once with Google.")
  }

  // The caller may be either participant, so no "your time" suffix
  return NextResponse.json({ slots, calendarUnavailable: false, workingHoursLabel: workingHoursLabel(profiles, false) })
})
