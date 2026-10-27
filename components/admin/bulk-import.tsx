'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle, Download, FileSpreadsheet, Loader2, Upload, XCircle } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { Modal } from '@/components/ui/modal'
import { Pill, type PillTone } from '@/components/ui/pill'
import { COLUMN_HELP, IMPORT_COLUMNS } from '@/lib/user-import-columns'
import { plural } from '@/lib/ui'
import { cn } from '@/lib/utils'

type RowAction = 'create' | 'update' | 'unchanged' | 'error'

interface PreviewRow {
  line: number
  email: string
  name: string
  action: RowAction
  changes: string[]
  errors: string[]
  warnings: string[]
}

interface ImportResponse {
  summary: Record<RowAction, number>
  newDepartments: string[]
  promotions: { email: string; name: string }[]
  ignoredColumns: string[]
  rows: PreviewRow[]
  committed: boolean
  result?: { created: number; updated: number; promoted: number; departmentsCreated: number; failed: number }
  errorCsv?: string | null
}

const ACTION_META: Record<RowAction, { label: string; tone: PillTone }> = {
  create: { label: 'New', tone: 'green' },
  update: { label: 'Update', tone: 'blue' },
  unchanged: { label: 'No change', tone: 'neutral' },
  error: { label: 'Error', tone: 'red' },
}

type Filter = 'all' | RowAction

const btnPrimary =
  'flex items-center gap-2 px-4 py-2 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 transition-colors'
const btnGhost = 'px-4 py-2 text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors disabled:opacity-50'
const link = 'flex items-center gap-2 text-sm text-blue-500 hover:underline'

function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Admin → Bulk Import. Upload → server preview (per-row New / Update / No change / Error) → confirm.
 * The server re-plans on confirm, imports valid rows and returns an error report for the rest.
 */
export function BulkImport() {
  const router = useRouter()
  const { toastError } = useToast()
  const [isOpen, setIsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [csv, setCsv] = useState('')
  const [preview, setPreview] = useState<ImportResponse | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const done = preview?.committed ? preview : null

  const send = async (text: string, commit: boolean): Promise<ImportResponse | null> => {
    const res = await fetch('/api/admin/import-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: text, commit }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toastError(data.error || 'Import failed')
      return null
    }
    return data as ImportResponse
  }

  const loadFile = async (file: File | undefined) => {
    if (!file) return
    if (!/\.(csv|txt|tsv)$/i.test(file.name)) {
      toastError('Choose a .csv file (in Excel or Google Sheets: File → Download → CSV)')
      return
    }
    setBusy(true)
    try {
      const text = await file.text()
      const data = await send(text, false)
      if (data) {
        setCsv(text)
        setFileName(file.name)
        setPreview(data)
        setFilter(data.summary.error > 0 ? 'error' : 'all')
      }
    } catch {
      toastError('Could not read the file')
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const confirm = async () => {
    setBusy(true)
    try {
      const data = await send(csv, true)
      if (data) {
        setPreview(data)
        setFilter(data.summary.error > 0 ? 'error' : 'all')
        router.refresh()
      }
    } catch {
      toastError('Import failed')
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    setCsv('')
    setFileName('')
    setPreview(null)
    setFilter('all')
  }
  const close = () => {
    setIsOpen(false)
    reset()
  }

  const rows = useMemo(() => (preview ? preview.rows.filter((r) => filter === 'all' || r.action === filter) : []), [preview, filter])
  const toWrite = preview ? preview.summary.create + preview.summary.update : 0
  const canImport = !!preview && !done && (toWrite > 0 || preview.promotions.length > 0)

  const footer = done ? (
    <button type="button" onClick={close} className={btnPrimary}>Done</button>
  ) : preview ? (
    <>
      <button type="button" onClick={reset} disabled={busy} className={btnGhost}>Choose another file</button>
      <button type="button" onClick={confirm} disabled={busy || !canImport} className={btnPrimary}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />}
        {busy ? 'Importing…' : toWrite > 0 ? `Import ${plural(toWrite, 'user')}` : 'Apply promotions'}
      </button>
    </>
  ) : (
    <button type="button" onClick={close} className={btnGhost}>Cancel</button>
  )

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-off-white dark:bg-charcoal text-dark-gray dark:text-white rounded-xl font-medium hover:bg-light-gray/20 dark:hover:bg-dark-gray transition-colors"
      >
        <Upload className="w-4 h-4" aria-hidden="true" />
        Bulk Import
      </button>

      <Modal
        open={isOpen}
        onClose={close}
        title={
          <span className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-purple-500" aria-hidden="true" />
            </span>
            Import Users
          </span>
        }
        description="Add new users or update existing ones from a CSV. New emails are created; existing emails are updated; blank cells keep the current value."
        size="xl"
        busy={busy}
        footer={footer}
      >
        {!preview && (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <a href="/api/admin/import-users?format=template" className={link} download>
                <Download className="w-4 h-4" aria-hidden="true" />
                Download template
              </a>
              <a href="/api/admin/import-users?format=export" className={link} download>
                <Download className="w-4 h-4" aria-hidden="true" />
                Export current users (edit and re-upload to update)
              </a>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                loadFile(e.dataTransfer.files?.[0])
              }}
              className={cn(
                'border-2 border-dashed rounded-xl p-8 text-center transition-colors',
                dragging ? 'border-orange bg-orange/5' : 'border-off-white dark:border-medium-gray/20'
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.txt,text/csv"
                onChange={(e) => loadFile(e.target.files?.[0])}
                className="hidden"
                aria-label="CSV file"
                tabIndex={-1}
              />
              {busy ? (
                <Loader2 className="w-10 h-10 text-medium-gray mx-auto mb-3 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="w-10 h-10 text-light-gray mx-auto mb-3" aria-hidden="true" />
              )}
              <p className="text-dark-gray dark:text-white mb-1">
                {busy ? 'Checking file…' : 'Drop your CSV here or '}
                {!busy && (
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="text-blue-500 hover:underline">
                    browse
                  </button>
                )}
              </p>
              <p className="text-sm text-medium-gray">Nothing is saved until you review the preview and confirm.</p>
            </div>

            <details className="rounded-xl border border-off-white dark:border-medium-gray/20">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-dark-gray dark:text-white">Columns</summary>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-off-white dark:divide-medium-gray/20">
                  {IMPORT_COLUMNS.map((c) => (
                    <tr key={c}>
                      <td className="px-4 py-2 font-mono text-xs text-dark-gray dark:text-white whitespace-nowrap align-top">{c}</td>
                      <td className="px-4 py-2 text-medium-gray">
                        {COLUMN_HELP[c].required && (
                          <span className="text-orange font-medium">
                            {COLUMN_HELP[c].required === 'always' ? 'Required. ' : `Required for ${COLUMN_HELP[c].required}. `}
                          </span>
                        )}
                        {COLUMN_HELP[c].accepts}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-4 py-3 text-xs text-medium-gray">
                Header names are flexible (“First Name”, “Reports To”, “Dept” work). Users not in the file are left alone. Anyone who has a
                direct report becomes a Manager.
              </p>
            </details>
          </div>
        )}

        {preview && (
          <div className="space-y-4">
            {done?.result ? (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2" role="status">
                <span className="flex items-center gap-2 font-medium text-dark-gray dark:text-white">
                  <CheckCircle className="w-5 h-5 text-green-500" aria-hidden="true" />
                  {done.result.created} created, {done.result.updated} updated
                  {done.result.promoted > 0 && `, ${done.result.promoted} promoted`}
                  {done.result.departmentsCreated > 0 && `, ${plural(done.result.departmentsCreated, 'department')} added`}
                </span>
                {done.result.failed > 0 && (
                  <span className="flex items-center gap-2 font-medium text-dark-gray dark:text-white">
                    <XCircle className="w-5 h-5 text-red-500" aria-hidden="true" />
                    {done.result.failed} skipped
                  </span>
                )}
                {done.errorCsv && (
                  <button type="button" onClick={() => downloadText(done.errorCsv!, fileName.replace(/\.\w+$/, '') + '-errors.csv')} className={link}>
                    <Download className="w-4 h-4" aria-hidden="true" />
                    Download error report
                  </button>
                )}
              </div>
            ) : (
              <p className="text-sm text-medium-gray">
                <span className="font-medium text-dark-gray dark:text-white">{fileName}</span> — review before importing. Rows with errors are skipped;
                you’ll get a report to fix and re-upload them.
              </p>
            )}

            {(preview.newDepartments.length > 0 || preview.promotions.length > 0 || preview.ignoredColumns.length > 0) && (
              <ul className="text-sm space-y-1 rounded-xl bg-off-white/60 dark:bg-charcoal p-3">
                {preview.newDepartments.length > 0 && (
                  <li className="text-dark-gray dark:text-white">
                    <span className="text-medium-gray">{done ? 'Departments created:' : 'New departments:'}</span> {preview.newDepartments.join(', ')}
                  </li>
                )}
                {preview.promotions.length > 0 && (
                  <li className="text-dark-gray dark:text-white">
                    <span className="text-medium-gray">{done ? 'Promoted to Manager:' : 'Will become Manager (now has direct reports):'}</span>{' '}
                    {preview.promotions.map((p) => p.name || p.email).join(', ')}
                  </li>
                )}
                {preview.ignoredColumns.length > 0 && (
                  <li className="text-amber-600 dark:text-amber-400">Ignored columns: {preview.ignoredColumns.join(', ')}</li>
                )}
              </ul>
            )}

            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter rows">
              {(['all', 'create', 'update', 'unchanged', 'error'] as Filter[]).map((f) => {
                const count = f === 'all' ? preview.rows.length : preview.summary[f]
                if (f !== 'all' && count === 0) return null
                return (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={filter === f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                      filter === f ? 'bg-dark-gray text-white dark:bg-white dark:text-dark-gray' : 'text-medium-gray hover:bg-off-white dark:hover:bg-charcoal'
                    )}
                  >
                    {f === 'all' ? 'All' : ACTION_META[f].label} <span className="opacity-70">{count}</span>
                  </button>
                )
              })}
            </div>

            <div className="max-h-[45vh] overflow-y-auto border border-off-white dark:border-medium-gray/20 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-off-white dark:bg-charcoal sticky top-0">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left text-medium-gray w-14">Line</th>
                    <th scope="col" className="px-3 py-2 text-left text-medium-gray">User</th>
                    <th scope="col" className="px-3 py-2 text-left text-medium-gray w-28">Result</th>
                    <th scope="col" className="px-3 py-2 text-left text-medium-gray">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-off-white dark:divide-medium-gray/20">
                  {rows.map((r) => (
                    <tr key={r.line} className="align-top">
                      <td className="px-3 py-2 text-medium-gray tabular-nums">{r.line}</td>
                      <td className="px-3 py-2">
                        <div className="text-dark-gray dark:text-white">{r.name}</div>
                        {r.name !== r.email && <div className="text-xs text-medium-gray">{r.email}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <Pill tone={ACTION_META[r.action].tone}>{ACTION_META[r.action].label}</Pill>
                      </td>
                      <td className="px-3 py-2 space-y-1">
                        {r.errors.map((e, i) => (
                          <p key={`e${i}`} className="text-red-600 dark:text-red-400">{e}</p>
                        ))}
                        {r.action !== 'error' && r.changes.length > 0 && (
                          <p className="text-medium-gray">{r.action === 'create' ? 'Sets' : 'Changes'}: {r.changes.join(', ')}</p>
                        )}
                        {r.warnings.map((w, i) => (
                          <p key={`w${i}`} className="flex items-start gap-1 text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                            {w}
                          </p>
                        ))}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-medium-gray">No rows</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
