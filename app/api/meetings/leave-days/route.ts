import { NextRequest, NextResponse } from 'next/server'
import { UserRole } from '@prisma/client'
import { forbidden, notFound, parseQuery, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { canActOnUser } from '@/lib/team'
import { assertAccess, canViewMeeting } from '@/lib/meeting-access'
import { absenceLabel, pairAbsenceDays } from '@/lib/absences'
import { leaveDaysQuery } from '@/lib/validation/meetings'

export const dynamic = 'force-dynamic'

/**
 * GET /api/meetings/leave-days?employeeId=|meetingId=&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Days in the range where either person is away per Keka, for the scheduling date pickers:
 * `blocked` = whole day on approved leave / holiday (greyed out), otherwise a hint (half-day, pending).
 * employeeId: the caller + that person (reporter/admin, own reports only); meetingId: that meeting's two people.
 */
export const GET = withApiAuth(async (req: NextRequest, { user }) => {
  const { employeeId, meetingId, from, to } = parseQuery(req, leaveDaysQuery)

  let reporterId: string
  let otherId: string
  if (meetingId) {
    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { id: true, employeeId: true, reporterId: true } })
    if (!meeting) throw notFound('Meeting')
    assertAccess(canViewMeeting(user, meeting))
    reporterId = meeting.reporterId
    otherId = meeting.employeeId
  } else {
    if (user.role === UserRole.EMPLOYEE) throw forbidden()
    if (!(await canActOnUser(user, employeeId!))) throw forbidden('You can only view leave for your own direct reports')
    reporterId = user.id
    otherId = employeeId!
  }

  const people = await prisma.user.findMany({ where: { id: { in: [reporterId, otherId] } }, select: { id: true, name: true } })
  const nameOf = (side: 'reporter' | 'employee') => {
    const id = side === 'reporter' ? reporterId : otherId
    return id === user.id ? 'You' : people.find((p) => p.id === id)?.name ?? 'Other participant'
  }

  const days = (await pairAbsenceDays(reporterId, otherId, from, to)).map((d) => {
    const parts = [
      ...(d.fullDay ? [d.fullDay] : []),
      ...d.partial,
    ].map((p) => `${nameOf(p.who)}: ${absenceLabel(p.absence).toLowerCase()}${p.absence.half ? ` (${p.absence.half === 'FIRST' ? 'first' : 'second'} half)` : ''}`)
    return { date: d.date, blocked: !!d.fullDay, hint: [...new Set(parts)].join(', ') }
  })
  return NextResponse.json({ days })
})
