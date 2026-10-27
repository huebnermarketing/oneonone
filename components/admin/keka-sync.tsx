'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { Modal } from '@/components/ui/modal'
import { ImportPreview, initialFilter, type PreviewData, type PreviewFilter } from '@/components/admin/import-preview'
import { useFormat } from '@/components/providers/timezone-provider'
import { plural } from '@/lib/ui'

interface SyncResponse extends PreviewData {
  committed: boolean
  skipped: { name: string; email: string; reason: string }[]
  leaversIgnored: number
  result?: { created: number; updated: number; deactivated: number; promoted: number; departmentsCreated: number; failed: number }
  lastSyncAt: string | null
}

const btnPrimary =
  'flex items-center gap-2 px-4 py-2 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 transition-colors'
const btnGhost = 'px-4 py-2 text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors disabled:opacity-50'

/**
 * Admin → "Sync from Keka". Preview what the sync would change, then apply. The first confirmed
 * sync switches on the daily automatic sync (cron).
 */
export function KekaSync() {
  const router = useRouter()
  const f = useFormat()
  const { toastError } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ configured: boolean; lastSyncAt: string | null } | null>(null)
  const [data, setData] = useState<SyncResponse | null>(null)
  const [filter, setFilter] = useState<PreviewFilter>('all')

  const openDialog = async () => {
    setOpen(true)
    setData(null)
    try {
      const res = await fetch('/api/admin/keka-sync')
      if (!res.ok) throw new Error()
      setStatus(await res.json())
    } catch {
      toastError('Could not load Keka sync status')
    }
  }

  const run = async (commit: boolean) => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/keka-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commit }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastError(body.error || 'Keka sync failed')
        return
      }
      setData(body)
      setFilter(initialFilter(body))
      if (commit) {
        setStatus((s) => (s ? { ...s, lastSyncAt: body.lastSyncAt } : s))
        router.refresh()
      }
    } catch {
      toastError('Keka sync failed')
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    setOpen(false)
    setData(null)
  }

  const done = data?.committed ? data : null
  const pending = data && !done ? data.summary.create + data.summary.update + data.promotions.length : 0

  const footer = done ? (
    <button type="button" onClick={close} className={btnPrimary}>Done</button>
  ) : (
    <>
      <button type="button" onClick={close} disabled={busy} className={btnGhost}>Cancel</button>
      {!data ? (
        <button type="button" onClick={() => run(false)} disabled={busy || !status?.configured} className={btnPrimary}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
          {busy ? 'Reading Keka…' : 'Preview changes'}
        </button>
      ) : (
        <button type="button" onClick={() => run(true)} disabled={busy || pending === 0} className={btnPrimary}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <CheckCircle className="w-4 h-4" aria-hidden="true" />}
          {busy ? 'Syncing…' : pending > 0 ? `Apply ${plural(pending, 'change')}` : 'Nothing to change'}
        </button>
      )}
    </>
  )

  const notes: React.ReactNode[] = []
  if (data?.skipped.length) {
    notes.push(
      <>
        <span className="text-medium-gray">Not imported:</span> {data.skipped.map((s) => `${s.name} (${s.reason.toLowerCase()})`).join(', ')}
      </>
    )
  }
  if (data?.leaversIgnored) notes.push(<span className="text-medium-gray">{plural(data.leaversIgnored, 'former employee')} in Keka who never used the app — ignored</span>)

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="flex items-center gap-2 px-4 py-2 bg-off-white dark:bg-charcoal text-dark-gray dark:text-white rounded-xl font-medium hover:bg-light-gray/20 dark:hover:bg-dark-gray transition-colors"
      >
        <RefreshCw className="w-4 h-4" aria-hidden="true" />
        Sync from Keka
      </button>

      <Modal
        open={open}
        onClose={close}
        title="Sync users from Keka"
        description="Adds active Keka employees who aren't in the app, updates name, job title, department, manager, phone, country, employee number and joining date, and deactivates people who have left. Role, time zone and working hours stay as set in the app."
        size="xl"
        busy={busy}
        footer={footer}
      >
        <div className="space-y-4">
          {status && !status.configured && (
            <p className="text-sm text-red-600 dark:text-red-400">Keka is not configured on the server (KEKA_* environment variables).</p>
          )}
          {status?.configured && (
            <p className="text-sm text-medium-gray">
              {status.lastSyncAt
                ? `Last sync ${f.dateTime(status.lastSyncAt, 'short')}. Runs automatically every day.`
                : 'Never synced. After you apply the first sync, it runs automatically every day.'}
            </p>
          )}

          {done?.result && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2" role="status">
              <span className="flex items-center gap-2 font-medium text-dark-gray dark:text-white">
                <CheckCircle className="w-5 h-5 text-green-500" aria-hidden="true" />
                {done.result.created} added, {done.result.updated} updated
                {done.result.deactivated > 0 && `, ${done.result.deactivated} deactivated`}
                {done.result.promoted > 0 && `, ${done.result.promoted} promoted`}
              </span>
              {done.result.failed > 0 && (
                <span className="flex items-center gap-2 font-medium text-dark-gray dark:text-white">
                  <XCircle className="w-5 h-5 text-red-500" aria-hidden="true" />
                  {done.result.failed} skipped
                </span>
              )}
            </div>
          )}

          {data && <ImportPreview data={data} done={!!done} filter={filter} onFilter={setFilter} extraNotes={notes} lineLabel="#" />}
        </div>
      </Modal>
    </>
  )
}
