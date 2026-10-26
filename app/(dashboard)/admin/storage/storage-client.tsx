'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { HardDrive, Trash2, Loader2, ArrowLeft, FileAudio } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-modal'
import { useFormat } from '@/components/providers/timezone-provider'

type StorageStats = {
  storageType: 's3' | 'local'
  localStorage: {
    path: string
    fileCount: number
    totalBytes: number
    totalMB: number
  }
  recordings?: {
    count: number
    totalBytes: number
    totalMB: number
  }
}

type RecordingRow = {
  id: string
  meetingId: string
  meetingDate: string | null
  employeeName: string | null
  reporterName: string | null
  status: string
  duration: number | null
  fileSize: number | null
  recordedAt: string | null
}

export function StorageClient() {
  const router = useRouter()
  const { toastError } = useToast()
  const confirm = useConfirm()
  const f = useFormat()
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [recordings, setRecordings] = useState<RecordingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const [statsRes, recordingsRes] = await Promise.all([
          fetch('/api/admin/storage'),
          fetch('/api/admin/recordings'),
        ])
        if (statsRes.ok) setStats(await statsRes.json())
        if (recordingsRes.ok) {
          const data = await recordingsRes.json()
          setRecordings(data.recordings ?? [])
        }
      } catch (e) {
        // Error handled by toast
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleDelete = async (meetingId: string) => {
    if (!await confirm('Delete this recording? The file will be removed from storage.', { variant: 'danger' })) return
    setDeletingId(meetingId)
    try {
      const res = await fetch(`/api/meetings/${meetingId}/recording`, { method: 'DELETE' })
      if (res.ok) {
        setRecordings((prev) => prev.filter((r) => r.meetingId !== meetingId))
        const sRes = await fetch('/api/admin/storage')
        if (sRes.ok) setStats(await sRes.json())
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        toastError(data.error || 'Failed to delete')
      }
    } catch (e) {
      toastError('Failed to delete')
    } finally {
      setDeletingId(null)
    }
  }

  const formatBytes = (n: number | null) => {
    if (n == null) return '–'
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / (1024 * 1024)).toFixed(2)} MB`
  }

  const formatDate = (d: string | null) => (d ? f.date(d, 'short') : '–')

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="w-8 h-8 animate-spin text-orange" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Link
          href="/admin"
          className="p-2 rounded-lg hover:bg-off-white dark:hover:bg-charcoal text-medium-gray"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-dark-gray dark:text-white">Recording Storage</h1>
          <p className="text-sm text-medium-gray">
            {stats == null
              ? 'Unable to load storage info.'
              : stats.storageType === 's3'
              ? 'Recordings are stored in S3. Usage below is from the database.'
              : 'Recordings are stored on the local server. View usage and delete test recordings here.'}
          </p>
        </div>
      </div>

      {stats && (
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
          <h2 className="font-semibold text-dark-gray dark:text-white mb-4 flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-orange" />
            Storage usage
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <div>
              <p className="text-2xl font-bold text-dark-gray dark:text-white">
                {stats.recordings ? `${stats.recordings.totalMB} MB` : `${stats.localStorage.totalMB} MB`}
              </p>
              <p className="text-sm text-medium-gray">Total recordings size</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-dark-gray dark:text-white">
                {stats.recordings?.count ?? stats.localStorage.fileCount}
              </p>
              <p className="text-sm text-medium-gray">Recordings</p>
            </div>
            <div>
              <p className="text-sm font-medium text-dark-gray dark:text-white">
                {stats.storageType === 's3' ? 'S3 bucket' : 'Local server'}
              </p>
              <p className="text-sm text-medium-gray">Where stored</p>
            </div>
            <div>
              <p className="text-sm font-mono text-medium-gray truncate" title={stats.localStorage.path}>
                {stats.storageType === 's3' ? '–' : stats.localStorage.path}
              </p>
              <p className="text-sm text-medium-gray">Location / path</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-medium-gray">
            Storage type: <strong>{stats.storageType === 's3' ? 'S3' : 'Local server'}</strong>
            {stats.storageType === 'local' && ` • Path: ${stats.localStorage.path}`}
          </p>
        </div>
      )}

      <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
        <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20 flex items-center gap-2">
          <FileAudio className="w-5 h-5 text-orange" />
          <h2 className="font-semibold text-dark-gray dark:text-white">Recordings</h2>
        </div>
        {/* Desktop table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-off-white dark:border-medium-gray/20">
                <th className="text-left px-6 py-3 text-medium-gray font-medium">Meeting date</th>
                <th className="text-left px-6 py-3 text-medium-gray font-medium">Employee</th>
                <th className="text-left px-6 py-3 text-medium-gray font-medium">Reporter</th>
                <th className="text-left px-6 py-3 text-medium-gray font-medium">Status</th>
                <th className="text-left px-6 py-3 text-medium-gray font-medium">Size</th>
                <th className="text-left px-6 py-3 text-medium-gray font-medium">Recorded</th>
                <th className="text-right px-6 py-3 text-medium-gray font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {recordings.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-medium-gray">
                    No recordings yet
                  </td>
                </tr>
              ) : (
                recordings.map((r) => (
                  <tr key={r.id} className="border-b border-off-white dark:border-medium-gray/20 even:bg-off-white/40 dark:even:bg-charcoal/40 hover:bg-off-white/70 dark:hover:bg-charcoal/60 transition-colors">
                    <td className="px-6 py-3 text-dark-gray dark:text-white">
                      {formatDate(r.meetingDate)}
                    </td>
                    <td className="px-6 py-3 text-dark-gray dark:text-white">{r.employeeName ?? '–'}</td>
                    <td className="px-6 py-3 text-dark-gray dark:text-white">{r.reporterName ?? '–'}</td>
                    <td className="px-6 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          r.status === 'COMPLETED'
                            ? 'bg-green-500/10 text-green-600'
                            : r.status === 'FAILED'
                            ? 'bg-red-500/10 text-red-600'
                            : 'bg-blue-500/10 text-blue-600'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-medium-gray">{formatBytes(r.fileSize)}</td>
                    <td className="px-6 py-3 text-medium-gray">
                      {r.recordedAt ? f.dateTime(r.recordedAt, 'short') : '–'}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <Link
                        href={`/meetings/${r.meetingId}`}
                        className="text-orange hover:underline mr-2"
                      >
                        View
                      </Link>
                      <button
                        onClick={() => handleDelete(r.meetingId)}
                        disabled={deletingId === r.meetingId}
                        className="inline-flex items-center gap-1 text-red-500 hover:text-red-600 disabled:opacity-50"
                      >
                        {deletingId === r.meetingId ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="sm:hidden divide-y divide-off-white dark:divide-medium-gray/20">
          {recordings.length === 0 ? (
            <div className="p-6 text-center text-medium-gray">No recordings yet</div>
          ) : (
            recordings.map((r) => (
              <div key={r.id} className="p-4 space-y-2 even:bg-off-white/40 dark:even:bg-charcoal/40">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-dark-gray dark:text-white">{formatDate(r.meetingDate)}</p>
                    <p className="text-sm text-medium-gray">{r.employeeName ?? '–'}</p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      r.status === 'COMPLETED'
                        ? 'bg-green-500/10 text-green-600'
                        : r.status === 'FAILED'
                        ? 'bg-red-500/10 text-red-600'
                        : 'bg-blue-500/10 text-blue-600'
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-medium-gray">{formatBytes(r.fileSize)}</span>
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/meetings/${r.meetingId}`}
                      className="text-sm text-orange hover:underline"
                    >
                      View
                    </Link>
                    <button
                      onClick={() => handleDelete(r.meetingId)}
                      disabled={deletingId === r.meetingId}
                      className="inline-flex items-center gap-1 text-sm text-red-500 hover:text-red-600 disabled:opacity-50"
                    >
                      {deletingId === r.meetingId ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
