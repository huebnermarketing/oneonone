import { NextRequest, NextResponse } from 'next/server'
import { BackupType } from '@prisma/client'
import { ADMIN, parseBody, withApiAuth } from '@/lib/api'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit'
import { createBackupSchema } from '@/lib/validation/admin'
import { exportBackup } from '@/lib/backup'

export const dynamic = 'force-dynamic'

const BACKUP_TABLES = ['departments', 'users', 'recurringSchedules', 'meetings', 'recordings', 'todos', 'formRevisions']

// GET /api/admin/backup - backup history (admin only)
export const GET = withApiAuth(ADMIN, async () => {
  const backups = await prisma.backupHistory.findMany({
    orderBy: { startedAt: 'desc' },
    take: 50,
  })
  return NextResponse.json(backups)
})

async function getRecordCounts() {
  const [users, departments, meetings, todos, recordings, notifications, auditLogs] = await Promise.all([
    prisma.user.count(),
    prisma.department.count(),
    prisma.meeting.count(),
    prisma.todo.count(),
    prisma.meetingRecording.count(),
    prisma.notification.count(),
    prisma.auditLog.count(),
  ])
  return { users, departments, meetings, todos, recordings, notifications, auditLogs }
}

/**
 * POST /api/admin/backup { type } (admin only)
 * Builds a JSON export inline and returns it in the response body (the client downloads it).
 * A BackupHistory row tracks the run; it is marked FAILED if the export throws.
 */
export const POST = withApiAuth(ADMIN, async (req: NextRequest, { user }) => {
  const body = await parseBody(req, createBackupSchema)
  // zod applies the default at runtime; the fallback only narrows the type (parseBody infers the input type)
  const type: BackupType = body.type

  const backup = await prisma.backupHistory.create({
    data: { type, status: 'IN_PROGRESS', createdBy: user.id },
  })

  try {
    const recordCount = await getRecordCounts()
    const jsonData = JSON.stringify(await exportBackup(), null, 2)
    const fileSize = Buffer.from(jsonData).length
    const fileName = `ami-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`

    await prisma.backupHistory.update({
      where: { id: backup.id },
      data: {
        status: 'COMPLETED',
        fileName,
        fileSize,
        recordCount,
        tables: BACKUP_TABLES,
        completedAt: new Date(),
      },
    })

    await createAuditLog({
      userId: user.id,
      action: 'EXPORT',
      entityType: 'Backup',
      entityId: backup.id,
      details: { type, recordCount },
    })

    return NextResponse.json({
      backup: { ...backup, status: 'COMPLETED', fileName, fileSize, recordCount },
      data: jsonData,
    })
  } catch (error) {
    // Best-effort: record the failure, then let the wrapper map the error
    await prisma.backupHistory
      .update({
        where: { id: backup.id },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          completedAt: new Date(),
        },
      })
      .catch((e) => console.error('[backup] Failed to mark backup as failed:', e))
    throw error
  }
})
