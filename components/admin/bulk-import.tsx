'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, Download, FileSpreadsheet, Loader2, Upload, XCircle } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { Modal } from '@/components/ui/modal'
import { ImportPreview, initialFilter, type PreviewData, type PreviewFilter } from '@/components/admin/import-preview'
import { COLUMN_HELP, IMPORT_COLUMNS } from '@/lib/user-import-columns'
import { plural } from '@/lib/ui'
import { cn } from '@/lib/utils'

interface ImportResponse extends PreviewData {
  committed: boolean
  result?: { created: number; updated: number; promoted: number; departmentsCreated: number; deactivated?: number; failed: number }
  errorCsv?: string | null
}

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
  const [filter, setFilter] = useState<PreviewFilter>('all')
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
        setFilter(initialFilter(data))
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
        setFilter(initialFilter(data))
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

            <ImportPreview data={preview} done={!!done} filter={filter} onFilter={setFilter} />
          </div>
        )}
      </Modal>
    </>
  )
}
