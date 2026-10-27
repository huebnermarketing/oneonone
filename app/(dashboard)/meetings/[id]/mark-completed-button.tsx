'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle } from 'lucide-react'
import { useToast } from '@/components/ui/toast'

import { FORM_REQUIRED_MESSAGE } from './messages'

export function MarkCompletedButton({
  meetingId,
  formSubmitted,
  requireFormBeforeComplete = true,
}: {
  meetingId: string
  formSubmitted: boolean
  requireFormBeforeComplete?: boolean
}) {
  const router = useRouter()
  const { toastError } = useToast()
  const [loading, setLoading] = useState(false)

  const blockedByForm = requireFormBeforeComplete && !formSubmitted

  const handleMarkCompleted = async () => {
    if (blockedByForm) {
      toastError(FORM_REQUIRED_MESSAGE)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/meetings/${meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update')
      }
      router.refresh()
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Failed to mark meeting as completed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // The "form required" hint is shown by the page under the whole action row (FORM_REQUIRED_MESSAGE)
  return (
      <button
        type="button"
        onClick={handleMarkCompleted}
        disabled={loading || blockedByForm}
        title={blockedByForm ? FORM_REQUIRED_MESSAGE : undefined}
        className="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] rounded-xl bg-green-500 text-white font-medium hover:bg-green-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <CheckCircle className="w-5 h-5" />
        {loading ? 'Updating...' : 'Mark meeting as completed'}
      </button>
  )
}
