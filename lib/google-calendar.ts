import { google } from 'googleapis'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { RecurringFrequency } from '@prisma/client'
import { prisma } from './prisma'
import { DEFAULT_WORK_END, DEFAULT_WORK_START } from './timezones'
import { DEFAULT_MEETING_DURATION, slotStepMinutes } from './meeting-duration'
import { busyFromFreeBusy, computeFreeSlots, isMeetingTimeFree, type FreeBusyCalendar, type Interval } from './free-slots'
import { buildRecurrenceRule } from './recurring-dates'
import { getGoogleTokens, saveGoogleTokens } from './oauth-tokens'

// Create OAuth2 client
function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.NEXTAUTH_URL + '/api/auth/callback/google'
  )
}

// Get authenticated OAuth2 client for a user (tokens are stored encrypted — lib/oauth-tokens.ts)
async function getAuthenticatedClient(userId: string) {
  const tokens = await getGoogleTokens(userId)
  if (!tokens) {
    throw new Error('No Google account linked for this user')
  }

  const oauth2Client = createOAuth2Client()
  oauth2Client.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken ?? undefined,
    expiry_date: tokens.expiryDate ?? undefined,
  })

  // googleapis refreshes expired access tokens itself; persist what it gets back
  oauth2Client.on('tokens', (fresh) => {
    saveGoogleTokens(userId, {
      access_token: fresh.access_token,
      refresh_token: fresh.refresh_token,
      id_token: fresh.id_token,
      expires_at: fresh.expiry_date ? Math.floor(fresh.expiry_date / 1000) : null,
    }).catch((err) => console.error(`[google-calendar] failed to store refreshed tokens for user ${userId}:`, err instanceof Error ? err.message : err))
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
  reporterName: string,
  durationMinutes: number = DEFAULT_MEETING_DURATION
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
        dateTime: new Date(meetingDate.getTime() + durationMinutes * 60_000).toISOString(),
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
  timeZone: string,
  durationMinutes: number = DEFAULT_MEETING_DURATION
): Promise<{ eventId: string; calendarLink: string | null }> {
  const FALLBACK_TZ = 'Asia/Kolkata'
  const calendarTz = timeZone || FALLBACK_TZ

  const oauth2Client = await getAuthenticatedClient(reporterId)
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

  const endDate = new Date(firstOccurrenceDate.getTime() + durationMinutes * 60_000)
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
  reporterName: string,
  durationMinutes: number = DEFAULT_MEETING_DURATION
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
        dateTime: new Date(meetingDate.getTime() + durationMinutes * 60_000).toISOString(),
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

/**
 * Change an event's (or a whole recurring series') length, keeping its start. For a series this moves
 * the end of every occurrence that hasn't been individually edited.
 */
export async function setCalendarEventDuration(googleEventId: string, userId: string, durationMinutes: number) {
  const calendar = google.calendar({ version: 'v3', auth: await getAuthenticatedClient(userId) })
  const { data } = await calendar.events.get({ calendarId: 'primary', eventId: googleEventId })
  const start = data.start?.dateTime
  if (!start) return
  await calendar.events.patch({
    calendarId: 'primary',
    eventId: googleEventId,
    requestBody: { end: { dateTime: new Date(new Date(start).getTime() + durationMinutes * 60_000).toISOString(), timeZone: data.start?.timeZone ?? undefined } },
    sendUpdates: 'all',
  })
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
    // Usable = tokens present AND decryptable (a refresh token is what keeps the connection alive)
    const tokens = await getGoogleTokens(userId)
    return !!(tokens?.accessToken && tokens.refreshToken)
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

/** Neither person's calendar can be read (nobody connected, or free/busy not visible). */
export class CalendarUnavailableError extends Error {
  constructor(
    public reason: 'none_connected' | 'not_visible',
    message: string
  ) {
    super(message)
    this.name = 'CalendarUnavailableError'
  }
}

/**
 * Busy times of BOTH people, read through ONE connected calendar: the reporter's if connected, else
 * the employee's. The other person's free/busy is queried by email — inside one Google Workspace,
 * colleagues' free/busy is visible by default — so only one of the two has to have signed in.
 * If Google can't show the other calendar (sharing turned off), falls back to that person's own
 * connection when they have one; otherwise throws CalendarUnavailableError('not_visible').
 */
export async function getPairBusy(reporterId: string, employeeId: string, timeMin: Date, timeMax: Date): Promise<Interval[]> {
  const [people, reporterConnected, employeeConnected] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [reporterId, employeeId] } }, select: { id: true, email: true } }),
    isCalendarEnabled(reporterId),
    isCalendarEnabled(employeeId),
  ])
  if (!reporterConnected && !employeeConnected) {
    throw new CalendarUnavailableError('none_connected', 'Neither Google Calendar is connected')
  }
  const viewerId = reporterConnected ? reporterId : employeeId
  const otherId = viewerId === reporterId ? employeeId : reporterId
  const otherConnected = viewerId === reporterId ? employeeConnected : reporterConnected
  const otherEmail = people.find((p) => p.id === otherId)?.email

  const calendar = google.calendar({ version: 'v3', auth: await getAuthenticatedClient(viewerId) })
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: 'UTC',
      items: [{ id: 'primary' }, ...(otherEmail ? [{ id: otherEmail }] : [])],
    },
  })
  const calendars = response.data.calendars as Record<string, FreeBusyCalendar> | undefined
  const viewerBusy = busyFromFreeBusy(calendars, 'primary') ?? []
  let otherBusy = otherEmail ? busyFromFreeBusy(calendars, otherEmail) : null
  if (otherBusy === null && otherConnected) {
    otherBusy = (await getFreeBusy(otherId, timeMin, timeMax)).map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
  }
  if (otherBusy === null) {
    throw new CalendarUnavailableError('not_visible', "The other person's free/busy isn't visible and they haven't connected their calendar")
  }
  return [...viewerBusy, ...otherBusy]
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
  slotMinutes: number = DEFAULT_MEETING_DURATION,
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

  const busy = await getPairBusy(reporterId, employeeId, queryStart, queryEnd)

  return computeFreeSlots({
    window: { start: windowStart.getTime(), end: windowEnd.getTime() },
    busy,
    durationMs: slotMinutes * 60_000,
    stepMs: slotStepMinutes(slotMinutes) * 60_000,
    accept: bothInWorkHours(options),
  }).map((slot) => ({ start: new Date(slot.start).toISOString(), end: new Date(slot.end).toISOString() }))
}

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
  durationMinutes: number = DEFAULT_MEETING_DURATION,
  options?: MutualFreeSlotsOptions
): Promise<boolean> {
  const start = dateTime.getTime()
  const end = start + durationMinutes * 60_000
  const busy = await getPairBusy(reporterId, employeeId, new Date(start), new Date(end))
  return isMeetingTimeFree(start, end - start, { start, end }, busy, bothInWorkHours(options))
}
