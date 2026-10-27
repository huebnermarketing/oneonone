import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import * as notify from '@/lib/notify'
import { createCalendarEvent, isCalendarEnabled } from '@/lib/google-calendar'
import { advanceToNextOccurrence } from '@/lib/recurring-dates'
import { getPolicies } from '@/lib/settings'
import { checkRateLimit } from '@/lib/rate-limit'
import { DEFAULT_TIMEZONE } from '@/lib/constants'
import { recoverStaleJobs } from '@/lib/recording-pipeline'
import { kekaSyncDue, runKekaSync } from '@/lib/keka-sync'

export const dynamic = 'force-dynamic'

const FALLBACK_TZ = DEFAULT_TIMEZONE
const LOOK_AHEAD_MS = 7 * 24 * 60 * 60 * 1000 // generate meetings 7 days before they're due

// This endpoint should be called by a cron job (e.g., every hour)
// Set up a cron job to call: POST /api/cron/meetings with header: x-cron-secret: YOUR_SECRET
export async function POST(request: NextRequest) {
  // Verify cron secret — always required (set CRON_SECRET in .env, including locally)
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('CRON_SECRET env var is not set — cron endpoint is disabled')
    return NextResponse.json({ error: 'Cron not configured' }, { status: 503 })
  }
  if (request.headers.get('x-cron-secret') !== expected) {
    const rl = checkRateLimit(request, 'auth')
    if (!rl.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const results = {
      recurringMeetingsCreated: 0,
      reminders24hSent: 0,
      reminders1hSent: 0,
      formRemindersSent: 0,
      recordingJobsResumed: 0,
      recordingJobsFailed: 0,
      kekaSync: null as null | { created: number; updated: number; deactivated: number; failed: number },
      errors: [] as string[],
    }

    // 1. Generate recurring meetings that are due
    await generateRecurringMeetings(results)

    // 2. Send meeting reminders
    await sendMeetingReminders(results)

    // 3. Send form reminders for meetings within 24h where form is not submitted
    await sendFormReminders(results)

    // 4. Resume recording pipeline runs that a restart/crash interrupted
    try {
      const { resumed, failed } = await recoverStaleJobs()
      results.recordingJobsResumed = resumed.length
      results.recordingJobsFailed = failed.length
    } catch (err) {
      results.errors.push(`recording job recovery: ${err instanceof Error ? err.message : String(err)}`)
    }

    // 5. Daily Keka employee sync (only after an admin has run and confirmed the first one)
    try {
      if (await kekaSyncDue()) {
        const { result } = await runKekaSync({ commit: true, actorEmail: '' })
        if (result) results.kekaSync = { created: result.created, updated: result.updated, deactivated: result.deactivated, failed: result.failed }
      }
    } catch (err) {
      results.errors.push(`keka sync: ${err instanceof Error ? err.message : String(err)}`)
    }

    return NextResponse.json({
      success: true,
      ...results,
    })
  } catch (error) {
    console.error('Error in cron job:', error)
    return NextResponse.json({ error: 'Cron job failed' }, { status: 500 })
  }
}

async function generateRecurringMeetings(results: { recurringMeetingsCreated: number; reminders24hSent: number; reminders1hSent: number; errors: string[] }) {
  const now = new Date()
  
  // Find all active recurring schedules that need a new meeting (look ahead 7 days)
  const lookAhead = new Date(now.getTime() + LOOK_AHEAD_MS)
  const schedules = await prisma.recurringSchedule.findMany({
    where: {
      isActive: true,
      // Nobody who has left: offboarding cancels these, this is the safety net
      employee: { isActive: true },
      reporter: { isActive: true },
      nextMeetingDate: {
        lte: lookAhead,
      },
    },
    include: {
      reporter: { select: { id: true, name: true, email: true, timeZone: true } },
      employee: { select: { id: true, name: true, email: true } },
    },
  })

  for (const schedule of schedules) {
    try {
      const meetingDate = schedule.nextMeetingDate || now

      const reporterTz = schedule.reporter?.timeZone || FALLBACK_TZ

      // Guard: skip if a non-cancelled meeting already exists for this schedule at this date
      const existingMeeting = await prisma.meeting.findFirst({
        where: {
          recurringScheduleId: schedule.id,
          meetingDate,
          status: { not: 'CANCELLED' },
        },
      })
      if (existingMeeting) {
        const nextDate = advanceToNextOccurrence(
          schedule.dayOfWeek,
          schedule.timeOfDay,
          schedule.frequency,
          meetingDate,
          reporterTz
        )
        await prisma.recurringSchedule.update({
          where: { id: schedule.id },
          data: { nextMeetingDate: nextDate, lastGeneratedAt: now },
        })
        continue
      }

      // Check if the recurring schedule has been accepted before (any SCHEDULED or COMPLETED meeting)
      const hasAcceptedMeeting = await prisma.meeting.findFirst({
        where: {
          recurringScheduleId: schedule.id,
          status: { in: ['SCHEDULED', 'COMPLETED'] },
        },
        select: { id: true },
      })
      const autoSchedule = !!hasAcceptedMeeting

      // Create the meeting — auto-schedule if the schedule was already accepted
      const meeting = await prisma.meeting.create({
        data: {
          employeeId: schedule.employeeId,
          reporterId: schedule.reporterId,
          meetingDate,
          durationMinutes: schedule.durationMinutes,
          recurringScheduleId: schedule.id,
          status: autoSchedule ? 'SCHEDULED' : 'PROPOSED',
          proposedById: schedule.reporterId,
          meetingType: schedule.meetingType ?? 'IN_PERSON',
          meetingLink: schedule.meetingLink,
        },
      })

      // Advance the schedule's nextMeetingDate
      const nextDate = advanceToNextOccurrence(
        schedule.dayOfWeek,
        schedule.timeOfDay,
        schedule.frequency,
        meetingDate,
        reporterTz
      )
      await prisma.recurringSchedule.update({
        where: { id: schedule.id },
        data: { nextMeetingDate: nextDate, lastGeneratedAt: now },
      })

      if (autoSchedule) {
        // Recurring series: 1-year event is created on accept; only create single event when no series exists
        if (!schedule.googleRecurringEventId) {
          try {
            const calendarEnabled = await isCalendarEnabled(schedule.reporterId)
            if (calendarEnabled) {
              await createCalendarEvent(
                meeting.id,
                schedule.employee.email,
                schedule.reporter.email,
                schedule.reporterId,
                meetingDate,
                schedule.employee.name,
                schedule.reporter.name,
                schedule.durationMinutes
              )
            }
          } catch (calError) {
            console.error('Failed to create calendar event for auto-scheduled recurring meeting:', calError)
          }
        }

        // Next occurrence of an accepted series is confirmed straight away
        await notify.meetingAccepted({
          meetingId: meeting.id,
          date: meetingDate,
          to: { id: schedule.employeeId, email: schedule.employee.email, name: schedule.employee.name },
          acceptorName: schedule.reporter.name,
          acceptorFallback: 'Your manager',
          durationMinutes: schedule.durationMinutes,
        })
      } else {
        // First-time proposal
        await notify.meetingProposed({
          meetingId: meeting.id,
          date: meetingDate,
          employee: { id: schedule.employeeId, email: schedule.employee.email, name: schedule.employee.name },
          reporter: schedule.reporter,
          durationMinutes: schedule.durationMinutes,
        })
      }

      results.recurringMeetingsCreated++
    } catch (error) {
      console.error(`Error creating recurring meeting for schedule ${schedule.id}:`, error)
      results.errors.push(`Failed to create meeting for schedule ${schedule.id}`)
    }
  }
}

async function sendMeetingReminders(results: { recurringMeetingsCreated: number; reminders24hSent: number; reminders1hSent: number; errors: string[] }) {
  const now = new Date()
  // Windows come from Admin -> Settings -> Policies. The DB flags keep their historical names
  // (reminder24hSent = first reminder, reminderSent = short-notice reminder).
  const { enableEmailReminders, reminderHoursBefore, shortReminderHoursBefore } = await getPolicies()
  const in24h = new Date(now.getTime() + reminderHoursBefore * 60 * 60 * 1000)
  const in1h = new Date(now.getTime() + shortReminderHoursBefore * 60 * 60 * 1000)

  // First reminder (email + in-app)
  const meetings24h = await prisma.meeting.findMany({
    where: {
      status: 'SCHEDULED',
      reminder24hSent: false,
      // Nobody who has left: offboarding cancels these, this is the safety net
      employee: { isActive: true },
      reporter: { isActive: true },
      meetingDate: {
        gte: now,
        lte: in24h,
      },
    },
    include: {
      employee: { select: { id: true, name: true, email: true } },
      reporter: { select: { id: true, name: true, email: true } },
    },
  })

  for (const meeting of meetings24h) {
    try {
      const sent = await notify.meetingReminder({
        meetingId: meeting.id,
        date: meeting.meetingDate,
        employee: meeting.employee,
        reporter: meeting.reporter,
        hoursBefore: reminderHoursBefore,
        email: enableEmailReminders,
      })
      if (!sent.ok) results.errors.push(`24h reminder for meeting ${meeting.id}: ${sent.failures.join(', ')} failed`)

      // Mark as sent
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { reminder24hSent: true },
      })

      results.reminders24hSent++
    } catch (error) {
      console.error(`Error sending 24h reminder for meeting ${meeting.id}:`, error)
      results.errors.push(`Failed to send 24h reminder for meeting ${meeting.id}`)
    }
  }

  // Short-notice reminder (in-app only); 0 disables it
  if (shortReminderHoursBefore <= 0) return
  const meetings1h = await prisma.meeting.findMany({
    where: {
      status: 'SCHEDULED',
      reminderSent: false,
      // Nobody who has left: offboarding cancels these, this is the safety net
      employee: { isActive: true },
      reporter: { isActive: true },
      meetingDate: {
        gte: now,
        lte: in1h,
      },
    },
    include: {
      employee: { select: { id: true, name: true, email: true } },
      reporter: { select: { id: true, name: true, email: true } },
    },
  })

  for (const meeting of meetings1h) {
    try {
      const sent = await notify.meetingReminder({
        meetingId: meeting.id,
        date: meeting.meetingDate,
        employee: meeting.employee,
        reporter: meeting.reporter,
        hoursBefore: shortReminderHoursBefore,
        email: false,
      })
      if (!sent.ok) results.errors.push(`1h reminder for meeting ${meeting.id}: ${sent.failures.join(', ')} failed`)

      // Mark as sent
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { reminderSent: true },
      })

      results.reminders1hSent++
    } catch (error) {
      console.error(`Error sending 1h reminder for meeting ${meeting.id}:`, error)
      results.errors.push(`Failed to send 1h reminder for meeting ${meeting.id}`)
    }
  }
}

async function sendFormReminders(results: { formRemindersSent: number; errors: string[] }) {
  const now = new Date()
  const { reminderHoursBefore, enableEmailReminders } = await getPolicies()
  const in24h = new Date(now.getTime() + reminderHoursBefore * 60 * 60 * 1000)

  const meetings = await prisma.meeting.findMany({
    where: {
      status: 'SCHEDULED',
      formSubmittedAt: null,
      // Nobody who has left: offboarding cancels these, this is the safety net
      employee: { isActive: true },
      reporter: { isActive: true },
      formReminderSent: false,
      meetingDate: {
        gte: now,
        lte: in24h,
      },
    },
    include: {
      employee: { select: { id: true, name: true, email: true } },
      reporter: { select: { id: true, name: true, email: true } },
    },
  })

  for (const meeting of meetings) {
    try {
      const sent = await notify.formReminder({
        meetingId: meeting.id,
        date: meeting.meetingDate,
        employee: meeting.employee,
        reporterName: meeting.reporter.name,
        email: enableEmailReminders,
      })
      if (!sent.ok) results.errors.push(`Form reminder for meeting ${meeting.id}: ${sent.failures.join(', ')} failed`)

      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { formReminderSent: true },
      })

      results.formRemindersSent++
    } catch (error) {
      console.error(`Error sending form reminder for meeting ${meeting.id}:`, error)
      results.errors.push(`Failed to send form reminder for meeting ${meeting.id}`)
    }
  }
}

