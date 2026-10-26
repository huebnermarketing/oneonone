import { NextRequest, NextResponse } from 'next/server'
import { notFound, parseQuery, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { assertAccess, canViewMeeting } from '@/lib/meeting-access'
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

  const parsedDate = new Date(date)

  const connected = await calendarsConnected(meeting.reporterId, meeting.employeeId)
  if (!connected.both) {
    return NextResponse.json({
      slots: [],
      calendarUnavailable: true,
      workingHoursLabel: null,
      message: !connected.reporter
        ? "Reporter's Google Calendar is not connected."
        : "Employee's Google Calendar is not connected.",
    })
  }

  const profiles = await loadPairProfiles(meeting.reporterId, meeting.employeeId)
  const slots = await freeSlotsForDay(meeting.reporterId, meeting.employeeId, parsedDate, profiles)

  // The caller may be either participant, so no "your time" suffix
  return NextResponse.json({ slots, calendarUnavailable: false, workingHoursLabel: workingHoursLabel(profiles, false) })
})
