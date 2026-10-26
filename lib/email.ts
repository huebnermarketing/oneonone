import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import nodemailer from 'nodemailer'
import { APP_NAME } from './constants'
import { prisma } from './prisma'
import { formatDateOnly, formatMeetingLong, resolveTimeZone, timeZoneAbbrev } from './dates'

// --- Transport: SMTP or AWS SES ---

function isSmtpConfigured(): boolean {
  const host = process.env.SMTP_HOST || ''
  const user = process.env.SMTP_USER || ''
  const pass = process.env.SMTP_PASSWORD || ''
  const from = process.env.EMAIL_FROM || ''
  return !!(host && user && pass && from)
}

function getFromEmail(): string {
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM
  if (process.env.AWS_SES_FROM_EMAIL) return process.env.AWS_SES_FROM_EMAIL
  throw new Error('EMAIL_FROM or AWS_SES_FROM_EMAIL must be set in environment variables')
}

// Lazy SMTP transporter (only when SMTP is configured)
let smtpTransporter: nodemailer.Transporter | null = null
function getSmtpTransporter(): nodemailer.Transporter {
  if (!smtpTransporter) {
    const port = parseInt(process.env.SMTP_PORT || '587', 10)
    const secure = port === 465
    smtpTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    })
  }
  return smtpTransporter
}

// Lazy SES client (only when SES is used)
let sesClient: SESClient | null = null
function getSesClient(): SESClient {
  if (!sesClient) {
    sesClient = new SESClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    })
  }
  return sesClient
}

function isSesConfigured(): boolean {
  const from = process.env.AWS_SES_FROM_EMAIL || ''
  const key = process.env.AWS_ACCESS_KEY_ID || ''
  const secret = process.env.AWS_SECRET_ACCESS_KEY || ''
  return !!(from && key && secret)
}

interface EmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('Email not configured: neither SMTP nor AWS SES is set up. Configure SMTP_* or AWS_SES_* in .env')
    this.name = 'EmailNotConfiguredError'
  }
}

export function isEmailConfigured(): boolean {
  return isSmtpConfigured() || isSesConfigured()
}

/**
 * Keep subjects plain ASCII. Non-ASCII characters (en dashes, middle dots, curly quotes) force the
 * mailer to RFC 2047-encode the header ("=?UTF-8?Q?...?=") which some clients, notification previews
 * and logs show raw. Names with genuinely non-Latin letters are left alone — encoding is then correct.
 */
export function asciiSubject(subject: string): string {
  return subject
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u00b7|\u2022/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\u00a0/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Plain-text alternative derived from the HTML body (spam filters score multipart/alternative better). */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => `${label.trim()} (${href})`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h1|h2|h3|li|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function sendEmail({ to, subject: rawSubject, html, text: rawText }: EmailOptions): Promise<string | null> {
  const recipients = Array.isArray(to) ? to : [to]
  const from = getFromEmail()
  const subject = asciiSubject(rawSubject)
  const text = rawText || htmlToText(html)

  // Prefer SMTP if configured
  if (isSmtpConfigured()) {
    try {
      const transporter = getSmtpTransporter()
      const info = await transporter.sendMail({
        from,
        to: recipients,
        subject,
        html,
        text,
      })
      console.log(`Email sent via SMTP to ${recipients.join(', ')} [${info.messageId}]`)
      return info.messageId || null
    } catch (error) {
      console.error('SMTP send error:', error)
      throw error
    }
  }

  // Fall back to AWS SES if configured
  if (isSesConfigured()) {
    try {
      const client = getSesClient()
      const command = new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: recipients },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: html, Charset: 'UTF-8' },
            Text: { Data: text, Charset: 'UTF-8' },
          },
        },
      })
      const response = await client.send(command)
      console.log(`Email sent via SES to ${recipients.join(', ')} [${response.MessageId}]`)
      return response.MessageId || null
    } catch (error) {
      console.error('SES send error:', error)
      throw error
    }
  }

  // Neither provider configured — throw so callers know it failed
  throw new EmailNotConfiguredError()
}

// ---------------------------------------------------------------------------
// Shared email layout
// ---------------------------------------------------------------------------

const appName = APP_NAME
const baseUrl = () => {
  const url = process.env.NEXTAUTH_URL
  if (!url) console.warn('[email] NEXTAUTH_URL is not set; links in emails will be relative')
  return url || ''
}
// ---------------------------------------------------------------------------
// Recipient timezone — every date in an email is rendered in the RECIPIENT's zone
// ---------------------------------------------------------------------------

const tzCache = new Map<string, { tz: string; at: number }>()
const TZ_CACHE_MS = 60_000

/** Timezone of the user behind an email address (app default when unknown). Cached for a minute. */
export async function recipientTimeZone(email: string): Promise<string> {
  const key = email.toLowerCase()
  const hit = tzCache.get(key)
  if (hit && Date.now() - hit.at < TZ_CACHE_MS) return hit.tz
  let tz: string | null | undefined
  try {
    tz = (await prisma.user.findUnique({ where: { email: key }, select: { timeZone: true } }))?.timeZone
  } catch (err) {
    console.warn('[email] timezone lookup failed:', err instanceof Error ? err.message : err)
  }
  const resolved = resolveTimeZone(tz)
  tzCache.set(key, { tz: resolved, at: Date.now() })
  return resolved
}

/** "Thursday, October 29, 2026 at 9:30 AM IST" — always with the zone, since the two parties may differ. */
const whenFor = (date: Date, tz: string) => `${formatMeetingLong(date, tz)} ${timeZoneAbbrev(date, tz)}`

/** Escape user-controlled text before interpolating it into HTML templates. */
function esc(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function emailLayout({
  preheader,
  heading,
  body,
  ctaText,
  ctaUrl,
}: {
  preheader: string
  heading: string
  body: string
  ctaText?: string
  ctaUrl?: string
}): string {
  const cta = ctaText && ctaUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
        <tr>
          <td style="border-radius:8px;background-color:#1D1D1F;">
            <a href="${ctaUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
              ${ctaText}
            </a>
          </td>
        </tr>
      </table>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${heading}</title>
  <!--[if mso]><style>body,table,td{font-family:Arial,Helvetica,sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f2f2f7;-webkit-text-size-adjust:none;-ms-text-size-adjust:none;">
  <!-- Preheader (hidden preview text) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f2f2f7;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          
          <!-- Logo bar -->
          <tr>
            <td style="padding:28px 32px 20px;border-bottom:1px solid #f0f0f2;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:36px;height:36px;background-color:#1D1D1F;border-radius:10px;text-align:center;vertical-align:middle;">
                    <span style="color:#ffffff;font-size:16px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif;line-height:36px;">A</span>
                  </td>
                  <td style="padding-left:12px;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif;">
                    <span style="font-size:17px;font-weight:700;color:#1D1D1F;">${appName}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding:32px 32px 36px;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif;">
              <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#1D1D1F;line-height:1.3;">${heading}</h1>
              <div style="font-size:15px;line-height:1.7;color:#48484A;">
                ${body}
              </div>
              ${cta}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px;border-top:1px solid #f0f0f2;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:#AEAEB2;">
                This is an automated notification from ${appName}. Please do not reply to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function detailRow(label: string, value: string): string {
  value = esc(value)
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:6px 0;">
    <tr>
      <td style="padding:10px 14px;background-color:#f8f8fa;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif;">
        <span style="font-size:12px;font-weight:600;color:#8E8E93;text-transform:uppercase;letter-spacing:0.5px;">${label}</span><br>
        <span style="font-size:15px;font-weight:500;color:#1D1D1F;">${value}</span>
      </td>
    </tr>
  </table>`
}

// ---------------------------------------------------------------------------
// Email senders
// Conventions: raw names go to subjects and detailRow() (which escapes); esc() only when a
// name is interpolated directly into HTML prose.
// ---------------------------------------------------------------------------

export async function sendMeetingScheduledEmail(
  employeeEmail: string,
  employeeName: string | null,
  reporterEmail: string,
  reporterName: string | null,
  meetingDate: Date,
  meetingId: string
) {
  const empName = employeeName || 'Team Member'
  const mgrName = reporterName || 'Your Manager'
  const [empTz, mgrTz] = await Promise.all([recipientTimeZone(employeeEmail), recipientTimeZone(reporterEmail)])
  const empWhen = whenFor(meetingDate, empTz)
  const mgrWhen = whenFor(meetingDate, mgrTz)

  const employeeHtml = emailLayout({
    preheader: `Your one-on-one with ${esc(mgrName)} is scheduled for ${empWhen}`,
    heading: 'Meeting Scheduled',
    body: `
      <p style="margin:0 0 16px;">Hi ${esc(empName)},</p>
      <p style="margin:0 0 20px;">A one-on-one meeting has been scheduled. Please review the details below and prepare your check-in form before the meeting.</p>
      ${detailRow('With', mgrName)}
      ${detailRow('Date & Time', empWhen)}
    `,
    ctaText: 'View Meeting Details',
    ctaUrl: `${baseUrl()}/meetings/${meetingId}`,
  })

  const reporterHtml = emailLayout({
    preheader: `Your one-on-one with ${esc(empName)} is scheduled for ${mgrWhen}`,
    heading: 'Meeting Scheduled',
    body: `
      <p style="margin:0 0 16px;">Hi ${esc(mgrName)},</p>
      <p style="margin:0 0 20px;">A one-on-one meeting has been scheduled with your direct report. Here are the details:</p>
      ${detailRow('With', empName)}
      ${detailRow('Date & Time', mgrWhen)}
    `,
    ctaText: 'View Meeting Details',
    ctaUrl: `${baseUrl()}/meetings/${meetingId}`,
  })

  await Promise.all([
    sendEmail({ to: employeeEmail, subject: `Meeting Scheduled - ${mgrName}, ${empWhen}`, html: employeeHtml }),
    sendEmail({ to: reporterEmail, subject: `Meeting Scheduled - ${empName}, ${mgrWhen}`, html: reporterHtml }),
  ])
}

export async function sendTodoAssignedEmail(
  assigneeEmail: string,
  assigneeName: string | null,
  todoTitle: string,
  todoDescription: string | null,
  dueDate: Date | null,
  createdByName: string | null,
  todoId: string
) {
  // Due dates are calendar dates (stored at 00:00 UTC) — never shift them by timezone
  const formattedDueDate = dueDate ? formatDateOnly(dueDate) : 'No due date'
  const name = assigneeName || 'Team Member'
  const creator = createdByName || 'Your Manager'

  const html = emailLayout({
    preheader: `${esc(creator)} assigned you a new task: ${esc(todoTitle)}`,
    heading: 'New Task Assigned',
    body: `
      <p style="margin:0 0 16px;">Hi ${esc(name)},</p>
      <p style="margin:0 0 20px;">A new task has been assigned to you. Please review the details below.</p>
      ${detailRow('Task', todoTitle)}
      ${todoDescription ? detailRow('Description', todoDescription) : ''}
      ${detailRow('Due Date', formattedDueDate)}
      ${detailRow('Assigned By', creator)}
    `,
    ctaText: 'View Task',
    ctaUrl: `${baseUrl()}/todos/${todoId}`,
  })

  await sendEmail({ to: assigneeEmail, subject: `New Task - ${todoTitle}`, html })
}

export async function sendTodoDueReminderEmail(
  assigneeEmail: string,
  assigneeName: string | null,
  todoTitle: string,
  dueDate: Date,
  todoId: string
) {
  const formattedDueDate = formatDateOnly(dueDate)
  const name = assigneeName || 'Team Member'

  const html = emailLayout({
    preheader: `Reminder: "${esc(todoTitle)}" is due on ${formattedDueDate}`,
    heading: 'Task Due Soon',
    body: `
      <p style="margin:0 0 16px;">Hi ${esc(name)},</p>
      <p style="margin:0 0 20px;">This is a friendly reminder that one of your tasks is due soon. Please make sure to complete it on time.</p>
      ${detailRow('Task', todoTitle)}
      ${detailRow('Due Date', formattedDueDate)}
    `,
    ctaText: 'View Task',
    ctaUrl: `${baseUrl()}/todos/${todoId}`,
  })

  await sendEmail({ to: assigneeEmail, subject: `Reminder - ${todoTitle} due ${formattedDueDate}`, html })
}

export async function sendFormSubmittedEmail(
  reporterEmail: string,
  reporterName: string | null,
  employeeName: string | null,
  meetingDate: Date,
  meetingId: string
) {
  const tz = await recipientTimeZone(reporterEmail)
  const when = whenFor(meetingDate, tz)
  const mgrName = reporterName || 'Manager'
  const empName = employeeName || 'Team Member'

  const html = emailLayout({
    preheader: `${esc(empName)} submitted their one-on-one form for ${when}`,
    heading: 'Check-in Form Submitted',
    body: `
      <p style="margin:0 0 16px;">Hi ${esc(mgrName)},</p>
      <p style="margin:0 0 20px;"><strong>${esc(empName)}</strong> has submitted their one-on-one check-in form for the meeting on <strong>${when}</strong>. Please review their responses before the meeting.</p>
      ${detailRow('Submitted By', empName)}
      ${detailRow('Meeting Date', when)}
    `,
    ctaText: 'Review Form',
    ctaUrl: `${baseUrl()}/meetings/${meetingId}`,
  })

  await sendEmail({ to: reporterEmail, subject: `Form Submitted - ${empName}, ${when}`, html })
}

// ---------------------------------------------------------------------------
// Proposal-based scheduling emails
// ---------------------------------------------------------------------------

/** Email sent to the employee when a reporter proposes a meeting time. */
export async function sendMeetingProposalEmail(
  employeeEmail: string,
  employeeName: string | null,
  reporterName: string | null,
  meetingDate: Date,
  meetingId: string
) {
  const empName = employeeName || 'Team Member'
  const mgrName = reporterName || 'Your Manager'
  const when = whenFor(meetingDate, await recipientTimeZone(employeeEmail))

  const html = emailLayout({
    preheader: `${esc(mgrName)} has proposed a one-on-one meeting for ${when}`,
    heading: 'Meeting Request',
    body: `
      <p style="margin:0 0 16px;">Hi ${esc(empName)},</p>
      <p style="margin:0 0 20px;"><strong>${esc(mgrName)}</strong> has proposed a one-on-one meeting with you. Please review the details and either accept the proposed time or suggest an alternative.</p>
      ${detailRow('Proposed By', mgrName)}
      ${detailRow('Date & Time', when)}
    `,
    ctaText: 'Accept or Suggest New Time',
    ctaUrl: `${baseUrl()}/meetings/${meetingId}`,
  })

  await sendEmail({ to: employeeEmail, subject: `Meeting Request - ${mgrName}, ${when}`, html })
}

/** Email sent to the proposer when the receiver accepts. */
export async function sendMeetingAcceptedEmail(
  proposerEmail: string,
  proposerName: string | null,
  acceptorName: string | null,
  meetingDate: Date,
  meetingId: string
) {
  const pName = proposerName || 'Manager'
  const aName = acceptorName || 'Team Member'
  const when = whenFor(meetingDate, await recipientTimeZone(proposerEmail))

  const html = emailLayout({
    preheader: `${esc(aName)} accepted the one-on-one for ${when}`,
    heading: 'Meeting Confirmed',
    body: `
      <p style="margin:0 0 16px;">Hi ${esc(pName)},</p>
      <p style="margin:0 0 20px;"><strong>${esc(aName)}</strong> has accepted the proposed one-on-one meeting. The meeting has been added to your calendar.</p>
      ${detailRow('Accepted By', aName)}
      ${detailRow('Date & Time', when)}
    `,
    ctaText: 'View Meeting',
    ctaUrl: `${baseUrl()}/meetings/${meetingId}`,
  })

  await sendEmail({ to: proposerEmail, subject: `Meeting Confirmed - ${aName}, ${when}`, html })
}

/** Confirmation email to the reporter after they propose a meeting. */
export async function sendProposalConfirmationEmail(
  reporterEmail: string,
  reporterName: string | null,
  employeeName: string | null,
  meetingDate: Date,
  meetingId: string
) {
  const mgrName = reporterName || 'Manager'
  const empName = employeeName || 'Team Member'
  const when = whenFor(meetingDate, await recipientTimeZone(reporterEmail))

  const html = emailLayout({
    preheader: `Your proposal to ${esc(empName)} for ${when} has been sent`,
    heading: 'Meeting Proposed',
    body: `
      <p style="margin:0 0 16px;">Hi ${esc(mgrName)},</p>
      <p style="margin:0 0 20px;">Your one-on-one meeting proposal with <strong>${esc(empName)}</strong> has been sent. You'll be notified when they accept or suggest a new time.</p>
      ${detailRow('Proposed To', empName)}
      ${detailRow('Date & Time', when)}
    `,
    ctaText: 'View Meeting',
    ctaUrl: `${baseUrl()}/meetings/${meetingId}`,
  })

  await sendEmail({ to: reporterEmail, subject: `Meeting Proposed - ${empName}, ${when}`, html })
}

/** Reminder email sent before a meeting (window = reminderHoursBefore policy). */
export async function sendMeetingReminderEmail(
  recipientEmail: string,
  recipientName: string | null,
  otherPartyName: string | null,
  meetingDate: Date,
  meetingId: string
) {
  const name = recipientName || 'Team Member'
  const otherName = otherPartyName || 'your colleague'
  const when = whenFor(meetingDate, await recipientTimeZone(recipientEmail))

  const html = emailLayout({
    preheader: `Reminder: one-on-one with ${esc(otherName)} on ${when}`,
    heading: 'Upcoming Meeting',
    body: `
      <p style="margin:0 0 16px;">Hi ${esc(name)},</p>
      <p style="margin:0 0 20px;">This is a friendly reminder about your upcoming one-on-one meeting. Please prepare any topics you'd like to discuss.</p>
      ${detailRow('With', otherName)}
      ${detailRow('Date & Time', when)}
    `,
    ctaText: 'View Meeting',
    ctaUrl: `${baseUrl()}/meetings/${meetingId}`,
  })

  await sendEmail({ to: recipientEmail, subject: `Meeting Reminder - ${otherName}, ${when}`, html })
}

/** Reminder email sent to the employee when their form is not yet submitted before a meeting. */
export async function sendFormReminderEmail(
  employeeEmail: string,
  employeeName: string | null,
  reporterName: string | null,
  meetingDate: Date,
  meetingId: string
) {
  const empName = employeeName || 'Team Member'
  const mgrName = reporterName || 'your manager'
  const when = whenFor(meetingDate, await recipientTimeZone(employeeEmail))

  const html = emailLayout({
    preheader: `Reminder: please complete your check-in form before your meeting with ${esc(mgrName)}`,
    heading: 'Form Not Yet Submitted',
    body: `
      <p style="margin:0 0 16px;">Hi ${esc(empName)},</p>
      <p style="margin:0 0 20px;">Your one-on-one meeting with <strong>${esc(mgrName)}</strong> is coming up soon, but you haven't submitted your check-in form yet. Please take a few minutes to fill it out so your manager can prepare for the meeting.</p>
      ${detailRow('Meeting With', mgrName)}
      ${detailRow('Date & Time', when)}
    `,
    ctaText: 'Fill Out Form',
    ctaUrl: `${baseUrl()}/meetings/${meetingId}/form`,
  })

  await sendEmail({ to: employeeEmail, subject: `Action Required - Submit your form before the meeting with ${mgrName}, ${when}`, html })
}

/** Email sent to the other party when the receiver suggests a new time. */
export async function sendMeetingSuggestionEmail(
  recipientEmail: string,
  recipientName: string | null,
  suggestorName: string | null,
  newDate: Date,
  meetingId: string
) {
  const rName = recipientName || 'Manager'
  const sName = suggestorName || 'Team Member'
  const when = whenFor(newDate, await recipientTimeZone(recipientEmail))

  const html = emailLayout({
    preheader: `${esc(sName)} suggested a new time: ${when}`,
    heading: 'New Time Suggested',
    body: `
      <p style="margin:0 0 16px;">Hi ${esc(rName)},</p>
      <p style="margin:0 0 20px;"><strong>${esc(sName)}</strong> has suggested a different time for the one-on-one meeting. Please review and either accept or propose another time.</p>
      ${detailRow('Suggested By', sName)}
      ${detailRow('New Date & Time', when)}
    `,
    ctaText: 'Accept or Suggest Another Time',
    ctaUrl: `${baseUrl()}/meetings/${meetingId}`,
  })

  await sendEmail({ to: recipientEmail, subject: `New Time Suggested - ${sName}, ${when}`, html })
}

/**
 * Email sent to the employee when their recurring schedule is updated.
 * `timeOfDay` is wall-clock time in the REPORTER's zone (`reporterTimeZone`); it is shown with that
 * zone's abbreviation so an employee elsewhere is not misled.
 */
export async function sendRecurringScheduleUpdatedEmail(
  employeeEmail: string,
  employeeName: string | null,
  managerName: string | null,
  dayOfWeek: number,
  timeOfDay: string,
  frequency: string,
  reporterTimeZone?: string | null
) {
  const empName = employeeName || 'Team Member'
  const mgrName = managerName || 'Your manager'
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const dayName = dayNames[dayOfWeek] || 'Unknown'
  const [hh, mm] = timeOfDay.split(':').map(Number)
  const period = hh >= 12 ? 'PM' : 'AM'
  const hour12 = hh % 12 || 12
  const tz = resolveTimeZone(reporterTimeZone)
  const formattedTime = `${hour12}:${String(mm).padStart(2, '0')} ${period} ${timeZoneAbbrev(new Date(), tz)}`
  const freqLabel = frequency === 'WEEKLY' ? 'Weekly' : frequency === 'BIWEEKLY' ? 'Every 2 Weeks' : 'Monthly'

  const html = emailLayout({
    preheader: `${esc(mgrName)} updated your recurring one-on-one schedule`,
    heading: 'Recurring Schedule Updated',
    body: `
      <p style="margin:0 0 16px;">Hi ${esc(empName)},</p>
      <p style="margin:0 0 20px;"><strong>${esc(mgrName)}</strong> has updated the recurring one-on-one meeting schedule with you. Please review the new details below.</p>
      ${detailRow('Frequency', freqLabel)}
      ${detailRow('Day', dayName)}
      ${detailRow('Time', formattedTime)}
    `,
    ctaText: 'View Meetings',
    ctaUrl: `${baseUrl()}/meetings`,
  })

  await sendEmail({ to: employeeEmail, subject: `Schedule Updated - ${freqLabel} on ${dayName}s at ${formattedTime}`, html })
}

/** Sent to the other party (or both, when an admin cancels) when a single meeting is cancelled. */
export async function sendMeetingCancelledEmail(
  recipientEmail: string,
  recipientName: string | null,
  cancelledByName: string | null,
  meetingDate: Date,
  reason?: string | null
) {
  const name = recipientName || 'Team Member'
  const byName = cancelledByName || 'A colleague'
  const when = whenFor(meetingDate, await recipientTimeZone(recipientEmail))

  const html = emailLayout({
    preheader: `${esc(byName)} cancelled the one-on-one scheduled for ${when}`,
    heading: 'Meeting Cancelled',
    body: `
      <p style="margin:0 0 16px;">Hi ${esc(name)},</p>
      <p style="margin:0 0 20px;"><strong>${esc(byName)}</strong> has cancelled the one-on-one meeting below. No further action is needed; a new meeting can be proposed at any time.</p>
      ${detailRow('Cancelled By', byName)}
      ${detailRow('Original Date & Time', when)}
      ${reason ? detailRow('Reason', reason) : ''}
    `,
    ctaText: 'Open Meetings',
    ctaUrl: `${baseUrl()}/meetings`,
  })

  await sendEmail({ to: recipientEmail, subject: `Meeting Cancelled - ${when}`, html })
}
