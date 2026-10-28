'use client'

import { useState, useEffect, useMemo, useId } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Plus,
  Clock,
  User,
  Repeat,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Loader2,
  Check,
  Pencil,
  X,
  AlertCircle,
} from 'lucide-react'
import { RecurringFrequency } from '@prisma/client'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-modal'
import { Select } from '@/components/ui/select'
import { Avatar } from '@/components/ui/avatar'
import { EmployeePicker } from '@/components/forms/employee-picker'
import { SlotGrid } from '@/components/forms/slot-grid'
import { DurationToggle } from '@/components/forms/duration-toggle'
import { DEFAULT_MEETING_DURATION, formatDuration, toMeetingDuration, type MeetingDuration } from '@/lib/meeting-duration'
import { useFormat } from '@/components/providers/timezone-provider'
import { DAY_NAMES, plural } from '@/lib/ui'
import { DEFAULT_WORKING_DAYS, WEEK_ORDER } from '@/lib/working-days'
import { DEFAULT_TIMEZONE } from '@/lib/dates'
import { formatTimeOfDay, getNextOccurrenceDate, slotToTimeInTz, type FreeSlot } from '@/lib/slots'

interface Employee {
  id: string
  name: string
  email: string
}

interface Schedule {
  id: string
  employeeId: string
  employee: Employee | null
  frequency: RecurringFrequency
  dayOfWeek: number
  timeOfDay: string
  durationMinutes: number
  isActive: boolean
  nextMeetingDate: string | null
  createdAt: string
  upcomingMeetingCount?: number
}

interface Props {
  employees: Employee[]
  initialSchedules: Schedule[]
  /** Admin → Settings → Policies → Working days */
  workingDays?: number[]
}

const frequencyLabels: Record<RecurringFrequency, string> = {
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Every 2 Weeks',
  MONTHLY: 'Monthly',
}

const frequencyOptions = (Object.keys(frequencyLabels) as RecurringFrequency[]).map((value) => ({ value, label: frequencyLabels[value] }))

const selectClass = 'bg-off-white dark:bg-dark-gray py-3 focus:ring-orange/50'

export function RecurringSchedulesClient({ employees, initialSchedules, workingDays = DEFAULT_WORKING_DAYS }: Props) {
  const router = useRouter()
  const { toastSuccess, toastError } = useToast()
  const confirm = useConfirm()
  const f = useFormat()
  const baseId = useId()
  const [schedules, setSchedules] = useState<Schedule[]>(initialSchedules)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState<{
    frequency: RecurringFrequency
    dayOfWeek: number
    timeOfDay: string
    durationMinutes: MeetingDuration
  } | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [editSlots, setEditSlots] = useState<FreeSlot[]>([])
  const [editSlotsLoading, setEditSlotsLoading] = useState(false)
  const [editWorkingHoursLabel, setEditWorkingHoursLabel] = useState<string | null>(null)
  const [editReporterTimeZone, setEditReporterTimeZone] = useState<string>(DEFAULT_TIMEZONE)
  const [formData, setFormData] = useState({
    employeeId: '',
    frequency: 'BIWEEKLY' as RecurringFrequency,
    dayOfWeek: workingDays.includes(1) ? 1 : workingDays[0] ?? 1,
    timeOfDay: '',
    durationMinutes: DEFAULT_MEETING_DURATION as MeetingDuration,
  })
  const [recurringAvailabilityLoading, setRecurringAvailabilityLoading] = useState(false)
  const [recurringAvailability, setRecurringAvailability] = useState<{
    available: boolean | null
    message: string | null
    calendarUnavailable: boolean
  } | null>(null)
  const [recurringSlots, setRecurringSlots] = useState<FreeSlot[]>([])
  const [recurringSlotsLoading, setRecurringSlotsLoading] = useState(false)
  const [recurringWorkingHoursLabel, setRecurringWorkingHoursLabel] = useState<string | null>(null)
  const [reporterTimeZone, setReporterTimeZone] = useState<string>(DEFAULT_TIMEZONE)

  // Create form: fetch slots when employee or day changes
  useEffect(() => {
    setFormData((prev) => ({ ...prev, timeOfDay: '' }))
    if (!formData.employeeId || formData.dayOfWeek == null) {
      setRecurringSlots([])
      setRecurringWorkingHoursLabel(null)
      return
    }
    let cancelled = false
    setRecurringSlotsLoading(true)
    setRecurringSlots([])
    // Which day's availability to fetch is decided on the VIEWER's calendar, not the browser's
    const date = getNextOccurrenceDate(formData.dayOfWeek, f.timeZone)
    fetch(`/api/meetings/availability?employeeId=${encodeURIComponent(formData.employeeId)}&date=${encodeURIComponent(date)}&duration=${formData.durationMinutes}`)
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
  }, [formData.employeeId, formData.dayOfWeek, formData.durationMinutes, f.timeZone, toastError])

  // Create form: check the first occurrence on both calendars once a time is picked
  useEffect(() => {
    if (!formData.employeeId || !formData.timeOfDay) {
      setRecurringAvailability(null)
      return
    }
    let cancelled = false
    setRecurringAvailabilityLoading(true)
    setRecurringAvailability(null)
    const params = new URLSearchParams({
      employeeId: formData.employeeId,
      dayOfWeek: String(formData.dayOfWeek),
      timeOfDay: formData.timeOfDay,
      frequency: formData.frequency,
      duration: String(formData.durationMinutes),
    })
    fetch(`/api/meetings/availability/recurring?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.message != null) {
          setRecurringAvailability({
            available: data.available ?? null,
            message: data.message,
            calendarUnavailable: data.calendarUnavailable ?? true,
          })
        }
      })
      .catch(() => {
        if (cancelled) return
        setRecurringAvailability(null)
        toastError('Failed to check availability')
      })
      .finally(() => { if (!cancelled) setRecurringAvailabilityLoading(false) })
    return () => { cancelled = true }
  }, [formData.employeeId, formData.dayOfWeek, formData.timeOfDay, formData.frequency, formData.durationMinutes, toastError])

  // Edit form: fetch available slots when the day changes
  useEffect(() => {
    if (!editingId || !editData) {
      setEditSlots([])
      setEditWorkingHoursLabel(null)
      return
    }
    const schedule = schedules.find((s) => s.id === editingId)
    if (!schedule) return

    let cancelled = false
    setEditSlotsLoading(true)
    setEditSlots([])
    setEditWorkingHoursLabel(null)
    const date = getNextOccurrenceDate(editData.dayOfWeek, f.timeZone)
    fetch(`/api/meetings/availability?employeeId=${encodeURIComponent(schedule.employeeId)}&date=${encodeURIComponent(date)}&duration=${editData.durationMinutes}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        if (!data.calendarUnavailable && Array.isArray(data.slots)) {
          setEditSlots(data.slots)
          setEditWorkingHoursLabel(data.workingHoursLabel ?? null)
          setEditReporterTimeZone(data.reporterTimeZone ?? DEFAULT_TIMEZONE)
        } else {
          setEditSlots([])
          setEditWorkingHoursLabel(null)
        }
      })
      .catch(() => {
        if (cancelled) return
        setEditSlots([])
        setEditWorkingHoursLabel(null)
        toastError('Failed to load available slots')
      })
      .finally(() => { if (!cancelled) setEditSlotsLoading(false) })
    return () => { cancelled = true }
    // Only re-fetch when the schedule being edited or its chosen day changes (frequency/time edits keep the slots)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, editData?.dayOfWeek, editData?.durationMinutes, f.timeZone, toastError])

  const availableEmployees = useMemo(
    () => employees.filter((emp) => !schedules.some((s) => s.employeeId === emp.id && s.isActive)),
    [employees, schedules]
  )

  // The grids work in slot instants; schedules store "HH:mm" in the reporter's zone
  const selectedCreateSlotIso = useMemo(
    () => recurringSlots.find((s) => slotToTimeInTz(s.start, reporterTimeZone) === formData.timeOfDay)?.start ?? null,
    [recurringSlots, reporterTimeZone, formData.timeOfDay]
  )
  const selectedEditSlotIso = useMemo(
    () => editSlots.find((s) => slotToTimeInTz(s.start, editReporterTimeZone) === editData?.timeOfDay)?.start ?? null,
    [editSlots, editReporterTimeZone, editData?.timeOfDay]
  )

  const handleCreate = async () => {
    if (!formData.employeeId) return
    setLoading(true)

    try {
      const response = await fetch('/api/recurring-schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (response.ok) {
        const data = await response.json()
        const employee = employees.find((e) => e.id === formData.employeeId)
        setSchedules([
          { ...data.schedule, employee },
          ...schedules,
        ])
        setShowForm(false)
        setFormData({
          employeeId: '',
          frequency: 'BIWEEKLY',
          dayOfWeek: workingDays.includes(1) ? 1 : workingDays[0] ?? 1,
          timeOfDay: '',
          durationMinutes: DEFAULT_MEETING_DURATION,
        })
        toastSuccess('Schedule created')
        router.refresh()
      } else {
        const error = await response.json()
        toastError(error.error || 'Failed to create schedule')
      }
    } catch {
      toastError('Failed to create schedule')
    } finally {
      setLoading(false)
    }
  }

  const startEditing = (schedule: Schedule) => {
    setEditingId(schedule.id)
    setEditData({
      frequency: schedule.frequency,
      dayOfWeek: schedule.dayOfWeek,
      timeOfDay: schedule.timeOfDay,
      durationMinutes: toMeetingDuration(schedule.durationMinutes),
    })
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditData(null)
  }

  const handleUpdate = async (scheduleId: string) => {
    if (!editData) return
    setEditLoading(true)

    try {
      const response = await fetch(`/api/recurring-schedules/${scheduleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editData),
      })

      if (response.ok) {
        const result = await response.json().catch(() => ({}))
        setSchedules(
          schedules.map((s) =>
            s.id === scheduleId ? { ...s, ...editData, nextMeetingDate: result.nextMeetingDate ?? s.nextMeetingDate } : s
          )
        )
        setEditingId(null)
        setEditData(null)
        const moved = Number(result.movedMeetingCount) || 0
        toastSuccess(moved > 0 ? `Schedule updated. ${plural(moved, 'upcoming meeting')} moved and calendars updated.` : 'Schedule updated')
        router.refresh()
      } else {
        const error = await response.json()
        toastError(error.error || 'Failed to update schedule')
      }
    } catch {
      toastError('Failed to update schedule')
    } finally {
      setEditLoading(false)
    }
  }

  const handleToggle = async (schedule: Schedule, isActive: boolean) => {
    if (isActive) {
      const ok = await confirm(
        'Pausing this schedule will stop future meetings from being auto-created.',
        { title: 'Pause schedule?', confirmText: 'Pause' }
      )
      if (!ok) return

      const upcoming = schedule.upcomingMeetingCount ?? 0
      let cancelFutureMeetings = false
      if (upcoming > 0) {
        cancelFutureMeetings = await confirm(
          `Do you also want to cancel ${upcoming} already-scheduled upcoming meeting(s)?`,
          {
            title: 'Cancel upcoming meetings?',
            confirmText: 'Yes, cancel them',
            cancelText: 'No, keep them',
          }
        )
      }

      try {
        const response = await fetch(`/api/recurring-schedules/${schedule.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: false, cancelFutureMeetings }),
        })

        if (response.ok) {
          const data = await response.json()
          setSchedules(
            schedules.map((s) =>
              s.id === schedule.id ? { ...s, isActive: false } : s
            )
          )
          const cancelled = (data as { cancelledMeetingCount?: number }).cancelledMeetingCount ?? 0
          if (cancelled > 0) {
            toastSuccess(`Schedule paused and ${cancelled} meeting(s) cancelled`)
          } else {
            toastSuccess('Schedule paused')
          }
          router.refresh()
        } else {
          const err = await response.json()
          toastError(err.error || 'Failed to update schedule')
        }
      } catch {
        toastError('Failed to update schedule')
      }
      return
    }

    try {
      const response = await fetch(`/api/recurring-schedules/${schedule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      })

      if (response.ok) {
        setSchedules(
          schedules.map((s) =>
            s.id === schedule.id ? { ...s, isActive: true } : s
          )
        )
        toastSuccess('Schedule resumed')
        router.refresh()
      } else {
        const err = await response.json().catch(() => ({}))
        toastError(err.error || 'Failed to resume schedule')
      }
    } catch {
      toastError('Failed to update schedule')
    }
  }

  const handleDelete = async (schedule: Schedule) => {
    const upcoming = schedule.upcomingMeetingCount ?? 0
    const message =
      upcoming > 0
        ? `This will delete the recurring schedule and cancel ${upcoming} upcoming meeting(s). Past and completed meetings will be kept. Continue?`
        : 'Are you sure you want to delete this recurring schedule?'
    if (!(await confirm(message, { variant: 'danger', confirmText: 'Delete', title: 'Delete schedule?' }))) return

    try {
      const response = await fetch(`/api/recurring-schedules/${schedule.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const err = await response.json()
        toastError(err.error || 'Failed to delete schedule')
        return
      }

      const data = await response.json()
      const cancelled = (data as { cancelledMeetingCount?: number }).cancelledMeetingCount ?? 0
      setSchedules(schedules.filter((s) => s.id !== schedule.id))
      if (cancelled > 0) {
        toastSuccess(`Schedule deleted. ${cancelled} meeting(s) cancelled.`)
      } else {
        toastSuccess('Schedule deleted')
      }
      router.refresh()
    } catch {
      toastError('Failed to delete schedule')
    }
  }

  const createSlotsHeadingId = `${baseId}-create-slots`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <Link
            href="/meetings"
            className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-off-white dark:hover:bg-dark-gray transition-colors"
            aria-label="Back to meetings"
          >
            <ArrowLeft className="w-5 h-5 text-medium-gray" aria-hidden="true" />
          </Link>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-dark-gray dark:text-white">
              Recurring Meetings
            </h1>
            <p className="text-sm text-medium-gray mt-0.5">
              Auto-schedule one-on-ones with your team
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          disabled={availableEmployees.length === 0}
          className="flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 transition-all text-sm sm:text-base min-h-[44px]"
        >
          <Plus className="w-5 h-5" aria-hidden="true" />
          <span className="hidden sm:inline">New Schedule</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-4 sm:p-6 space-y-4">
          <h3 className="font-semibold text-dark-gray dark:text-white">
            Create Recurring Schedule
          </h3>
          <EmployeePicker
            employees={availableEmployees}
            value={formData.employeeId || null}
            onChange={(id) => setFormData({ ...formData, employeeId: id })}
            title="Select Team Member"
            description="Search by name or email"
          />

          <DurationToggle value={formData.durationMinutes} onChange={(d) => setFormData({ ...formData, durationMinutes: d })} />

          {/* Frequency + Day */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${baseId}-frequency`} className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
                Frequency
              </label>
              <Select
                id={`${baseId}-frequency`}
                value={formData.frequency}
                onChange={(e) => setFormData({ ...formData, frequency: e.target.value as RecurringFrequency })}
                className={selectClass}
              >
                {frequencyOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </Select>
            </div>

            <div>
              <label htmlFor={`${baseId}-day`} className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
                Day
              </label>
              <Select
                id={`${baseId}-day`}
                value={formData.dayOfWeek}
                onChange={(e) => setFormData({ ...formData, dayOfWeek: parseInt(e.target.value, 10) })}
                className={selectClass}
              >
                {WEEK_ORDER.filter((d) => workingDays.includes(d)).map((d) => (
                  <option key={d} value={d}>{DAY_NAMES[d]}</option>
                ))}
              </Select>
            </div>
          </div>

          {formData.employeeId && formData.dayOfWeek != null && (
            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-4 sm:p-5">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-9 h-9 rounded-full bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center" aria-hidden="true">
                  <Clock className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                  <p id={createSlotsHeadingId} className="font-semibold text-dark-gray dark:text-white">Available time slots</p>
                  {recurringWorkingHoursLabel && (
                    <p className="text-sm text-medium-gray">{recurringWorkingHoursLabel}</p>
                  )}
                </div>
              </div>
              {recurringSlotsLoading ? (
                <p className="text-sm text-medium-gray flex items-center gap-2 mt-3" role="status">
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  Loading slots for next {DAY_NAMES[formData.dayOfWeek]}...
                </p>
              ) : (
                <SlotGrid
                  slots={recurringSlots}
                  value={selectedCreateSlotIso}
                  onChange={(iso) => setFormData({ ...formData, timeOfDay: slotToTimeInTz(iso, reporterTimeZone) })}
                  aria-labelledby={createSlotsHeadingId}
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

          {formData.employeeId && formData.timeOfDay && (
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
              onClick={() => setShowForm(false)}
              className="px-4 py-2.5 text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={loading || !formData.employeeId || !formData.timeOfDay}
              className="flex items-center gap-2 px-5 py-2.5 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 transition-all min-h-[44px]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  Creating...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" aria-hidden="true" />
                  Create Schedule
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Schedules List */}
      {schedules.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-12 text-center">
          <Repeat className="w-16 h-16 text-light-gray mx-auto mb-4" aria-hidden="true" />
          <h3 className="text-xl font-semibold text-dark-gray dark:text-white mb-2">
            No Recurring Schedules
          </h3>
          <p className="text-medium-gray max-w-md mx-auto">
            Set up recurring one-on-one meetings with your team members to stay connected regularly.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
          <div className="divide-y divide-off-white dark:divide-medium-gray/20">
            {schedules.map((schedule) => {
              const isEditing = editingId === schedule.id
              const editFrequencyId = `${baseId}-edit-frequency-${schedule.id}`
              const editDayId = `${baseId}-edit-day-${schedule.id}`
              const editSlotsHeadingId = `${baseId}-edit-slots-${schedule.id}`

              return (
                <div key={schedule.id} className={!schedule.isActive && !isEditing ? 'opacity-50' : ''}>
                  {/* View mode */}
                  {!isEditing ? (
                    <div className="flex items-center gap-3 sm:gap-4 p-4 sm:p-6">
                      {schedule.employee ? (
                        <Avatar name={schedule.employee.name} size="md" alt="" className="sm:w-12 sm:h-12 sm:text-base" />
                      ) : (
                        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0" aria-hidden="true">
                          <User className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-dark-gray dark:text-white truncate">
                          {schedule.employee?.name || 'Unknown'}
                        </p>
                        <p className="text-sm text-medium-gray">
                          {frequencyLabels[schedule.frequency]} · {DAY_NAMES[schedule.dayOfWeek]}s · {formatTimeOfDay(schedule.timeOfDay)} · {formatDuration(schedule.durationMinutes ?? 30)}
                        </p>
                        {schedule.nextMeetingDate && schedule.isActive && (
                          <p className="text-xs text-medium-gray mt-1 flex items-center gap-1">
                            <Clock className="w-3 h-3" aria-hidden="true" />
                            Next: {f.meetingShort(schedule.nextMeetingDate)}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEditing(schedule)}
                          className="p-2.5 hover:bg-off-white dark:hover:bg-dark-gray rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                          title="Edit schedule"
                          aria-label="Edit schedule"
                        >
                          <Pencil className="w-4 h-4 text-medium-gray" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggle(schedule, schedule.isActive)}
                          className="p-2.5 hover:bg-off-white dark:hover:bg-dark-gray rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                          title={schedule.isActive ? 'Pause schedule' : 'Resume schedule'}
                          aria-label={schedule.isActive ? 'Pause schedule' : 'Resume schedule'}
                          aria-pressed={schedule.isActive}
                        >
                          {schedule.isActive ? (
                            <ToggleRight className="w-6 h-6 text-green-500" aria-hidden="true" />
                          ) : (
                            <ToggleLeft className="w-6 h-6 text-medium-gray" aria-hidden="true" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(schedule)}
                          className="p-2.5 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                          title="Delete schedule"
                          aria-label="Delete schedule"
                        >
                          <Trash2 className="w-4 h-4 text-red-500" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Edit mode */
                    <div className="p-4 sm:p-6 bg-off-white/50 dark:bg-dark-gray/30">
                      <div className="flex items-center gap-3 mb-4">
                        {schedule.employee ? (
                          <Avatar name={schedule.employee.name} size="md" alt="" />
                        ) : (
                          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0" aria-hidden="true">
                            <User className="w-5 h-5 text-blue-500" />
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-dark-gray dark:text-white">
                            {schedule.employee?.name || 'Unknown'}
                          </p>
                          <p className="text-xs text-medium-gray">Editing schedule</p>
                        </div>
                      </div>

                      <DurationToggle value={editData!.durationMinutes} onChange={(d) => setEditData({ ...editData!, durationMinutes: d })} />

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label htmlFor={editFrequencyId} className="block text-xs font-medium text-medium-gray mb-1.5">Frequency</label>
                          <Select
                            id={editFrequencyId}
                            value={editData?.frequency}
                            onChange={(e) => setEditData({ ...editData!, frequency: e.target.value as RecurringFrequency })}
                            className={selectClass}
                          >
                            {frequencyOptions.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </Select>
                        </div>

                        <div>
                          <label htmlFor={editDayId} className="block text-xs font-medium text-medium-gray mb-1.5">Day</label>
                          <Select
                            id={editDayId}
                            value={editData?.dayOfWeek}
                            onChange={(e) => setEditData({ ...editData!, dayOfWeek: parseInt(e.target.value, 10) })}
                            className={selectClass}
                          >
                            {WEEK_ORDER.filter((d) => workingDays.includes(d) || d === editData?.dayOfWeek).map((d) => (
                              <option key={d} value={d}>{DAY_NAMES[d]}</option>
                            ))}
                          </Select>
                        </div>
                      </div>

                      {/* Available time slots for edit */}
                      <div className="mt-4 rounded-xl border border-off-white dark:border-medium-gray/20 p-4">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center" aria-hidden="true">
                            <Clock className="w-4 h-4 text-purple-500" />
                          </div>
                          <div>
                            <p id={editSlotsHeadingId} className="text-sm font-semibold text-dark-gray dark:text-white">Available time slots</p>
                            {editWorkingHoursLabel && (
                              <p className="text-xs text-medium-gray">{editWorkingHoursLabel}</p>
                            )}
                          </div>
                        </div>
                        {editSlotsLoading ? (
                          <p className="text-sm text-medium-gray flex items-center gap-2" role="status">
                            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                            Loading slots for next {DAY_NAMES[editData?.dayOfWeek ?? 0]}...
                          </p>
                        ) : (
                          <SlotGrid
                            slots={editSlots}
                            value={selectedEditSlotIso}
                            onChange={(iso) => setEditData({ ...editData!, timeOfDay: slotToTimeInTz(iso, editReporterTimeZone) })}
                            aria-labelledby={editSlotsHeadingId}
                            className="grid-cols-3 sm:grid-cols-4 md:grid-cols-5"
                            emptyMessage={
                              <p className="text-sm text-medium-gray">
                                No free slots in overlapping working hours for that day. Try a different day.
                              </p>
                            }
                          />
                        )}
                      </div>

                      <div className="flex justify-end gap-2 mt-4">
                        <button
                          type="button"
                          onClick={cancelEditing}
                          disabled={editLoading}
                          className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors min-h-[44px] rounded-xl"
                        >
                          <X className="w-4 h-4" aria-hidden="true" />
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUpdate(schedule.id)}
                          disabled={editLoading}
                          className="flex items-center gap-1.5 px-5 py-2.5 text-sm bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 transition-all min-h-[44px]"
                        >
                          {editLoading ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                              Saving...
                            </>
                          ) : (
                            <>
                              <Check className="w-4 h-4" aria-hidden="true" />
                              Save Changes
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
