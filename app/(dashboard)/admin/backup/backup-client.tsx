'use client'

import { useState, useRef } from 'react'
import { 
  Download, 
  Upload, 
  HardDrive, 
  Loader2, 
  CheckCircle, 
  XCircle, 
  Clock,
  FileJson,
  AlertTriangle
} from 'lucide-react'
import { BackupHistory, BackupStatus } from '@prisma/client'
import { useFormat } from '@/components/providers/timezone-provider'
import { Pill, type PillTone } from '@/components/ui/pill'
import { formatFileSize } from '@/lib/ui'

const STATUS_META: Record<BackupStatus, { icon: typeof Clock; tone: PillTone; label: string; spin?: boolean }> = {
  PENDING: { icon: Clock, tone: 'amber', label: 'Pending' },
  IN_PROGRESS: { icon: Loader2, tone: 'blue', label: 'In progress', spin: true },
  COMPLETED: { icon: CheckCircle, tone: 'green', label: 'Completed' },
  FAILED: { icon: XCircle, tone: 'red', label: 'Failed' },
}

interface BackupClientProps {
  initialBackups: BackupHistory[]
}

export function BackupClient({ initialBackups }: BackupClientProps) {
  const f = useFormat()
  const [backups, setBackups] = useState<BackupHistory[]>(initialBackups)
  const [creating, setCreating] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const createBackup = async () => {
    setCreating(true)
    setMessage(null)

    try {
      const response = await fetch('/api/admin/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'FULL' }),
      })

      const result = await response.json()

      if (response.ok) {
        // Download the backup file
        const blob = new Blob([result.data], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = result.backup.fileName || 'ami-backup.json'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        // Add to list
        setBackups([result.backup, ...backups])
        setMessage({ type: 'success', text: 'Backup created and downloaded successfully!' })
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to create backup' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to create backup' })
    } finally {
      setCreating(false)
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setRestoring(true)
    setMessage(null)

    try {
      const text = await file.text()
      const data = JSON.parse(text)

      const response = await fetch('/api/admin/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          data,
          options: { clearExisting: false, restoreUsers: true, restoreMeetings: true }
        }),
      })

      const result = await response.json()

      if (response.ok) {
        setMessage({ 
          type: 'success', 
          text: `Restored: ${result.departments} departments, ${result.users} users, ${result.meetings} meetings, ${result.todos} todos` 
        })
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to restore backup' })
      }
    } catch (error: unknown) {
      setMessage({ type: 'error', text: `Failed to restore: ${error instanceof Error ? error.message : 'Unknown error'}` })
    } finally {
      setRestoring(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-dark-gray dark:text-white mb-2">Backup & Restore</h1>
        <p className="text-medium-gray">Export your data or restore from a previous backup</p>
      </div>

      {/* Message */}
      {message && (
        <div role={message.type === 'error' ? 'alert' : 'status'} className={`rounded-xl p-4 ${
          message.type === 'success' 
            ? 'bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400' 
            : 'bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400'
        }`}>
          {message.text}
        </div>
      )}

      {/* Action Cards */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Create Backup */}
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Download className="w-6 h-6 text-blue-500" />
            </div>
            <div>
              <h3 className="font-semibold text-dark-gray dark:text-white">Create Backup</h3>
              <p className="text-sm text-medium-gray">Export all data as JSON file</p>
            </div>
          </div>
          <p className="text-sm text-medium-gray mb-4">
            Creates a complete backup of users, departments, meetings, todos, and recordings metadata.
          </p>
          <button
            type="button"
            onClick={createBackup}
            disabled={creating}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {creating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Creating Backup...
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                Download Backup
              </>
            )}
          </button>
        </div>

        {/* Restore */}
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Upload className="w-6 h-6 text-amber-500" />
            </div>
            <div>
              <h3 className="font-semibold text-dark-gray dark:text-white">Restore Data</h3>
              <p className="text-sm text-medium-gray">Import from backup file</p>
            </div>
          </div>
          <div className="flex items-start gap-2 mb-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Restoring will merge data with existing records. Duplicate entries will be updated.
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileSelect}
            className="hidden"
            aria-label="Backup file"
            tabIndex={-1}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={restoring}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-off-white dark:bg-charcoal text-dark-gray dark:text-white rounded-xl font-medium hover:bg-light-gray/20 dark:hover:bg-dark-gray disabled:opacity-50 transition-colors border border-off-white dark:border-medium-gray/20"
          >
            {restoring ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Restoring...
              </>
            ) : (
              <>
                <Upload className="w-5 h-5" />
                Select Backup File
              </>
            )}
          </button>
        </div>
      </div>

      {/* Backup History */}
      <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
        <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20">
          <h3 className="font-semibold text-dark-gray dark:text-white">Backup History</h3>
        </div>
        {backups.length === 0 ? (
          <div className="p-12 text-center">
            <HardDrive className="w-16 h-16 text-light-gray mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-dark-gray dark:text-white mb-2">No Backups Yet</h3>
            <p className="text-medium-gray">Create your first backup to see it here.</p>
          </div>
        ) : (
          <div className="divide-y divide-off-white dark:divide-medium-gray/20">
            {backups.map((backup) => {
              const meta = STATUS_META[backup.status] ?? { icon: Clock, tone: 'neutral' as PillTone, label: backup.status }
              const Icon = meta.icon

              return (
                <div key={backup.id} className="flex items-center gap-4 px-6 py-4 even:bg-off-white/40 dark:even:bg-charcoal/40">
                  <div className="w-10 h-10 rounded-xl bg-off-white dark:bg-charcoal flex items-center justify-center">
                    <FileJson className="w-5 h-5 text-medium-gray" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-dark-gray dark:text-white">
                      {backup.fileName || 'Backup'}
                    </p>
                    <p className="text-sm text-medium-gray">
                      {f.dateTime(backup.startedAt, 'short')} • {backup.fileSize ? formatFileSize(backup.fileSize) : '—'}
                    </p>
                  </div>
                  <Pill tone={meta.tone}>
                    <Icon className={`w-3.5 h-3.5 ${meta.spin ? 'animate-spin' : ''}`} aria-hidden="true" />
                    {meta.label}
                  </Pill>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
