/**
 * Data retention — keeps the tables that only ever grow from growing forever. Runs on every cron
 * tick (hourly); each delete hits an indexed createdAt/expires column, so a tick with nothing to
 * remove is cheap. Meetings, recordings, form history and todos are never deleted here.
 */
import { prisma } from './prisma'

export const RETENTION_DAYS = {
  /** Notifications the user has read */
  readNotifications: 90,
  /** Notifications never opened — stale after this long */
  unreadNotifications: 180,
  /** Audit trail */
  auditLogs: 730,
  /** Finished recording-pipeline runs (DONE/FAILED); the recording itself stays */
  finishedRecordingJobs: 180,
} as const

const DAY_MS = 86_400_000

export function retentionCutoffs(now = new Date()) {
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS)
  return {
    readNotifications: ago(RETENTION_DAYS.readNotifications),
    unreadNotifications: ago(RETENTION_DAYS.unreadNotifications),
    auditLogs: ago(RETENTION_DAYS.auditLogs),
    finishedRecordingJobs: ago(RETENTION_DAYS.finishedRecordingJobs),
    /** NextAuth never removes expired sessions itself */
    expiredSessions: ago(1),
  }
}

export interface RetentionResult {
  notifications: number
  auditLogs: number
  recordingJobs: number
  sessions: number
}

export async function runRetention(now = new Date()): Promise<RetentionResult> {
  const c = retentionCutoffs(now)
  const [read, unread, audit, jobs, sessions] = await Promise.all([
    prisma.notification.deleteMany({ where: { isRead: true, createdAt: { lt: c.readNotifications } } }),
    prisma.notification.deleteMany({ where: { isRead: false, createdAt: { lt: c.unreadNotifications } } }),
    prisma.auditLog.deleteMany({ where: { createdAt: { lt: c.auditLogs } } }),
    prisma.recordingJob.deleteMany({ where: { status: { in: ['DONE', 'FAILED'] }, createdAt: { lt: c.finishedRecordingJobs } } }),
    prisma.session.deleteMany({ where: { expires: { lt: c.expiredSessions } } }),
  ])
  return { notifications: read.count + unread.count, auditLogs: audit.count, recordingJobs: jobs.count, sessions: sessions.count }
}
