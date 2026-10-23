'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { XCircle, Loader2 } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-modal'

/**
 * Cancels a single PROPOSED/SCHEDULED meeting via POST /api/meetings/[id]/cancel.
 * Only rendered when the server page has already determined the viewer may cancel (cancelPolicy).
 */
export function CancelMeetingButton({ meetingId, otherPartyName }: { meetingId: string; otherPartyName: string }) {
  const router = useRouter()
  const { toastError, toastSuccess } = useToast()
  const confirm = useConfirm()
  const [loading, setLoading] = useState(false)

  const handleCancel = async () => {
    const ok = await confirm(
      `This will cancel the one-on-one with ${otherPartyName}, remove it from the calendar and notify them. This cannot be undone.`,
      { title: 'Cancel this meeting?', confirmText: 'Cancel meeting', cancelText: 'Keep it', variant: 'danger' }
    )
    if (!ok) return

    setLoading(true)
    try {
      const res = await fetch(`/api/meetings/${meetingId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to cancel meeting')
      toastSuccess('Meeting cancelled')
      router.refresh()
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Failed to cancel meeting')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleCancel}
      disabled={loading}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-red-500/30 text-red-600 dark:text-red-400 font-medium hover:bg-red-500/10 transition-colors disabled:opacity-60"
    >
      {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <XCircle className="w-5 h-5" />}
      {loading ? 'Cancelling...' : 'Cancel meeting'}
    </button>
  )
}
