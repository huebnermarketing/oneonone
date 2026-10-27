'use client'

import { useState, useEffect, useCallback, useMemo, useId } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, Repeat, ArrowLeft, Loader2, Check, AlertCircle, Clock, Video, MapPin } from 'lucide-react'
import { RecurringFrequency } from '@prisma/client'
import { NewMeetingForm } from './new-meeting-form'
import { useToast } from '@/components/ui/toast'
import { Select } from '@/components/ui/select'
import { EmployeePicker } from '@/components/forms/employee-picker'
import { SlotGrid } from '@/components/forms/slot-grid'
import { useFormat } from '@/components/providers/timezone-provider'
import { DAY_NAMES } from '@/lib/ui'
import { DEFAULT_WORKING_DAYS, WEEK_ORDER } from '@/lib/working-days'
import { DEFAULT_TIMEZONE } from '@/lib/dates'
import { getNextOccurrenceDate, slotToTimeInTz, type FreeSlot } from '@/lib/slots'

const frequencyOptions: { value: RecurringFrequency; label: string }[] = [
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'BIWEEKLY', label: 'Every 2 weeks' },
  { value: 'MONTHLY', label: 'Monthly' },
]

interface ScheduleMeetingClientProps {
  /** Admin → Settings → Policies → Working days */
  workingDays?: number[]
  employees: Array<{ id: string; name: string; email: string }>
  currentUserId: string
  /** Viewer's work hours ("HH:mm") — passed through to the one-time form's fallback grid. */
  workDayStart?: string | null
  workDayEnd?: string | null
}

type ScheduleType = 'one-time' | 'recurring'

export function ScheduleMeetingClient({ employees, currentUserId, workDayStart, workDayEnd, workingDays = DEFAULT_WORKING_DAYS }: ScheduleMeetingClientProps) {
  const router = useRouter()
  const { toastError } = useToast()
  const f = useFormat()
  const frequencyId = useId()
  const dayOfWeekId = useId()
  const meetingLinkId = useId()
  const slotsHeadingId = useId()
  const [scheduleType, setScheduleType] = useState<ScheduleType | null>(null)
  const [recurringLoading, setRecurringLoading] = useState(false)
  const [recurringForm, setRecurringForm] = useState({
    employeeId: '',
    frequency: 'BIWEEKLY' as RecurringFrequency,
    dayOfWeek: workingDays.includes(1) ? 1 : workingDays[0] ?? 1,
    timeOfDay: '',
    meetingType: 'IN_PERSON' as 'IN_PERSON' | 'ZOOM',
    meetingLink: '',
  })

  const [recurringSlots, setRecurringSlots] = useState<FreeSlot[]>([])
  const [recurringSlotsLoading, setRecurringSlotsLoading] = useState(false)
  const [recurringWorkingHoursLabel, setRecurringWorkingHoursLabel] = useState<string | null>(null)
  const [reporterTimeZone, setReporterTimeZone] = useState<string>(DEFAULT_TIMEZONE)

  const [recurringAvailabilityLoading, setRecurringAvailabilityLoading] = useState(false)
  const [recurringAvailability, setRecurringAvailability] = useState<{
    available: boolean | null
    message: string | null
    calendarUnavailable: boolean
  } | null>(null)

  // Fetch slots when employee or day changes
  useEffect(() => {
    setRecurringForm((prev) => ({ ...prev, timeOfDay: '' }))
    if (!recurringForm.employeeId || recurringForm.dayOfWeek == null) {
      setRecurringSlots([])
      setRecurringWorkingHoursLabel(null)
      return
    }
    let cancelled = false
    setRecurringSlotsLoading(true)
    setRecurringSlots([])
    // Which day's availability to fetch is decided on the VIEWER's calendar, not the browser's
    const date = getNextOccurrenceDate(recurringForm.dayOfWeek, f.timeZone)
    fetch(`/api/meetings/availability?employeeId=${encodeURIComponent(recurringForm.employeeId)}&date=${encodeURIComponent(date)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        if (!data.calendarUnavailable && Array.isArray(data.slots)) {
          setRecurringSlots(data.slots)
          setRecurringWorkingHoursLabel(data.workingHoursLabel ?? null)
          setReporterTimeZone(data.reporterTimeZone ?? DEFAULT_TIMEZONE)
        } else {
          setRecurringSlots([])
          setRecurringWorkingHoursLabel(null)
        }
      })
      .catch(() => {
        if (cancelled) return
        setRecurringSlots([])
        setRecurringWorkingHoursLabel(null)
        toastError('Failed to load available slots')
      })
      .finally(() => { if (!cancelled) setRecurringSlotsLoading(false) })
    return () => { cancelled = true }
  }, [recurringForm.employeeId, recurringForm.dayOfWeek, f.timeZone, toastError])

  // Check first-occurrence availability when time is selected
  const fetchRecurringAvailability = useCallback(async () => {
    if (!recurringForm.employeeId || recurringForm.timeOfDay === '') return
    setRecurringAvailabilityLoading(true)
    setRecurringAvailability(null)
    try {
      const params = new URLSearchParams({
        employeeId: recurringForm.employeeId,
        dayOfWeek: String(recurringForm.dayOfWeek),
        timeOfDay: recurringForm.timeOfDay,
        frequency: recurringForm.frequency,
      })
      const res = await fetch(`/api/meetings/availability/recurring?${params}`)
      const data = await res.json()
      if (res.ok) {
        setRecurringAvailability({
          available: data.available ?? null,
          message: data.message ?? null,
          calendarUnavailable: data.calendarUnavailable ?? true,
        })
      }
    } catch {
      setRecurringAvailability(null)
      toastError('Failed to check availability')
    } finally {
      setRecurringAvailabilityLoading(false)
    }
  }, [recurringForm.employeeId, recurringForm.dayOfWeek, recurringForm.timeOfDay, recurringForm.frequency, toastError])

  useEffect(() => {
    if (recurringForm.employeeId && recurringForm.timeOfDay) {
      fetchRecurringAvailability()
    } else {
      setRecurringAvailability(null)
    }
  }, [recurringForm.employeeId, recurringForm.dayOfWeek, recurringForm.timeOfDay, recurringForm.frequency, fetchRecurringAvailability])

  // The grid works in slot instants; the schedule stores "HH:mm" in the reporter's zone
  const selectedSlotIso = useMemo(
    () => recurringSlots.find((s) => slotToTimeInTz(s.start, reporterTimeZone) === recurringForm.timeOfDay)?.start ?? null,
    [recurringSlots, reporterTimeZone, recurringForm.timeOfDay]
  )

  const handleRecurringSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!recurringForm.employeeId) return
    if (recurringForm.meetingType === 'ZOOM' && !recurringForm.meetingLink.trim()) {
      toastError('Please enter the Zoom meeting invite link.')
      return
    }
    setRecurringLoading(true)
    try {
      const res = await fetch('/api/recurring-schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...recurringForm,
          meetingLink: recurringForm.meetingType === 'ZOOM' && recurringForm.meetingLink.trim() ? recurringForm.meetingLink.trim() : undefined,
        }),
      })
      if (res.ok) {
        router.push('/meetings')
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        toastError(data.error || 'Failed to create recurring schedule')
      }
    } catch {
      toastError('Failed to create recurring schedule')
    } finally {
      setRecurringLoading(false)
    }
  }

  // Step 1: Choose type
  if (scheduleType === null) {
    return (
      <div className="max-w-2xl space-y-6">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-2 text-medium-gray hover:text-dark-gray dark:hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Back to meetings</span>
        </button>

        <p className="text-medium-gray">Choose how you want to schedule:</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setScheduleType('one-time')}
            className="flex flex-col items-start gap-3 p-6 rounded-2xl border-2 border-light-gray/40 dark:border-medium-gray/40 hover:border-dark-gray dark:hover:border-white hover:bg-off-white/50 dark:hover:bg-charcoal/50 transition-all text-left"
          >
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center" aria-hidden="true">
              <Calendar className="w-6 h-6 text-blue-500" />
            </div>
            <div>
              <h3 className="font-semibold text-dark-gray dark:text-white">One-time meeting</h3>
              <p className="text-sm text-medium-gray mt-1">Schedule a single one-on-one for a specific date and time.</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setScheduleType('recurring')}
            className="flex flex-col items-start gap-3 p-6 rounded-2xl border-2 border-light-gray/40 dark:border-medium-gray/40 hover:border-dark-gray dark:hover:border-white hover:bg-off-white/50 dark:hover:bg-charcoal/50 transition-all text-left"
          >
            <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center" aria-hidden="true">
              <Repeat className="w-6 h-6 text-green-500" />
            </div>
            <div>
              <h3 className="font-semibold text-dark-gray dark:text-white">Recurring schedule</h3>
              <p className="text-sm text-medium-gray mt-1">Set up weekly or bi-weekly one-on-ones that repeat automatically.</p>
            </div>
          </button>
        </div>
      </div>
    )
  }

  // Step 2a: One-time form
  if (scheduleType === 'one-time') {
    return (
      <NewMeetingForm
        employees={employees}
        currentUserId={currentUserId}
        workDayStart={workDayStart}
        workDayEnd={workDayEnd}
        workingDays={workingDays}
        onBack={() => setScheduleType(null)}
      />
    )
  }

  // Step 2b: Recurring form
  return (
    <div className="max-w-2xl space-y-8">
      <button
        type="button"
        onClick={() => setScheduleType(null)}
        className="flex items-center gap-2 text-medium-gray hover:text-dark-gray dark:hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        <span>Back</span>
      </button>

      <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
        <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center" aria-hidden="true">
            <Repeat className="w-5 h-5 text-green-500" />
          </div>
          <div>
            <h2 className="font-semibold text-dark-gray dark:text-white">Recurring schedule</h2>
            <p className="text-sm text-medium-gray">Meetings will be created automatically</p>
          </div>
        </div>

        <form onSubmit={handleRecurringSubmit} className="p-6 space-y-6">
          <EmployeePicker
            employees={employees}
            value={recurringForm.employeeId || null}
            onChange={(id) => setRecurringForm({ ...recurringForm, employeeId: id })}
            title="Select Team Member"
            description="Search by name or email"
          />

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label htmlFor={frequencyId} className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
                Frequency
              </label>
              <Select
                id={frequencyId}
                value={recurringForm.frequency}
                onChange={(e) => setRecurringForm({ ...recurringForm, frequency: e.target.value as RecurringFrequency })}
                className="py-3 text-base"
              >
                {frequencyOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label htmlFor={dayOfWeekId} className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
                Day of week
              </label>
              <Select
                id={dayOfWeekId}
                value={recurringForm.dayOfWeek}
                onChange={(e) => setRecurringForm({ ...recurringForm, dayOfWeek: parseInt(e.target.value, 10) })}
                className="py-3 text-base"
              >
                {WEEK_ORDER.filter((d) => workingDays.includes(d)).map((d) => (
                  <option key={d} value={d}>
                    {DAY_NAMES[d]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="rounded-2xl border border-off-white dark:border-medium-gray/20 p-4 sm:p-5">
            <p className="font-semibold text-dark-gray dark:text-white mb-3">Meeting type</p>
            <div className="flex gap-3 mb-4" role="radiogroup" aria-label="Meeting type">
              <label className={`flex-1 flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${recurringForm.meetingType === 'IN_PERSON' ? 'border-dark-gray dark:border-white bg-dark-gray/5 dark:bg-white/5' : 'border-off-white dark:border-medium-gray/20'}`}>
                <input type="radio" name="recurringMeetingType" checked={recurringForm.meetingType === 'IN_PERSON'} onChange={() => setRecurringForm({ ...recurringForm, meetingType: 'IN_PERSON', meetingLink: '' })} className="sr-only" />
                <MapPin className="w-4 h-4 text-medium-gray" aria-hidden="true" />
                <span className="text-sm font-medium text-dark-gray dark:text-white">In person</span>
              </label>
              <label className={`flex-1 flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${recurringForm.meetingType === 'ZOOM' ? 'border-dark-gray dark:border-white bg-dark-gray/5 dark:bg-white/5' : 'border-off-white dark:border-medium-gray/20'}`}>
                <input type="radio" name="recurringMeetingType" checked={recurringForm.meetingType === 'ZOOM'} onChange={() => setRecurringForm({ ...recurringForm, meetingType: 'ZOOM' })} className="sr-only" />
                <Video className="w-4 h-4 text-medium-gray" aria-hidden="true" />
                <span className="text-sm font-medium text-dark-gray dark:text-white">Over Zoom</span>
              </label>
            </div>
            {recurringForm.meetingType === 'ZOOM' && (
              <div>
                <label htmlFor={meetingLinkId} className="block text-sm font-medium text-dark-gray dark:text-white mb-1.5">Meeting invite <span className="text-red-500">*</span></label>
                <input
                  id={meetingLinkId}
                  type="url"
                  value={recurringForm.meetingLink}
                  onChange={(e) => setRecurringForm({ ...recurringForm, meetingLink: e.target.value })}
                  placeholder="https://zoom.us/j/..."
                  className="w-full rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal px-4 py-2.5 text-dark-gray dark:text-white placeholder:text-medium-gray focus:outline-none focus:ring-2 focus:ring-dark-gray/20 text-sm"
                />
                <p className="mt-1.5 text-xs text-medium-gray">Paste the Zoom meeting invite. Fathom recorder can join; the transcript will sync to each meeting automatically.</p>
              </div>
            )}
          </div>

          {recurringForm.employeeId && recurringForm.dayOfWeek != null && (
            <div className="rounded-2xl border border-off-white dark:border-medium-gray/20 p-4 sm:p-5">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-9 h-9 rounded-full bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center" aria-hidden="true">
                  <Clock className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                  <p id={slotsHeadingId} className="font-semibold text-dark-gray dark:text-white">Available time slots</p>
                  {recurringWorkingHoursLabel && (
                    <p className="text-sm text-medium-gray">{recurringWorkingHoursLabel}</p>
                  )}
                </div>
              </div>
              {recurringSlotsLoading ? (
                <p className="text-sm text-medium-gray flex items-center gap-2 mt-3" role="status">
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  Loading slots for next {DAY_NAMES[recurringForm.dayOfWeek]}...
                </p>
              ) : (
                <SlotGrid
                  slots={recurringSlots}
                  value={selectedSlotIso}
                  onChange={(iso) => setRecurringForm({ ...recurringForm, timeOfDay: slotToTimeInTz(iso, reporterTimeZone) })}
                  aria-labelledby={slotsHeadingId}
                  className="grid-cols-2 sm:grid-cols-3 md:grid-cols-4 mt-3"
                  emptyMessage={
                    <p className="text-sm text-medium-gray mt-3">
                      No free slots in overlapping working hours for that day. Try a different day.
                    </p>
                  }
                />
              )}
            </div>
          )}

          {recurringForm.employeeId && recurringForm.timeOfDay && (
            <div className="rounded-xl border border-off-white dark:border-medium-gray/20 p-3 sm:p-4 bg-off-white/30 dark:bg-dark-gray/30" role="status">
              {recurringAvailabilityLoading ? (
                <p className="text-sm text-medium-gray flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  Checking both calendars...
                </p>
              ) : recurringAvailability?.message ? (
                <p className={`text-sm flex items-center gap-2 ${
                  recurringAvailability.calendarUnavailable
                    ? 'text-medium-gray'
                    : recurringAvailability.available
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-amber-600 dark:text-amber-400'
                }`}>
                  {!recurringAvailability.calendarUnavailable && recurringAvailability.available === false && (
                    <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                  )}
                  {recurringAvailability.message}
                </p>
              ) : null}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setScheduleType(null)}
              className="px-6 py-3 rounded-xl text-medium-gray hover:text-dark-gray dark:hover:text-white hover:bg-off-white dark:hover:bg-charcoal transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={recurringLoading || !recurringForm.employeeId || !recurringForm.timeOfDay || (recurringForm.meetingType === 'ZOOM' && !recurringForm.meetingLink.trim())}
              className="px-6 py-3 rounded-xl bg-dark-gray dark:bg-white text-white dark:text-dark-gray font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
            >
              {recurringLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  Creating...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" aria-hidden="true" />
                  Create recurring schedule
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
