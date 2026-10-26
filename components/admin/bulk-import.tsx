'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileSpreadsheet, Loader2, CheckCircle, XCircle, Download } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { Modal } from '@/components/ui/modal'
import { plural } from '@/lib/ui'

interface ImportResult {
  success: number
  failed: number
  errors: string[]
}

export function BulkImport() {
  const router = useRouter()
  const { toastError } = useToast()
  const [isOpen, setIsOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [csvData, setCsvData] = useState<Record<string, string>[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const lines = text.split('\n').filter(line => line.trim())
      
      if (lines.length < 2) {
        toastError('CSV file must have at least a header row and one data row')
        return
      }

      const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
      const users = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
        const user: Record<string, string> = {}
        headers.forEach((header, index) => {
          user[header] = values[index] || ''
        })
        return user
      })

      setCsvData(users)
    } catch (error) {
      toastError('Failed to parse CSV file')
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleImport = async () => {
    if (csvData.length === 0) return

    setImporting(true)
    setResult(null)

    try {
      const response = await fetch('/api/admin/import-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ users: csvData }),
      })

      const data = await response.json()

      if (response.ok) {
        setResult(data)
        if (data.success > 0) {
          router.refresh()
        }
      } else {
        setResult({ success: 0, failed: csvData.length, errors: [data.error] })
      }
    } catch (error: unknown) {
      setResult({ success: 0, failed: csvData.length, errors: [error instanceof Error ? error.message : 'Unknown error'] })
    } finally {
      setImporting(false)
    }
  }

  const downloadTemplate = () => {
    const template = `name,email,role,department,reportsTo,title,phone
John Doe,john@whitelabeliq.com,EMPLOYEE,Engineering,jane@whitelabeliq.com,Software Engineer,+1234567890
Jane Smith,jane@whitelabeliq.com,REPORTER,Engineering,,Engineering Manager,+0987654321
Admin User,admin@whitelabeliq.com,SUPER_ADMIN,,,CEO,`

    const blob = new Blob([template], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'user-import-template.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const reset = () => {
    setCsvData([])
    setResult(null)
  }

  const close = () => {
    setIsOpen(false)
    reset()
  }

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
            Bulk Import Users
          </span>
        }
        description="Upload a CSV file to add multiple users"
        size="lg"
        busy={importing}
        footer={
          result ? (
            <button
              type="button"
              onClick={close}
              className="px-4 py-2 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white transition-colors"
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={close}
                disabled={importing}
                className="px-4 py-2 text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={importing || csvData.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 transition-colors"
              >
                {importing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" aria-hidden="true" />
                    Import {plural(csvData.length, 'User')}
                  </>
                )}
              </button>
            </>
          )
        }
      >
        <div className="space-y-6">
          {/* Template download */}
          <button
            type="button"
            onClick={downloadTemplate}
            className="flex items-center gap-2 text-sm text-blue-500 hover:underline"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            Download CSV template
          </button>

          {/* File upload */}
          <div className="border-2 border-dashed border-off-white dark:border-medium-gray/20 rounded-xl p-8 text-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden"
              aria-label="CSV file"
              tabIndex={-1}
            />
            <Upload className="w-12 h-12 text-light-gray mx-auto mb-4" aria-hidden="true" />
            <p className="text-dark-gray dark:text-white mb-2">
              Drop your CSV file here or{' '}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-blue-500 hover:underline"
              >
                browse
              </button>
            </p>
            <p className="text-sm text-medium-gray">
              Required columns: name, email. Optional: role, department, reportsTo, title, phone
            </p>
          </div>

          {/* Preview */}
          {csvData.length > 0 && !result && (
            <div>
              <h3 className="font-medium text-dark-gray dark:text-white mb-2">
                Preview ({plural(csvData.length, 'user')})
              </h3>
              <div className="max-h-48 overflow-y-auto border border-off-white dark:border-medium-gray/20 rounded-xl">
                <table className="w-full text-sm">
                  <thead className="bg-off-white dark:bg-charcoal sticky top-0">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left text-medium-gray">Name</th>
                      <th scope="col" className="px-3 py-2 text-left text-medium-gray">Email</th>
                      <th scope="col" className="px-3 py-2 text-left text-medium-gray">Role</th>
                      <th scope="col" className="px-3 py-2 text-left text-medium-gray">Department</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-off-white dark:divide-medium-gray/20">
                    {csvData.slice(0, 10).map((user, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 text-dark-gray dark:text-white">{user.name}</td>
                        <td className="px-3 py-2 text-medium-gray">{user.email}</td>
                        <td className="px-3 py-2 text-medium-gray">{user.role || 'EMPLOYEE'}</td>
                        <td className="px-3 py-2 text-medium-gray">{user.department || '—'}</td>
                      </tr>
                    ))}
                    {csvData.length > 10 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-2 text-center text-medium-gray">
                          ... and {csvData.length - 10} more
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-4" role="status">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-500" aria-hidden="true" />
                  <span className="text-dark-gray dark:text-white font-medium">{result.success} imported</span>
                </div>
                {result.failed > 0 && (
                  <div className="flex items-center gap-2">
                    <XCircle className="w-5 h-5 text-red-500" aria-hidden="true" />
                    <span className="text-dark-gray dark:text-white font-medium">{result.failed} failed</span>
                  </div>
                )}
              </div>
              {result.errors.length > 0 && (
                <div className="max-h-32 overflow-y-auto bg-red-500/5 border border-red-500/20 rounded-xl p-3">
                  {result.errors.map((error, i) => (
                    <p key={i} className="text-sm text-red-600 dark:text-red-400">{error}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
