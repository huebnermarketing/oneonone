'use client'

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CalendarClock, Check, Loader2, X } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { DatePicker } from '@/components/ui/date-picker'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-modal'
import { useFormat } from '@/components/providers/timezone-provider'
import { SlotGrid } from '@/components/forms/slot-grid'
import { DurationToggle } from '@/components/forms/duration-toggle'
import { buildFallbackSlots, isSlotInPast, type FreeSlot } from '@/lib/slots'
import { DEFAULT_WORKING_DAYS } from '@/lib/working-days'
import { formatDuration, toMeetingDuration, type MeetingDuration } from '@/lib/meeting-duration'

const btn = {
  primary:
    'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-dark-gray dark:bg-white text-white dark:text-dark-gray font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 transition-colors min-h-[40px]',
  outline:
    'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-light-gray/60 dark:border-medium-gray/40 bg-white dark:bg-charcoal text-dark-gray dark:text-white font-medium hover:bg-off-white dark:hover:bg-dark-gray disabled:opacity-50 transition-colors min-h-[40px]',
  ghost: 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-medium-gray hover:text-dark-gray dark:hover:text-white font-medium disabled:opacity-50 transition-colors min-h-[40px]',
}

interface DialogProps {
  open: boolean
  onClose: () => void
  meetingId: string
  /** Length the picker starts with */
  durationMinutes: number
  workingDays: number[]
  otherPartyName: string
  title: string
}

/** Pick a new date/time (+ length, optional reason) and send a reschedule request. */
function RescheduleDialog({ open, onClose, meetingId, durationMinutes, workingDays, otherPartyName, title }: DialogProps) {
  const router = useRouter()
  const f = useFormat()
  const { toastError, toastSuccess } = useToast()
  const slotsHeadingId = useId()
  const reasonId = useId()
  const [duration, setDuration] = useState<MeetingDuration>(toMeetingDuration(durationMinutes))
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [reason, setReason] = useState('')
  const [slots, setSlots] = useState<FreeSlot[]>([])
  const [loading, setLoading] = useState(false)
  const [calendarUnavailable, setCalendarUnavailable] = useState(false)
  const [dayMessage, setDayMessage] = useState('')
  const [hoursLabel, setHoursLabel] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const today = f.dateKey(new Date())

  const loadSlots = useCallback(
    async (day: string, minutes: number) => {
      setLoading(true)
      setSlots([])
      setTime('')
      setCalendarUnavailable(false)
      setDayMessage('')
      try {
        const res = await fetch(`/api/meetings/${meetingId}/availability?date=${encodeURIComponent(day)}&duration=${minutes}`)
        const data = await res.json()
        if (data.calendarUnavailable) setCalendarUnavailable(true)
        else {
          setSlots(data.slots ?? [])
          setHoursLabel(data.workingHoursLabel ?? null)
          if (data.dateUnavailable) setDayMessage(data.message || 'No meetings can be booked on this day.')
        }
      } catch {
        toastError('Failed to load availability')
      } finally {
        setLoading(false)
      }
    },
    [meetingId, toastError]
  )

  useEffect(() => {
    if (open && date) void loadSlots(date, duration)
  }, [open, date, duration, loadSlots])

  const fallback = useMemo(() => (date && calendarUnavailable ? buildFallbackSlots(date, f.timeZone, undefined, undefined, duration) : []), [date, calendarUnavailable, f.timeZone, duration])
  const isPast = useCallback((iso: string) => date === today && isSlotInPast(iso), [date, today])

  const send = async () => {
    if (!time) return
    setSending(true)
    try {
      const res = await fetch(`/api/meetings/${meetingId}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingDate: time, durationMinutes: duration, reason: reason.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to send the request')
      toastSuccess(`Request sent. ${otherPartyName} needs to accept the new time.`)
      onClose()
      router.refresh()
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Failed to send the request')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={sending}
      size="lg"
      title={title}
      description={`${otherPartyName} will be asked to accept. The current time stays on both calendars until they do.`}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={sending} className={btn.ghost}>
            Cancel
          </button>
          <button type="button" onClick={send} disabled={sending || !time} className={btn.primary}>
            {sending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <CalendarClock className="w-4 h-4" aria-hidden="true" />}
            Send request
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <DurationToggle value={duration} onChange={setDuration} />
        <div className="max-w-xs">
          <DatePicker
            label="New date"
            value={date}
            onChange={setDate}
            min={today}
            placeholder="Pick a date"
            disabledWeekdays={[0, 1, 2, 3, 4, 5, 6].filter((d) => !workingDays.includes(d))}
          />
        </div>
        {date && (
          <div>
            <p id={slotsHeadingId} className="text-sm font-medium text-dark-gray dark:text-white mb-2">
              New time {hoursLabel && !calendarUnavailable && <span className="font-normal text-medium-gray">— {hoursLabel}</span>}
            </p>
            {loading ? (
              <p className="flex items-center gap-2 py-4 text-sm text-medium-gray" role="status">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Checking both calendars...
              </p>
            ) : calendarUnavailable ? (
              <>
                <p className="flex items-start gap-2 text-sm text-medium-gray mb-3">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                  Calendar busy times aren&apos;t available, so all slots in working hours are shown.
                </p>
                <SlotGrid slots={fallback} value={time || null} onChange={setTime} isPast={isPast} aria-labelledby={slotsHeadingId} />
              </>
            ) : (
              <SlotGrid
                slots={slots}
                value={time || null}
                onChange={setTime}
                isPast={isPast}
                aria-labelledby={slotsHeadingId}
                emptyMessage={<p className="py-4 text-sm text-medium-gray">{dayMessage || 'No free time on both calendars that day. Try another day.'}</p>}
              />
            )}
          </div>
        )}
        <div>
          <label htmlFor={reasonId} className="block text-sm font-medium text-dark-gray dark:text-white mb-1.5">
            Reason <span className="font-normal text-medium-gray">(optional)</span>
          </label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="e.g. Client call moved into this slot"
            className="w-full rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal px-3 py-2 text-sm text-dark-gray dark:text-white placeholder:text-medium-gray focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20"
          />
        </div>
      </div>
    </Modal>
  )
}

interface CommonProps {
  meetingId: string
  durationMinutes: number
  workingDays?: number[]
  otherPartyName: string
}

/** Header action on a SCHEDULED meeting (participants only, no pending request). */
export function RescheduleButton({ meetingId, durationMinutes, workingDays = DEFAULT_WORKING_DAYS, otherPartyName }: CommonProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btn.outline}>
        <CalendarClock className="w-5 h-5" aria-hidden="true" />
        Reschedule
      </button>
      {open && (
        <RescheduleDialog
          open
          onClose={() => setOpen(false)}
          meetingId={meetingId}
          durationMinutes={durationMinutes}
          workingDays={workingDays}
          otherPartyName={otherPartyName}
          title="Reschedule meeting"
        />
      )}
    </>
  )
}

interface BannerProps extends CommonProps {
  /** Pending request */
  newDate: string
  newDurationMinutes: number
  requestedByName: string
  reason: string | null
  /** 'requester' asked, 'responder' must answer, 'viewer' (admin) only sees it */
  role: 'requester' | 'responder' | 'viewer'
}

/** "Reschedule pending" card: accept / decline / counter for the other side, change / withdraw for the requester. */
export function RescheduleBanner({ meetingId, durationMinutes, workingDays = DEFAULT_WORKING_DAYS, otherPartyName, newDate, newDurationMinutes, requestedByName, reason, role }: BannerProps) {
  const router = useRouter()
  const f = useFormat()
  const { toastError, toastSuccess } = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState<'accept' | 'drop' | null>(null)
  const [dialog, setDialog] = useState(false)

  const d = new Date(newDate)
  const when = `${f.meetingLong(d)} ${f.abbrev(d)}`

  const call = async (kind: 'accept' | 'drop') => {
    if (kind === 'drop') {
      const ok = await confirm(
        role === 'requester' ? 'Withdraw your reschedule request? The meeting stays at its current time.' : `Decline the new time? The meeting stays at its current time and ${requestedByName} is told.`,
        { title: role === 'requester' ? 'Withdraw request?' : 'Decline new time?', confirmText: role === 'requester' ? 'Withdraw' : 'Decline', cancelText: 'Back' }
      )
      if (!ok) return
    }
    setBusy(kind)
    try {
      const res = await fetch(`/api/meetings/${meetingId}/reschedule${kind === 'accept' ? '/accept' : ''}`, { method: kind === 'accept' ? 'POST' : 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Something went wrong')
      toastSuccess(kind === 'accept' ? 'Meeting moved. Calendars updated.' : role === 'requester' ? 'Request withdrawn' : 'New time declined')
      router.refresh()
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-2xl bg-amber-500/10 border-2 border-amber-500/30 p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0" aria-hidden="true">
          <CalendarClock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-dark-gray dark:text-white text-lg">Reschedule pending</p>
          <p className="text-medium-gray mt-1">
            {role === 'requester' ? (
              <>You asked to move this meeting to <strong className="text-dark-gray dark:text-white">{when}</strong> ({formatDuration(newDurationMinutes)}). Waiting for {otherPartyName} to accept.</>
            ) : (
              <><strong className="text-dark-gray dark:text-white">{requestedByName}</strong> asked to move this meeting to <strong className="text-dark-gray dark:text-white">{when}</strong> ({formatDuration(newDurationMinutes)}).</>
            )}
          </p>
          {reason && <p className="mt-2 text-sm text-dark-gray dark:text-light-gray border-l-2 border-amber-500/40 pl-3">{reason}</p>}
          <p className="mt-2 text-xs text-medium-gray">The current time stays on both calendars until the new time is accepted.</p>

          {role !== 'viewer' && (
            <div className="flex flex-wrap gap-2 mt-4">
              {role === 'responder' ? (
                <>
                  <button type="button" onClick={() => call('accept')} disabled={!!busy} className={btn.primary}>
                    {busy === 'accept' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Check className="w-4 h-4" aria-hidden="true" />}
                    Accept new time
                  </button>
                  <button type="button" onClick={() => setDialog(true)} disabled={!!busy} className={btn.outline}>
                    Suggest another time
                  </button>
                  <button type="button" onClick={() => call('drop')} disabled={!!busy} className={btn.ghost}>
                    {busy === 'drop' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <X className="w-4 h-4" aria-hidden="true" />}
                    Decline
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setDialog(true)} disabled={!!busy} className={btn.outline}>
                    Change requested time
                  </button>
                  <button type="button" onClick={() => call('drop')} disabled={!!busy} className={btn.ghost}>
                    {busy === 'drop' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <X className="w-4 h-4" aria-hidden="true" />}
                    Withdraw request
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {dialog && (
        <RescheduleDialog
          open
          onClose={() => setDialog(false)}
          meetingId={meetingId}
          durationMinutes={role === 'responder' ? newDurationMinutes : durationMinutes}
          workingDays={workingDays}
          otherPartyName={otherPartyName}
          title={role === 'responder' ? 'Suggest another time' : 'Change requested time'}
        />
      )}
    </div>
  )
}
