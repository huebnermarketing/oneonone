import { google } from 'googleapis'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { RecurringFrequency } from '@prisma/client'
import { prisma } from './prisma'
import { DEFAULT_WORK_END, DEFAULT_WORK_START } from './timezones'
import { MEETING_DURATION_MINUTES } from './constants'
import { computeFreeSlots, isMeetingTimeFree, type Interval } from './free-slots'
import { buildRecurrenceRule } from './recurring-dates'

// Create OAuth2 client
function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.NEXTAUTH_URL + '/api/auth/callback/google'
  )
}

// Get authenticated OAuth2 client for a user
async function getAuthenticatedClient(userId: string) {
  const account = await prisma.account.findFirst({
    where: {
      userId,
      provider: 'google',
    },
  })

  if (!account || !account.access_token) {
    throw new Error('No Google account linked for this user')
  }

  const oauth2Client = createOAuth2Client()
  
  oauth2Client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
    expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
  })

  // Set up token refresh handler
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await prisma.account.updateMany({
        where: {
          userId,
          provider: 'google',
        },
        data: {
          access_token: tokens.access_token,
          expires_at: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : null,
          ...(tokens.refresh_token && { refresh_token: tokens.refresh_token }),
        },
      })
    }
  })

  return oauth2Client
}

export async function createCalendarEvent(
  meetingId: string,
  employeeEmail: string,
  reporterEmail: string,
  reporterId: string,
  meetingDate: Date,
  employeeName: string,
  reporterName: string
) {
  try {
    const reporter = await prisma.user.findUnique({
      where: { id: reporterId },
      select: { timeZone: true },
    })
    const calendarTz = reporter?.timeZone || FALLBACK_TZ

    const oauth2Client = await getAuthenticatedClient(reporterId)
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

    const event = {
      summary: `One-on-One: ${employeeName} & ${reporterName}`,
      description: `AMI One-on-One Meeting\n\nView meeting details: ${process.env.NEXTAUTH_URL}/meetings/${meetingId}`,
      start: {
        dateTime: meetingDate.toISOString(),
        timeZone: calendarTz,
      },
      end: {
        dateTime: new Date(meetingDate.getTime() + MEETING_DURATION_MINUTES * 60_000).toISOString(),
        timeZone: calendarTz,
      },
      attendees: [
        { email: employeeEmail },
        { email: reporterEmail },
      ],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 }, // 1 day before
          { method: 'popup', minutes: 15 }, // 15 minutes before
        ],
      },
      conferenceData: {
        createRequest: {
          requestId: meetingId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    }

    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
      conferenceDataVersion: 1,
      sendUpdates: 'all', // Send invites to all attendees
    })

    if (response.data.id && response.data.htmlLink) {
      // Store calendar event in database
      await prisma.calendarEvent.create({
        data: {
          meetingId,
          googleEventId: response.data.id,
          googleCalendarLink: response.data.htmlLink,
          scheduledAt: meetingDate,
        },
      })

      return {
        eventId: response.data.id,
        calendarLink: response.data.htmlLink,
        hangoutLink: response.data.hangoutLink,
      }
    }

    throw new Error('Failed to create calendar event')
  } catch (error: unknown) {
    console.error('Error creating calendar event:', error)
    
    // Check if it's an auth error
    const errMsg = error instanceof Error ? error.message : ''
    const errCode = error && typeof error === 'object' && 'code' in error ? (error as { code: unknown }).code : undefined
    if (errMsg.includes('No Google account') || errCode === 401) {
      throw new Error('Calendar access not authorized. Please re-login to grant calendar permissions.')
    }
    
    throw error
  }
}

/**
 * Create a recurring Google Calendar event (1 year of occurrences) so both reporter and employee
 * see the series on their calendars. Uses reporter's calendar as organizer; employee gets invite.
 */
export async function createRecurringCalendarEvent(
  scheduleId: string,
  firstMeetingId: string,
  reporterId: string,
  employeeEmail: string,
  reporterEmail: string,
  firstOccurrenceDate: Date,
  employeeName: string,
  reporterName: string,
  frequency: RecurringFrequency,
  timeZone: string
): Promise<{ eventId: string; calendarLink: string | null }> {
  const FALLBACK_TZ = 'Asia/Kolkata'
  const calendarTz = timeZone || FALLBACK_TZ

  const oauth2Client = await getAuthenticatedClient(reporterId)
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

  const endDate = new Date(firstOccurrenceDate.getTime() + MEETING_DURATION_MINUTES * 60_000)
  const event = {
    summary: `One-on-One (recurring): ${employeeName} & ${reporterName}`,
    description: `AMI One-on-One Recurring Meeting\n\nView meeting details: ${process.env.NEXTAUTH_URL}/meetings/${firstMeetingId}`,
    start: {
      dateTime: firstOccurrenceDate.toISOString(),
      timeZone: calendarTz,
    },
    end: {
      dateTime: endDate.toISOString(),
      timeZone: calendarTz,
    },
    recurrence: buildRecurrenceRule(frequency, firstOccurrenceDate, calendarTz),
    attendees: [
      { email: employeeEmail },
      { email: reporterEmail },
    ],
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 15 },
      ],
    },
  }

  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: event,
    sendUpdates: 'all',
  })

  const eventId = response.data.id
  const calendarLink = response.data.htmlLink ?? null
  if (!eventId) throw new Error('Failed to create recurring calendar event')

  await prisma.recurringSchedule.update({
    where: { id: scheduleId },
    data: { googleRecurringEventId: eventId, googleCalendarLink: calendarLink },
  })

  return { eventId, calendarLink }
}

export async function updateCalendarEvent(
  googleEventId: string,
  userId: string,
  meetingDate: Date,
  employeeName: string,
  reporterName: string
) {
  try {
    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: { timeZone: true },
    })
    const calendarTz = userRecord?.timeZone || FALLBACK_TZ

    const oauth2Client = await getAuthenticatedClient(userId)
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

    const event = {
      summary: `One-on-One: ${employeeName} & ${reporterName}`,
      start: {
        dateTime: meetingDate.toISOString(),
        timeZone: calendarTz,
      },
      end: {
        dateTime: new Date(meetingDate.getTime() + MEETING_DURATION_MINUTES * 60_000).toISOString(),
        timeZone: calendarTz,
      },
    }

    await calendar.events.patch({
      calendarId: 'primary',
      eventId: googleEventId,
      requestBody: event,
      sendUpdates: 'all',
    })

    // Update database
    await prisma.calendarEvent.updateMany({
      where: { googleEventId },
      data: { scheduledAt: meetingDate },
    })
  } catch (error) {
    console.error('Error updating calendar event:', error)
    throw error
  }
}

export async function deleteCalendarEvent(googleEventId: string, userId: string) {
  try {
    const oauth2Client = await getAuthenticatedClient(userId)
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

    await calendar.events.delete({
      calendarId: 'primary',
      eventId: googleEventId,
      sendUpdates: 'all',
    })

    // Delete from database
    await prisma.calendarEvent.deleteMany({
      where: { googleEventId },
    })
  } catch (error) {
    console.error('Error deleting calendar event:', error)
    throw error
  }
}

// Check if calendar integration is available for a user
export async function isCalendarEnabled(userId: string): Promise<boolean> {
  try {
    const account = await prisma.account.findFirst({
      where: {
        userId,
        provider: 'google',
      },
    })

    return !!(account?.access_token && account?.refresh_token)
  } catch (e) {
    console.error('Error checking calendar status:', e)
    return false
  }
}

// ── Availability / FreeBusy ─────────────────────────────────────────

interface BusyRange {
  start: string
  end: string
}

/**
 * Fetch free/busy data for a user's primary calendar over a time window.
 * Returns an array of busy ranges (ISO strings).
 */
export async function getFreeBusy(
  userId: string,
  timeMin: Date,
  timeMax: Date
): Promise<BusyRange[]> {
  const oauth2Client = await getAuthenticatedClient(userId)
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: 'UTC',
      items: [{ id: 'primary' }],
    },
  })

  const busy = response.data.calendars?.primary?.busy ?? []
  return busy
    .filter((b): b is { start: string; end: string } => !!b.start && !!b.end)
    .map((b) => ({ start: b.start!, end: b.end! }))
}

interface FreeSlot {
  start: string
  end: string
}

/**
 * Business-hours window (9 AM – 7 PM IST) when no user prefs are provided.
 */
const FALLBACK_TZ = 'Asia/Kolkata'

function parseHHmm(hhmm: string): { hours: number; minutes: number } {
  const [h, m] = hhmm.split(':').map(Number)
  return { hours: h ?? 0, minutes: m ?? 0 }
}

/**
 * Get the UTC range for a calendar date in a timezone with local work start/end (HH:mm).
 */
function getWorkWindowUtc(
  date: Date,
  timeZone: string,
  workStart: string,
  workEnd: string
): { start: Date; end: Date } {
  const zoned = toZonedTime(date, timeZone)
  const y = zoned.getFullYear()
  const mo = zoned.getMonth()
  const d = zoned.getDate()
  const start = parseHHmm(workStart)
  const end = parseHHmm(workEnd)
  const windowStart = fromZonedTime(
    new Date(y, mo, d, start.hours, start.minutes, 0, 0),
    timeZone
  )
  const windowEnd = fromZonedTime(
    new Date(y, mo, d, end.hours, end.minutes, 0, 0),
    timeZone
  )
  return { start: windowStart, end: windowEnd }
}

/**
 * Check if a UTC moment falls within a user's work hours on that day in their timezone.
 */
function isWithinWorkHours(utcDate: Date, timeZone: string, workStart: string, workEnd: string): boolean {
  const zoned = toZonedTime(utcDate, timeZone)
  const y = zoned.getFullYear()
  const mo = zoned.getMonth()
  const day = zoned.getDate()
  const h = zoned.getHours()
  const m = zoned.getMinutes()
  const start = parseHHmm(workStart)
  const end = parseHHmm(workEnd)
  const localMins = h * 60 + m
  const startMins = start.hours * 60 + start.minutes
  const endMins = end.hours * 60 + end.minutes
  return localMins >= startMins && localMins < endMins
}

export interface MutualFreeSlotsOptions {
  reporterTimeZone?: string | null
  reporterWorkStart?: string | null
  reporterWorkEnd?: string | null
  employeeTimeZone?: string | null
  employeeWorkStart?: string | null
  employeeWorkEnd?: string | null
}

/**
 * Given busy ranges from both users, compute mutually free slots of
 * `slotMinutes` duration. Uses reporter's date; when options are provided,
 * only slots where both users are within their working hours (in their TZ) are returned.
 */
export async function getMutualFreeSlots(
  reporterId: string,
  employeeId: string,
  date: Date,
  slotMinutes = MEETING_DURATION_MINUTES,
  options?: MutualFreeSlotsOptions
): Promise<FreeSlot[]> {
  const reporterTz = options?.reporterTimeZone ?? FALLBACK_TZ
  const reporterStart = options?.reporterWorkStart ?? DEFAULT_WORK_START
  const reporterEnd = options?.reporterWorkEnd ?? DEFAULT_WORK_END
  const employeeTz = options?.employeeTimeZone ?? FALLBACK_TZ
  const employeeStart = options?.employeeWorkStart ?? DEFAULT_WORK_START
  const employeeEnd = options?.employeeWorkEnd ?? DEFAULT_WORK_END

  const reporterWindow = getWorkWindowUtc(date, reporterTz, reporterStart, reporterEnd)
  const employeeWindow = getWorkWindowUtc(date, employeeTz, employeeStart, employeeEnd)

  // Query free/busy over the union of both windows to capture all busy events
  const queryStart = new Date(Math.min(reporterWindow.start.getTime(), employeeWindow.start.getTime()))
  const queryEnd = new Date(Math.max(reporterWindow.end.getTime(), employeeWindow.end.getTime()))

  // Generate slots over the intersection (only times within BOTH work windows)
  const windowStart = new Date(Math.max(reporterWindow.start.getTime(), employeeWindow.start.getTime()))
  const windowEnd = new Date(Math.min(reporterWindow.end.getTime(), employeeWindow.end.getTime()))

  if (windowStart >= windowEnd) {
    return []
  }

  const [reporterBusy, employeeBusy] = await Promise.all([
    getFreeBusy(reporterId, queryStart, queryEnd),
    getFreeBusy(employeeId, queryStart, queryEnd),
  ])

  const busy: Interval[] = [...reporterBusy, ...employeeBusy].map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))

  return computeFreeSlots({
    window: { start: windowStart.getTime(), end: windowEnd.getTime() },
    busy,
    durationMs: slotMinutes * 60_000,
    stepMs: SLOT_STEP_MINUTES * 60_000,
    accept: bothInWorkHours(options),
  }).map((slot) => ({ start: new Date(slot.start).toISOString(), end: new Date(slot.end).toISOString() }))
}

/** Candidate start times are offered every 30 minutes regardless of meeting length. */
const SLOT_STEP_MINUTES = 30

/** The whole meeting [start, end) must sit inside BOTH people's working hours in their own timezones. */
function bothInWorkHours(options?: MutualFreeSlotsOptions) {
  const rTz = options?.reporterTimeZone ?? FALLBACK_TZ
  const rStart = options?.reporterWorkStart ?? DEFAULT_WORK_START
  const rEnd = options?.reporterWorkEnd ?? DEFAULT_WORK_END
  const eTz = options?.employeeTimeZone ?? FALLBACK_TZ
  const eStart = options?.employeeWorkStart ?? DEFAULT_WORK_START
  const eEnd = options?.employeeWorkEnd ?? DEFAULT_WORK_END
  return (start: number, end: number) => {
    const first = new Date(start)
    const last = new Date(end - 1) // last minute of the meeting
    return (
      isWithinWorkHours(first, rTz, rStart, rEnd) &&
      isWithinWorkHours(last, rTz, rStart, rEnd) &&
      isWithinWorkHours(first, eTz, eStart, eEnd) &&
      isWithinWorkHours(last, eTz, eStart, eEnd)
    )
  }
}

/**
 * Is a specific meeting time free for both reporter and employee? Checks the exact interval
 * [dateTime, dateTime + duration) against both calendars and both people's working hours, so it is
 * correct for any duration and any start minute (it used to require the meeting to fit inside a
 * single pre-built 30-minute slot, which made every meeting longer than 30 minutes "busy").
 */
export async function isDateTimeFreeForBoth(
  reporterId: string,
  employeeId: string,
  dateTime: Date,
  durationMinutes = MEETING_DURATION_MINUTES,
  options?: MutualFreeSlotsOptions
): Promise<boolean> {
  const start = dateTime.getTime()
  const end = start + durationMinutes * 60_000
  const [reporterBusy, employeeBusy] = await Promise.all([
    getFreeBusy(reporterId, new Date(start), new Date(end)),
    getFreeBusy(employeeId, new Date(start), new Date(end)),
  ])
  const busy: Interval[] = [...reporterBusy, ...employeeBusy].map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
  return isMeetingTimeFree(start, end - start, { start, end }, busy, bothInWorkHours(options))
}
