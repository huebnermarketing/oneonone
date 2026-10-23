import { NextRequest, NextResponse } from 'next/server'
import { ADMIN, parseBody, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { logDataCleared } from '@/lib/audit'
import { deleteS3Prefix, isS3Configured } from '@/lib/s3'
import { clearDataSchema } from '@/lib/validation/admin'

export const dynamic = 'force-dynamic'

async function getCounts() {
  const [recordings, todos, meetings, calendarEvents, users, departments, recurringSchedules, attachments] =
    await Promise.all([
      prisma.meetingRecording.count(),
      prisma.todo.count(),
      prisma.meeting.count(),
      prisma.calendarEvent.count(),
      prisma.user.count(),
      prisma.department.count(),
      prisma.recurringSchedule.count(),
      prisma.attachment.count(),
    ])
  return { recordings, todos, meetings, calendarEvents, users, departments, recurringSchedules, attachments }
}

export const GET = withApiAuth(ADMIN, async () => NextResponse.json(await getCounts()))

/**
 * POST /api/admin/clear-data { clearType, keepCurrentUser, confirm }
 * Destructive. Runs in one transaction (all-or-nothing), is audit-logged, and requires the caller
 * to echo the clearType in `confirm`. S3 objects for deleted recordings/attachments are removed afterwards.
 */
export const POST = withApiAuth(ADMIN, async (req: NextRequest, { user }) => {
  const { clearType, keepCurrentUser } = await parseBody(req, clearDataSchema)
  const previous = await getCounts()

  const clearRecordings = clearType === 'all' || clearType === 'recordings' || clearType === 'meetings' || clearType === 'users'
  const clearTodos = clearType === 'all' || clearType === 'todos' || clearType === 'meetings' || clearType === 'users'
  const clearMeetings = clearType === 'all' || clearType === 'meetings' || clearType === 'users'
  const clearUsers = clearType === 'all' || clearType === 'users'
  const clearDepartments = clearType === 'all' || clearType === 'departments'

  // Collect S3 keys before rows disappear
  const s3Prefixes: string[] = []
  if (clearRecordings) {
    const recs = await prisma.meetingRecording.findMany({ where: { audioKey: { not: null } }, select: { audioKey: true } })
    s3Prefixes.push(...recs.map((r) => r.audioKey!.replace(/\/final\.webm$/, '')))
  }
  if (clearMeetings) {
    const atts = await prisma.attachment.findMany({ select: { s3Key: true } })
    s3Prefixes.push(...atts.map((a) => a.s3Key))
  }

  const deleted = await prisma.$transaction(async (tx) => {
    const d = { recordings: 0, todos: 0, meetings: 0, calendarEvents: 0, attachments: 0, recurringSchedules: 0, notifications: 0, users: 0, departments: 0 }

    if (clearRecordings) d.recordings = (await tx.meetingRecording.deleteMany({})).count
    if (clearTodos) d.todos = (await tx.todo.deleteMany({})).count
    if (clearMeetings) {
      d.calendarEvents = (await tx.calendarEvent.deleteMany({})).count
      d.attachments = (await tx.attachment.deleteMany({})).count
      d.meetings = (await tx.meeting.deleteMany({})).count
      d.recurringSchedules = (await tx.recurringSchedule.deleteMany({})).count
      d.notifications = (await tx.notification.deleteMany({})).count
    }
    if (clearUsers) {
      const where = keepCurrentUser ? { id: { not: user.id } } : {}
      await tx.meeting.updateMany({ data: { proposedById: null } })
      await tx.user.updateMany({ data: { reportsToId: null } })
      // AuditLog, Session, Account, Notification, RecurringSchedule cascade from User
      d.users = (await tx.user.deleteMany({ where })).count
    }
    if (clearDepartments) {
      await tx.user.updateMany({ data: { departmentId: null } })
      d.departments = (await tx.department.deleteMany({})).count
    }
    return d
  }, { timeout: 60_000 })

  await logDataCleared(user.id, clearType, deleted)

  // Best-effort storage cleanup
  if (s3Prefixes.length > 0 && (await isS3Configured())) {
    for (const prefix of s3Prefixes) {
      await deleteS3Prefix(prefix).catch((e) => console.warn('[clear-data] S3 cleanup failed for', prefix, e))
    }
  }

  return NextResponse.json({ success: true, message: 'Data cleared successfully', deleted, previous })
})
