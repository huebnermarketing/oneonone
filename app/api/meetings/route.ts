import { NextRequest, NextResponse } from 'next/server'
import { Prisma, UserRole } from '@prisma/client'
import { REPORTER_OR_ADMIN, badRequest, notFound, parseBody, parseQuery, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { logMeetingCreated } from '@/lib/audit'
import { parseZoomMeetingId } from '@/lib/zoom'
import { assertNoConflict } from '@/lib/meeting-conflicts'
import * as notify from '@/lib/notify'
import { createMeetingSchema, listMeetingsQuery } from '@/lib/validation/meetings'
import { getPolicies } from '@/lib/settings'
import { resolveTimeZone } from '@/lib/dates'
import { assertWorkingDay } from '@/lib/working-days'

export const dynamic = 'force-dynamic'

const meetingInclude = {
  employee: { select: { id: true, name: true, email: true } },
  reporter: { select: { id: true, name: true, email: true } },
} as const

/**
 * GET /api/meetings?start=&end=
 * EMPLOYEE: meetings where I am the employee. REPORTER: where I am employee or reporter. ADMIN: all.
 */
export const GET = withApiAuth(async (req: NextRequest, { user }) => {
  const { start, end } = parseQuery(req, listMeetingsQuery)

  const where: Prisma.MeetingWhereInput = {}
  if (start || end) {
    where.meetingDate = {}
    if (start) where.meetingDate.gte = start
    if (end) where.meetingDate.lte = end
  }
  if (user.role === UserRole.EMPLOYEE) {
    where.employeeId = user.id
  } else if (user.role === UserRole.REPORTER) {
    where.OR = [{ employeeId: user.id }, { reporterId: user.id }]
  }

  const meetings = await prisma.meeting.findMany({
    where,
    include: meetingInclude,
    orderBy: { meetingDate: 'desc' },
  })
  return NextResponse.json(meetings)
})

/**
 * POST /api/meetings — propose a 1:1. Reporter or admin. Whoever schedules it is the meeting owner
 * (reporter): an admin scheduling with someone is having that 1:1 themselves, not booking it for the
 * employee's manager.
 */
export const POST = withApiAuth(REPORTER_OR_ADMIN, async (req: NextRequest, { user }) => {
  const { employeeId, meetingDate, durationMinutes, meetingType, meetingLink } = await parseBody(req, createMeetingSchema)

  const employee = await prisma.user.findUnique({ where: { id: employeeId }, select: { id: true } })
  if (!employee) throw notFound('Employee')
  if (employeeId === user.id) throw badRequest("You can't schedule a 1:1 with yourself")

  const reporterId = user.id
  assertWorkingDay(meetingDate, resolveTimeZone(user.timeZone), (await getPolicies()).workingDays)

  await assertNoConflict(employeeId, reporterId, meetingDate, { durationMinutes })

  const link = meetingType === 'ZOOM' ? meetingLink ?? null : null
  const meeting = await prisma.meeting.create({
    data: {
      employeeId,
      reporterId,
      meetingDate,
      durationMinutes,
      status: 'PROPOSED',
      proposedById: user.id,
      meetingType,
      meetingLink: link,
      zoomMeetingId: link ? parseZoomMeetingId(link) : null,
    },
    include: meetingInclude,
  })

  await logMeetingCreated(user.id, meeting.id, {
    employeeId,
    employeeName: meeting.employee.name,
    reporterName: meeting.reporter.name,
    meetingDate: meetingDate.toISOString(),
    durationMinutes,
  })

  // No calendar event at proposal stage — created when accepted. Notifications are best effort.
  await notify.meetingProposed({
    meetingId: meeting.id,
    date: meetingDate,
    employee: meeting.employee,
    reporter: meeting.reporter,
    confirmToReporter: true,
    durationMinutes,
  })

  return NextResponse.json(meeting, { status: 201 })
})
