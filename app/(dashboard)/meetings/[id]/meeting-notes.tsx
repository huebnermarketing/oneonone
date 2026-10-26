'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { FileText, Save, Loader2 } from 'lucide-react'
import { useToast } from '@/components/ui/toast'

interface MeetingNotesProps {
  meetingId: string
  initialNotes: string | null
  canEdit: boolean
}

export function MeetingNotes({ meetingId, initialNotes, canEdit }: MeetingNotesProps) {
  const [notes, setNotes] = useState(initialNotes || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout>()
  const { toastError } = useToast()

  const saveNotes = useCallback(async () => {
    if (notes === initialNotes) return

    setSaving(true)
    setSaved(false)

    try {
      const response = await fetch(`/api/meetings/${meetingId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      })

      if (response.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } else {
        toastError('Failed to save notes')
      }
    } catch {
      toastError('Failed to save notes')
    } finally {
      setSaving(false)
    }
  }, [meetingId, notes, initialNotes, toastError])

  // Auto-save after 2 seconds of no typing
  useEffect(() => {
    if (notes === initialNotes || !canEdit) return

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      saveNotes()
    }, 2000)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [notes, initialNotes, canEdit, saveNotes])

  return (
    <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
      <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
            <FileText className="w-5 h-5 text-indigo-500" />
          </div>
          <div>
            <h2 className="font-semibold text-dark-gray dark:text-white">Meeting Notes</h2>
            <p className="text-sm text-medium-gray">
              {canEdit ? 'Add notes during or after the meeting' : 'Notes from this meeting'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saving && (
            <span className="flex items-center gap-1 text-sm text-medium-gray">
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </span>
          )}
          {saved && (
            <span className="flex items-center gap-1 text-sm text-green-500">
              <Save className="w-4 h-4" />
              Saved
            </span>
          )}
        </div>
      </div>
      <div className="p-6">
        {canEdit ? (
          <textarea
            id="meeting-notes"
            aria-label="Meeting notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add meeting notes here... (auto-saves as you type)"
            rows={6}
            className="w-full px-4 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-off-white dark:bg-charcoal text-dark-gray dark:text-white placeholder:text-medium-gray focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20 resize-none"
          />
        ) : notes ? (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <p className="whitespace-pre-wrap text-dark-gray dark:text-white">{notes}</p>
          </div>
        ) : (
          <p className="text-medium-gray text-center py-6">No notes for this meeting yet.</p>
        )}
      </div>
    </div>
  )
}
