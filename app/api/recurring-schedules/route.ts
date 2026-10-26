import { NextRequest, NextResponse } from 'next/server'
import { UserRole } from '@prisma/client'
import { REPORTER_OR_ADMIN, badRequest, conflict, notFound, withApiAuth, parseBody } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit'
import { formatMeetingLong } from '@/lib/dates'
import { advanceToNextOccurrence, getNextOccurrenceDates } from '@/lib/recurring-dates'
import { MAX_OCCURRENCES_TO_CHECK, calendarsConnected, firstFreeOccurrence, pairProfiles, type PairProfiles } from '@/lib/availability'
import * as notify from '@/lib/notify'
import { createRecurringScheduleSchema } from '@/lib/validation/recurring'

export const dynamic = 'force-dynamic'

/** When creating a schedule, check this many future occurrences; a one-off holiday/leave shouldn't block the slot. */
const partySelect = { select: { id: true, name: true, email: true } } as const

/**
 * GET /api/recurring-schedules — active schedules. REPORTER: own; ADMIN: all (with reporter).
 */
export const GET = withApiAuth(REPORTER_OR_ADMIN, async (_req: NextRequest, { user }) => {
  const schedules = await prisma.recurringSchedule.findMany({
    where: { isActive: true, ...(user.role === UserRole.SUPER_ADMIN ? {} : { reporterId: user.id }) },
    include: {
      employee: partySelect,
      reporter: partySelect,
      _count: { select: { meetings: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(schedules)
})

/**
 * Among the next few occurrences, pick the first that is free on both Google Calendars and not a Keka
 * holiday/leave day. Falls back to the first occurrence when either calendar is not connected or the
 * check itself fails; throws 409 when every candidate is busy.
 */
async function pickFirstMeetingDate(reporterId: string, employeeId: string, profiles: PairProfiles, upcomingDates: Date[]): Promise<Date> {
  try {
    if (!(await calendarsConnected(reporterId, employeeId)).both) return upcomingDates[0]!
    const free = await firstFreeOccurrence(reporterId, employeeId, upcomingDates, profiles)
    if (free) return free
  } catch (err) {
    console.error('Recurring schedule calendar check:', err)
    return upcomingDates[0]!
  }
  const formatted = formatMeetingLong(upcomingDates[0]!, profiles.reporter.timeZone)
  throw conflict(
    `Each of the next ${MAX_OCCURRENCES_TO_CHECK} occurrences has a calendar conflict (e.g. first: ${formatted}). Please choose a different day or time.`
  )
}

/**
 * POST /api/recurring-schedules — create a schedule for the caller and propose its first meeting.
 * Schedule create + first meeting + nextMeetingDate advance are atomic.
 */
export const POST = withApiAuth(REPORTER_OR_ADMIN, async (req: NextRequest, { user }) => {
  const { employeeId, frequency, dayOfWeek, timeOfDay, meetingType, meetingLink } = await parseBody(req, createRecurringScheduleSchema)

  const profileSelect = { name: true, email: true, timeZone: true, workDayStart: true, workDayEnd: true } as const
  const [reporterProfile, employee] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: profileSelect }),
    prisma.user.findUnique({ where: { id: employeeId }, select: profileSelect }),
  ])
  if (!employee) throw notFound('Employee')

  // One active schedule per employee per reporter; no double-booking of the slot on either side
  const [existingForEmployee, reporterBusy, employeeBusy] = await Promise.all([
    prisma.recurringSchedule.findFirst({ where: { reporterId: user.id, employeeId, isActive: true }, select: { id: true } }),
    prisma.recurringSchedule.findFirst({
      where: { reporterId: user.id, dayOfWeek, timeOfDay, isActive: true },
      select: { employee: { select: { name: true } } },
    }),
    prisma.recurringSchedule.findFirst({ where: { employeeId, dayOfWeek, timeOfDay, isActive: true }, select: { id: true } }),
  ])
  if (existingForEmployee) throw badRequest('A recurring schedule already exists for this employee')
  if (reporterBusy) {
    throw badRequest(
      `You already have a recurring schedule at this day and time with ${reporterBusy.employee?.name || 'another employee'}. Please choose a different time.`
    )
  }
  if (employeeBusy) {
    throw badRequest(`${employee.name || 'This employee'} already has a recurring schedule at this day and time. Please choose a different time.`)
  }

  const profiles = pairProfiles(reporterProfile, employee)
  const reporterTz = profiles.reporter.timeZone
  const upcomingDates = getNextOccurrenceDates(dayOfWeek, timeOfDay, frequency, reporterTz, MAX_OCCURRENCES_TO_CHECK)
  const firstMeetingDate = await pickFirstMeetingDate(user.id, employeeId, profiles, upcomingDates)
  const link = meetingType === 'ZOOM' ? meetingLink ?? null : null

  const { schedule, meeting } = await prisma.$transaction(async (tx) => {
    const created = await tx.recurringSchedule.create({
      data: {
        reporterId: user.id,
        employeeId,
        frequency,
        dayOfWeek,
        timeOfDay,
        nextMeetingDate: firstMeetingDate,
        meetingType,
        meetingLink: link,
      },
    })

    // First meeting is PROPOSED (needs the employee's acceptance)
    const first = await tx.meeting.create({
      data: {
        employeeId,
        reporterId: user.id,
        meetingDate: firstMeetingDate,
        recurringScheduleId: created.id,
        status: 'PROPOSED',
        proposedById: user.id,
        meetingType: created.meetingType,
        meetingLink: created.meetingLink,
      },
    })

    // Advance nextMeetingDate so the cron doesn't duplicate the first meeting
    const updated = await tx.recurringSchedule.update({
      where: { id: created.id },
      data: { nextMeetingDate: advanceToNextOccurrence(dayOfWeek, timeOfDay, frequency, firstMeetingDate, reporterTz) },
    })

    return { schedule: updated, meeting: first }
  })

  await createAuditLog({
    userId: user.id,
    action: 'CREATE',
    entityType: 'RecurringSchedule',
    entityId: schedule.id,
    details: { employeeId, employeeName: employee.name, frequency: schedule.frequency, dayOfWeek, timeOfDay },
  })

  await notify.meetingProposed({ meetingId: meeting.id, date: firstMeetingDate, employee: { id: employeeId, email: employee.email, name: employee.name }, reporter: { email: user.email, name: user.name } })

  return NextResponse.json({ schedule, meeting }, { status: 201 })
})
