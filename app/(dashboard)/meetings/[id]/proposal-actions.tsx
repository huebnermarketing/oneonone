'use client'

import { useState, useCallback, useEffect, useId } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Clock, Calendar, Loader2, AlertCircle } from 'lucide-react'
import { DatePicker } from '@/components/ui/date-picker'
import { useToast } from '@/components/ui/toast'
import { useFormat } from '@/components/providers/timezone-provider'
import { SlotGrid } from '@/components/forms/slot-grid'
import { isSlotInPast, type FreeSlot } from '@/lib/slots'

interface ProposalActionsProps {
  meetingId: string
  meetingDate: string
  proposedByName: string
  isReceiver: boolean
  isProposer: boolean
  otherPartyName: string
}

export function ProposalActions({
  meetingId,
  meetingDate,
  proposedByName,
  isReceiver,
  isProposer,
  otherPartyName,
}: ProposalActionsProps) {
  const router = useRouter()
  const { toastSuccess, toastError } = useToast()
  const f = useFormat()
  const slotsHeadingId = useId()
  const [accepting, setAccepting] = useState(false)
  const [showSuggest, setShowSuggest] = useState(false)
  const [suggestDate, setSuggestDate] = useState('')
  const [suggestTime, setSuggestTime] = useState('')
  const [submittingSuggest, setSubmittingSuggest] = useState(false)

  // Availability slots for suggest flow
  const [slots, setSlots] = useState<FreeSlot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [calendarUnavailable, setCalendarUnavailable] = useState(false)
  const [workingHoursLabel, setWorkingHoursLabel] = useState<string | null>(null)

  const meetingDateObj = new Date(meetingDate)
  const isPast = meetingDateObj.getTime() < Date.now()

  const formattedDate = `${f.meetingLong(meetingDateObj)} ${f.abbrev(meetingDateObj)}`

  const today = new Date()
  const minDate = f.dateKey(today)
  const isSuggestDateToday = suggestDate === minDate

  const handleAccept = async () => {
    setAccepting(true)
    try {
      const res = await fetch(`/api/meetings/${meetingId}/accept`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to accept')
      }
      toastSuccess('Meeting confirmed! Calendar event created.')
      router.refresh()
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'Failed to accept meeting')
    } finally {
      setAccepting(false)
    }
  }

  // Fetch real mutual availability for this meeting's participants
  const fetchSlots = useCallback(async (date: string) => {
    setSlotsLoading(true)
    setSlots([])
    setCalendarUnavailable(false)
    setWorkingHoursLabel(null)
    setSuggestTime('')

    try {
      const res = await fetch(
        `/api/meetings/${meetingId}/availability?date=${encodeURIComponent(date)}`
      )
      const data = await res.json()

      if (data.calendarUnavailable) {
        setCalendarUnavailable(true)
      } else {
        setSlots(data.slots ?? [])
        setWorkingHoursLabel(data.workingHoursLabel ?? null)
      }
    } catch {
      setCalendarUnavailable(true)
      toastError('Failed to load availability')
    } finally {
      setSlotsLoading(false)
    }
  }, [meetingId, toastError])

  useEffect(() => {
    if (suggestDate) {
      fetchSlots(suggestDate)
    }
  }, [suggestDate, fetchSlots])

  const handleSuggest = async () => {
    if (!suggestTime) {
      toastError('Please select a time slot')
      return
    }
    setSubmittingSuggest(true)
    try {
      const res = await fetch(`/api/meetings/${meetingId}/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingDate: suggestTime }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to suggest new time')
      }
      toastSuccess(isProposer ? 'Proposed time updated!' : 'New time suggested! Waiting for response.')
      setShowSuggest(false)
      router.refresh()
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'Failed to suggest new time')
    } finally {
      setSubmittingSuggest(false)
    }
  }

  const slotIsPast = useCallback((iso: string) => isSuggestDateToday && isSlotInPast(iso), [isSuggestDateToday])

  // Shared slot-picker UI used by both receiver and proposer panels
  const slotPicker = (
    <div className="space-y-4">
      <DatePicker
        label="Date"
        value={suggestDate}
        onChange={setSuggestDate}
        min={minDate}
        placeholder="Pick a date"
      />

      {suggestDate && (
        <div>
          <p id={slotsHeadingId} className="flex items-center gap-2 text-sm font-medium text-dark-gray dark:text-white mb-2">
            <Clock className="w-4 h-4 text-medium-gray" aria-hidden="true" />
            Select a time
            {workingHoursLabel && (
              <span className="font-normal text-medium-gray ml-1">
                — {workingHoursLabel}
              </span>
            )}
          </p>
          {slotsLoading ? (
            <div className="flex items-center gap-2 py-6 justify-center text-medium-gray" role="status">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              <span className="text-sm">Loading available slots...</span>
            </div>
          ) : calendarUnavailable ? (
            <div className="flex items-start gap-3 py-4 px-2">
              <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-sm text-medium-gray">
                Calendar not connected for one or both participants. Please connect Google Calendar to see mutual availability.
              </p>
            </div>
          ) : slots.length === 0 ? (
            <div className="text-center py-6">
              <Calendar className="w-10 h-10 text-light-gray mx-auto mb-2" />
              <p className="text-sm font-medium text-dark-gray dark:text-white mb-1">No available slots</p>
              <p className="text-sm text-medium-gray">Both calendars are fully booked on this date. Try another day.</p>
            </div>
          ) : (
            <SlotGrid
              slots={slots}
              value={suggestTime || null}
              onChange={setSuggestTime}
              isPast={slotIsPast}
              aria-labelledby={slotsHeadingId}
            />
          )}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={() => setShowSuggest(false)}
          className="px-4 py-2.5 text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors min-h-[44px]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSuggest}
          disabled={submittingSuggest || !suggestTime}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 transition-all min-h-[44px]"
        >
          {submittingSuggest ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Calendar className="w-4 h-4" />
          )}
          {isProposer ? 'Update Proposed Time' : 'Suggest This Time'}
        </button>
      </div>
    </div>
  )

  // Receiver view: can accept or suggest
  if (isReceiver) {
    return (
      <div className="space-y-4">
        <div className={`rounded-2xl ${isPast ? 'bg-red-500/10 border-2 border-red-500/30' : 'bg-amber-500/10 border-2 border-amber-500/30'} p-5 sm:p-6`}>
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-full ${isPast ? 'bg-red-500/20' : 'bg-amber-500/20'} flex items-center justify-center flex-shrink-0`}>
              <AlertCircle className={`w-6 h-6 ${isPast ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-dark-gray dark:text-white text-lg">
                {isPast ? 'Meeting Time Passed' : 'Meeting Request'}
              </p>
              <p className="text-medium-gray mt-1">
                <strong>{proposedByName}</strong> {isPast ? 'had proposed' : 'has proposed'} a one-on-one meeting for{' '}
                <strong>{formattedDate}</strong>.
              </p>
              {isPast ? (
                <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                  The proposed time has passed. You can suggest a new time below.
                </p>
              ) : (
                <p className="text-sm text-medium-gray mt-2">
                  Accept the proposed time or suggest an alternative.
                </p>
              )}

              <div className="flex flex-wrap gap-3 mt-4">
                {!isPast && (
                  <button
                    type="button"
                    onClick={handleAccept}
                    disabled={accepting}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 disabled:opacity-50 transition-all min-h-[44px]"
                  >
                    {accepting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    Accept
                  </button>
                )}
                <button
                  type="button"
                  aria-expanded={showSuggest}
                  onClick={() => setShowSuggest(!showSuggest)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-off-white dark:bg-dark-gray text-dark-gray dark:text-white rounded-xl font-medium hover:bg-dark-gray/10 dark:hover:bg-white/10 transition-all min-h-[44px]"
                >
                  <Clock className="w-4 h-4" />
                  Suggest New Time
                </button>
              </div>
            </div>
          </div>
        </div>

        {showSuggest && (
          <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-5 sm:p-6">
            <h3 className="font-semibold text-dark-gray dark:text-white mb-4">Suggest a different time</h3>
            {slotPicker}
          </div>
        )}
      </div>
    )
  }

  // Proposer view: waiting for response — can change time (cancel not allowed)
  if (isProposer) {
    return (
      <div className="space-y-4">
        <div className={`rounded-2xl ${isPast ? 'bg-red-500/10 border-2 border-red-500/30' : 'bg-blue-500/10 border-2 border-blue-500/30'} p-5 sm:p-6`}>
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-full ${isPast ? 'bg-red-500/20' : 'bg-blue-500/20'} flex items-center justify-center flex-shrink-0`}>
              <Clock className={`w-6 h-6 ${isPast ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-dark-gray dark:text-white text-lg">
                {isPast ? 'Proposed Time Passed' : 'Awaiting Response'}
              </p>
              <p className="text-medium-gray mt-1">
                You proposed this meeting for <strong>{formattedDate}</strong>.{' '}
                {isPast
                  ? `${otherPartyName} did not respond in time. You can suggest a new time below.`
                  : `Waiting for ${otherPartyName} to accept or suggest a new time.`}
              </p>
              {isPast && (
                <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                  The proposed time has passed. Please suggest a new time below.
                </p>
              )}

              <div className="flex flex-wrap gap-3 mt-4">
                <button
                  type="button"
                  aria-expanded={showSuggest}
                  onClick={() => setShowSuggest(!showSuggest)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-off-white dark:bg-dark-gray text-dark-gray dark:text-white rounded-xl font-medium hover:bg-dark-gray/10 dark:hover:bg-white/10 transition-all min-h-[44px]"
                >
                  <Clock className="w-4 h-4" />
                  Change Time
                </button>
              </div>
            </div>
          </div>
        </div>

        {showSuggest && (
          <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-5 sm:p-6">
            <h3 className="font-semibold text-dark-gray dark:text-white mb-4">Change proposed time</h3>
            {slotPicker}
          </div>
        )}
      </div>
    )
  }

  return null
}
