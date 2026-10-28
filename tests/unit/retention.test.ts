import { describe, it, expect } from 'vitest'
import { prismaMock } from '../helpers/prisma-mock'
import { RETENTION_DAYS, retentionCutoffs, runRetention } from '@/lib/retention'

const now = new Date('2026-10-28T00:00:00Z')
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000)

describe('retention', () => {
  it('cut-offs', () => {
    const c = retentionCutoffs(now)
    expect(c.readNotifications).toEqual(daysAgo(RETENTION_DAYS.readNotifications))
    expect(c.unreadNotifications).toEqual(daysAgo(180))
    expect(c.auditLogs).toEqual(daysAgo(730))
    expect(c.expiredSessions).toEqual(daysAgo(1))
  })

  it('deletes only old read/unread notifications, old audit rows, finished job runs and expired sessions', async () => {
    prismaMock.notification.deleteMany.mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce({ count: 1 })
    prismaMock.auditLog.deleteMany.mockResolvedValue({ count: 5 })
    prismaMock.recordingJob.deleteMany.mockResolvedValue({ count: 2 })
    prismaMock.session.deleteMany.mockResolvedValue({ count: 7 })
    expect(await runRetention(now)).toEqual({ notifications: 4, auditLogs: 5, recordingJobs: 2, sessions: 7 })

    const n = prismaMock.notification.deleteMany.mock.calls.map((c) => c[0].where)
    expect(n).toEqual([
      { isRead: true, createdAt: { lt: daysAgo(90) } },
      { isRead: false, createdAt: { lt: daysAgo(180) } },
    ])
    expect(prismaMock.auditLog.deleteMany.mock.calls[0][0].where).toEqual({ createdAt: { lt: daysAgo(730) } })
    expect(prismaMock.recordingJob.deleteMany.mock.calls[0][0].where).toEqual({ status: { in: ['DONE', 'FAILED'] }, createdAt: { lt: daysAgo(180) } })
    expect(prismaMock.session.deleteMany.mock.calls[0][0].where).toEqual({ expires: { lt: daysAgo(1) } })
  })
})
