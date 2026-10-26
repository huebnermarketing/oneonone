'use client'

import { useState, useRef } from 'react'
import { Paperclip, Upload, File, Trash2, Download, Loader2, X, FileText, Image, FileArchive } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-modal'
import { useFormat } from '@/components/providers/timezone-provider'

interface Attachment {
  id: string
  fileName: string
  fileType: string
  fileSize: number
  createdAt: string
}

interface FileAttachmentsProps {
  meetingId: string
  initialAttachments: Attachment[]
  canUpload: boolean
}

const fileIcons: Record<string, typeof File> = {
  'image/': Image,
  'application/pdf': FileText,
  'application/zip': FileArchive,
  'application/x-zip': FileArchive,
}

function getFileIcon(fileType: string) {
  for (const [prefix, icon] of Object.entries(fileIcons)) {
    if (fileType.startsWith(prefix)) return icon
  }
  return File
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileAttachments({ meetingId, initialAttachments, canUpload }: FileAttachmentsProps) {
  const { toastError } = useToast()
  const f = useFormat()
  const confirm = useConfirm()
  const [attachments, setAttachments] = useState<Attachment[]>(initialAttachments)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uploadSingleFile = async (file: File): Promise<Attachment | null> => {
    if (file.size > 10 * 1024 * 1024) {
      toastError(`${file.name}: File size must be less than 10MB`)
      return null
    }

    const response = await fetch(`/api/meetings/${meetingId}/attachments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `Failed to upload ${file.name}`)
    }

    const { uploadUrl, attachmentId, skipUpload } = await response.json()

    if (uploadUrl && !skipUpload) {
      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('PUT', uploadUrl, true)
          xhr.setRequestHeader('Content-Type', file.type)
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage upload failed (${xhr.status})`))
          xhr.onerror = () => reject(new Error('Storage upload failed (network error)'))
          xhr.send(file)
        })
      } catch (err) {
        // Upload failed: remove the metadata row so no orphan attachment is listed
        await fetch(`/api/meetings/${meetingId}/attachments?attachmentId=${attachmentId}`, { method: 'DELETE' }).catch(() => {})
        throw err
      }
    }

    return {
      id: attachmentId,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      createdAt: new Date().toISOString(),
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setUploading(true)
    const uploaded: Attachment[] = []

    try {
      for (const file of Array.from(files)) {
        try {
          const attachment = await uploadSingleFile(file)
          if (attachment) uploaded.push(attachment)
        } catch (error: unknown) {
          toastError(error instanceof Error ? error.message : `Failed to upload ${file.name}`)
        }
      }
      if (uploaded.length > 0) {
        setAttachments((prev) => [...uploaded.reverse(), ...prev])
      }
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleDelete = async (attachmentId: string) => {
    if (!await confirm('Are you sure you want to delete this file?')) return

    setDeleting(attachmentId)

    try {
      const response = await fetch(
        `/api/meetings/${meetingId}/attachments?attachmentId=${attachmentId}`,
        { method: 'DELETE' }
      )

      if (response.ok) {
        setAttachments(attachments.filter((a) => a.id !== attachmentId))
      } else {
        const data = await response.json().catch(() => ({}))
        toastError(data.error || 'Failed to delete file')
      }
    } catch {
      toastError('Failed to delete file')
    } finally {
      setDeleting(null)
    }
  }

  const handleDownload = async (attachment: Attachment) => {
    setDownloading(attachment.id)
    try {
      const res = await fetch(
        `/api/meetings/${meetingId}/attachments?attachmentId=${attachment.id}`
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to get download link')
      }
      const { downloadUrl } = await res.json()
      // Fetch the file as blob so the download attribute is respected (cross-origin S3 URLs ignore it)
      const fileRes = await fetch(downloadUrl, { mode: 'cors' })
      if (!fileRes.ok) throw new Error('Failed to fetch file')
      const blob = await fileRes.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = attachment.fileName
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objectUrl)
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'Failed to download file')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
      <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center">
            <Paperclip className="w-5 h-5 text-teal-500" />
          </div>
          <div>
            <h2 className="font-semibold text-dark-gray dark:text-white">Attachments</h2>
            <p className="text-sm text-medium-gray">
              {attachments.length} file{attachments.length !== 1 ? 's' : ''} attached
            </p>
          </div>
        </div>
        {canUpload && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 bg-off-white dark:bg-charcoal text-dark-gray dark:text-white rounded-xl font-medium hover:bg-light-gray/20 dark:hover:bg-dark-gray disabled:opacity-50 transition-colors text-sm"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Upload
                </>
              )}
            </button>
          </>
        )}
      </div>
      {canUpload && (
        <div className="mx-6 mt-4 px-3 py-2.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-xs text-blue-600 dark:text-blue-400">
          Max 10 MB per file · Supported formats: Images, PDF, Word, Excel, PowerPoint, TXT, ZIP
        </div>
      )}
      <div className="p-6">
        {attachments.length === 0 ? (
          <div className="text-center py-8">
            <Paperclip className="w-12 h-12 text-light-gray mx-auto mb-3" />
            <p className="text-medium-gray">No files attached yet</p>
            {canUpload && (
              <p className="text-sm text-light-gray mt-1">
                Click Upload to add documents, images, or other files
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {attachments.map((attachment) => {
              const Icon = getFileIcon(attachment.fileType)

              return (
                <div
                  key={attachment.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-off-white dark:bg-charcoal group"
                >
                  <div className="w-10 h-10 rounded-lg bg-white dark:bg-charcoal flex items-center justify-center">
                    <Icon className="w-5 h-5 text-medium-gray" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-dark-gray dark:text-white truncate">
                      {attachment.fileName}
                    </p>
                    <p className="text-xs text-medium-gray">
                      {formatFileSize(attachment.fileSize)} •{' '}
                      {f.date(attachment.createdAt, 'short')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleDownload(attachment)}
                      disabled={downloading === attachment.id}
                      className="p-2 hover:bg-white dark:hover:bg-dark-gray rounded-lg transition-colors"
                      title="Download"
                    >
                      {downloading === attachment.id ? (
                        <Loader2 className="w-4 h-4 text-medium-gray animate-spin" />
                      ) : (
                        <Download className="w-4 h-4 text-medium-gray" />
                      )}
                    </button>
                    {canUpload && (
                      <button
                        onClick={() => handleDelete(attachment.id)}
                        disabled={deleting === attachment.id}
                        className="p-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                        title="Delete"
                      >
                        {deleting === attachment.id ? (
                          <Loader2 className="w-4 h-4 text-red-500 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4 text-red-500" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
