import { requirePageAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { BackupClient } from './backup-client'

export default async function BackupPage() {
  await requirePageAdmin()

  const backups = await prisma.backupHistory.findMany({
    orderBy: { startedAt: 'desc' },
    take: 20,
  })

  return <BackupClient initialBackups={backups} />
}
