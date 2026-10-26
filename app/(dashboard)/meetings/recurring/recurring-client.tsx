'use client'

import { useState, useEffect, useMemo } from 'react'
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
  ChevronDown,
  AlertCircle,
  Search,
} from 'lucide-react'
import { RecurringFrequency } from '@prisma/client'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-modal'
import { useFormat } from '@/components/providers/timezone-provider'

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
  isActive: boolean
  nextMeetingDate: string | null
  createdAt: string
  upcomingMeetingCount?: number
}

interface Props {
  employees: Employee[]
  initialSchedules: Schedule[]
}

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const frequencyLabels: Record<RecurringFrequency, string> = {
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Every 2 Weeks',
  MONTHLY: 'Monthly',
}

function formatTime(time: string) {
  return new Date(`2000-01-01T${time}:00`).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

interface FreeSlot {
  start: string
  end: string
}

/** Get YYYY-MM-DD for the next occurrence of dayOfWeek (0-6) from today. */
function getNextOccurrenceDate(dayOfWeek: number): string {
  const now = new Date()
  const currentDay = now.getDay()
  let daysUntil = dayOfWeek - currentDay
  if (daysUntil < 0 || (daysUntil === 0 && now.getHours() >= 18)) daysUntil += 7
  const next = new Date(now)
  next.setDate(now.getDate() + daysUntil)
  const y = next.getFullYear()
  const m = String(next.getMonth() + 1).padStart(2, '0')
  const d = String(next.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Format slot start (ISO) to HH:mm in the given timezone. */
function slotToTimeInTz(slotStartIso: string, timeZone: string): string {
  const d = new Date(slotStartIso)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

export function RecurringSchedulesClient({ employees, initialSchedules }: Props) {
  const router = useRouter()
  const { toastSuccess, toastError } = useToast()
  const confirm = useConfirm()
  const f = useFormat()
  const [schedules, setSchedules] = useState<Schedule[]>(initialSchedules)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState<{
    frequency: RecurringFrequency
    dayOfWeek: number
    timeOfDay: string
  } | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [editSlots, setEditSlots] = useState<FreeSlot[]>([])
  const [editSlotsLoading, setEditSlotsLoading] = useState(false)
  const [editWorkingHoursLabel, setEditWorkingHoursLabel] = useState<string | null>(null)
  const [editReporterTimeZone, setEditReporterTimeZone] = useState<string>('Asia/Kolkata')
  const [formData, setFormData] = useState({
    employeeId: '',
    frequency: 'BIWEEKLY' as RecurringFrequency,
    dayOfWeek: 1,
    timeOfDay: '',
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
  const [reporterTimeZone, setReporterTimeZone] = useState<string>('Asia/Kolkata')
  const [employeeSearch, setEmployeeSearch] = useState('')

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
    const date = getNextOccurrenceDate(formData.dayOfWeek)
    fetch(`/api/meetings/availability?employeeId=${encodeURIComponent(formData.employeeId)}&date=${encodeURIComponent(date)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        if (!data.calendarUnavailable && Array.isArray(data.slots)) {
          setRecurringSlots(data.slots)
          setRecurringWorkingHoursLabel(data.workingHoursLabel ?? null)
          setReporterTimeZone(data.reporterTimeZone ?? 'Asia/Kolkata')
        } else {
          setRecurringSlots([])
          setRecurringWorkingHoursLabel(null)
        }
      })
      .finally(() => { if (!cancelled) setRecurringSlotsLoading(false) })
    return () => { cancelled = true }
  }, [formData.employeeId, formData.dayOfWeek])

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
      .catch(() => { if (!cancelled) setRecurringAvailability(null) })
      .finally(() => { if (!cancelled) setRecurringAvailabilityLoading(false) })
    return () => { cancelled = true }
  }, [formData.employeeId, formData.dayOfWeek, formData.timeOfDay, formData.frequency])

  // Fetch available slots when editing a schedule (employee + day change)
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
    // Clear time selection when day changes (keep it if only frequency changed)
    const date = getNextOccurrenceDate(editData.dayOfWeek)
    fetch(`/api/meetings/availability?employeeId=${encodeURIComponent(schedule.employeeId)}&date=${encodeURIComponent(date)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        if (!data.calendarUnavailable && Array.isArray(data.slots)) {
          setEditSlots(data.slots)
          setEditWorkingHoursLabel(data.workingHoursLabel ?? null)
          setEditReporterTimeZone(data.reporterTimeZone ?? 'Asia/Kolkata')
        } else {
          setEditSlots([])
          setEditWorkingHoursLabel(null)
        }
      })
      .finally(() => { if (!cancelled) setEditSlotsLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, editData?.dayOfWeek])

  const availableEmployees = employees.filter(
    (emp) => !schedules.some((s) => s.employeeId === emp.id && s.isActive)
  )

  const filteredAvailableEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase()
    if (!q) return availableEmployees
    return availableEmployees.filter(
      (e) => e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q)
    )
  }, [availableEmployees, employeeSearch])

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
        setEmployeeSearch('')
        setFormData({
          employeeId: '',
          frequency: 'BIWEEKLY',
          dayOfWeek: 1,
          timeOfDay: '',
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
        setSchedules(
          schedules.map((s) =>
            s.id === scheduleId ? { ...s, ...editData } : s
          )
        )
        setEditingId(null)
        setEditData(null)
        toastSuccess('Schedule updated')
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

  const selectClass = "w-full rounded-xl border border-off-white dark:border-medium-gray/20 bg-off-white dark:bg-dark-gray px-4 py-3 text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-orange/50 appearance-none pr-10 text-sm"

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
            <ArrowLeft className="w-5 h-5 text-medium-gray" />
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
          onClick={() => setShowForm(true)}
          disabled={availableEmployees.length === 0}
          className="flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 transition-all text-sm sm:text-base min-h-[44px]"
        >
          <Plus className="w-5 h-5" />
          <span className="hidden sm:inline">New Schedule</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-4 sm:p-6">
          <h3 className="font-semibold text-dark-gray dark:text-white mb-4">
            Create Recurring Schedule
          </h3>
          {/* Team Member search + list */}
          <div className="rounded-xl border border-off-white dark:border-medium-gray/20 overflow-hidden flex flex-col max-h-[280px]">
            <div className="px-4 py-3 border-b border-off-white dark:border-medium-gray/20 flex items-center gap-3 shrink-0">
              <div className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-blue-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-dark-gray dark:text-white text-sm">Select Team Member</p>
                <p className="text-xs text-medium-gray truncate">Search by name or email</p>
              </div>
            </div>
            <div className="px-3 py-2.5 border-b border-off-white dark:border-medium-gray/20 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-medium-gray pointer-events-none" />
                <input
                  type="text"
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                  placeholder="Search by name or email..."
                  className="w-full pl-9 pr-4 py-2 rounded-xl border border-off-white dark:border-medium-gray/20 bg-off-white dark:bg-charcoal text-dark-gray dark:text-white placeholder:text-medium-gray focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20 text-sm"
                />
              </div>
            </div>
            <div className="p-3 overflow-y-auto min-h-0 flex-1">
              {availableEmployees.length === 0 ? (
                <div className="text-center py-4">
                  <User className="w-8 h-8 text-light-gray mx-auto mb-1" />
                  <p className="text-xs text-medium-gray">No team members available</p>
                </div>
              ) : filteredAvailableEmployees.length === 0 ? (
                <p className="text-xs text-medium-gray text-center py-3">No matches for &quot;{employeeSearch}&quot;</p>
              ) : (
                <div className="grid gap-1.5">
                  {filteredAvailableEmployees.map((emp) => (
                    <button
                      key={emp.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, employeeId: emp.id })}
                      className={`flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all ${
                        formData.employeeId === emp.id
                          ? 'border-dark-gray dark:border-white bg-dark-gray/5 dark:bg-white/5'
                          : 'border-off-white dark:border-medium-gray/20 hover:border-medium-gray dark:hover:border-medium-gray/40'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full bg-off-white dark:bg-dark-gray flex items-center justify-center shrink-0">
                        <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                          {emp.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-dark-gray dark:text-white text-sm truncate">{emp.name}</p>
                        <p className="text-xs text-medium-gray truncate">{emp.email}</p>
                      </div>
                      {formData.employeeId === emp.id && (
                        <div className="w-5 h-5 rounded-full bg-dark-gray dark:bg-white flex items-center justify-center shrink-0">
                          <Check className="w-3 h-3 text-white dark:text-dark-gray" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Frequency + Day */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
                Frequency
              </label>
              <div className="relative">
                <select
                  value={formData.frequency}
                  onChange={(e) => setFormData({ ...formData, frequency: e.target.value as RecurringFrequency })}
                  className={selectClass}
                >
                  <option value="WEEKLY">Weekly</option>
                  <option value="BIWEEKLY">Every 2 Weeks</option>
                  <option value="MONTHLY">Monthly</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-medium-gray pointer-events-none" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
                Day
              </label>
              <div className="relative">
                <select
                  value={formData.dayOfWeek}
                  onChange={(e) => setFormData({ ...formData, dayOfWeek: parseInt(e.target.value) })}
                  className={selectClass}
                >
                  {dayNames.map((day, index) => (
                    <option key={day} value={index}>{day}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-medium-gray pointer-events-none" />
              </div>
            </div>
          </div>

          {formData.employeeId && formData.dayOfWeek != null && (
            <div className="mt-4 rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-4 sm:p-5">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-9 h-9 rounded-full bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                  <p className="font-semibold text-dark-gray dark:text-white">Available time slots</p>
                  {recurringWorkingHoursLabel && (
                    <p className="text-sm text-medium-gray">{recurringWorkingHoursLabel}</p>
                  )}
                </div>
              </div>
              {recurringSlotsLoading ? (
                <p className="text-sm text-medium-gray flex items-center gap-2 mt-3">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading slots for next {dayNames[formData.dayOfWeek]}...
                </p>
              ) : recurringSlots.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mt-3">
                  {recurringSlots.map((slot) => {
                    const timeInTz = slotToTimeInTz(slot.start, reporterTimeZone)
                    const isSelected = formData.timeOfDay === timeInTz
                    return (
                      <button
                        key={slot.start}
                        type="button"
                        onClick={() => setFormData({ ...formData, timeOfDay: timeInTz })}
                        className={`py-2.5 px-3 rounded-xl border text-sm font-medium transition-colors ${
                          isSelected
                            ? 'border-orange bg-orange/10 text-orange dark:bg-orange/20'
                            : 'border-off-white dark:border-medium-gray/20 hover:border-orange/50 text-dark-gray dark:text-white'
                        }`}
                      >
                        {f.time(slot.start)}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-medium-gray mt-3">
                  No free slots in overlapping working hours for that day. Try a different day.
                </p>
              )}
            </div>
          )}

          {formData.employeeId && formData.timeOfDay && (
            <div className="rounded-xl border border-off-white dark:border-medium-gray/20 p-3 sm:p-4 bg-off-white/30 dark:bg-dark-gray/30">
              {recurringAvailabilityLoading ? (
                <p className="text-sm text-medium-gray flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
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
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  )}
                  {recurringAvailability.message}
                </p>
              ) : null}
            </div>
          )}

          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={() => { setShowForm(false); setEmployeeSearch('') }}
              className="px-4 py-2.5 text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors min-h-[44px]"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={loading || !formData.employeeId || !formData.timeOfDay}
              className="flex items-center gap-2 px-5 py-2.5 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 transition-all min-h-[44px]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
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
          <Repeat className="w-16 h-16 text-light-gray mx-auto mb-4" />
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

              return (
                <div key={schedule.id} className={!schedule.isActive && !isEditing ? 'opacity-50' : ''}>
                  {/* View mode */}
                  {!isEditing ? (
                    <div className="flex items-center gap-3 sm:gap-4 p-4 sm:p-6">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                        <User className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-dark-gray dark:text-white truncate">
                          {schedule.employee?.name || 'Unknown'}
                        </p>
                        <p className="text-sm text-medium-gray">
                          {frequencyLabels[schedule.frequency]} · {dayNames[schedule.dayOfWeek]}s · {formatTime(schedule.timeOfDay)}
                        </p>
                        {schedule.nextMeetingDate && schedule.isActive && (
                          <p className="text-xs text-medium-gray mt-1 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Next: {f.meetingShort(schedule.nextMeetingDate)}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => startEditing(schedule)}
                          className="p-2.5 hover:bg-off-white dark:hover:bg-dark-gray rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                          title="Edit schedule"
                          aria-label="Edit schedule"
                        >
                          <Pencil className="w-4 h-4 text-medium-gray" />
                        </button>
                        <button
                          onClick={() => handleToggle(schedule, schedule.isActive)}
                          className="p-2.5 hover:bg-off-white dark:hover:bg-dark-gray rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                          title={schedule.isActive ? 'Pause schedule' : 'Resume schedule'}
                          aria-label={schedule.isActive ? 'Pause schedule' : 'Resume schedule'}
                        >
                          {schedule.isActive ? (
                            <ToggleRight className="w-6 h-6 text-green-500" />
                          ) : (
                            <ToggleLeft className="w-6 h-6 text-medium-gray" />
                          )}
                        </button>
                        <button
                          onClick={() => handleDelete(schedule)}
                          className="p-2.5 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                          title="Delete schedule"
                          aria-label="Delete schedule"
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Edit mode */
                    <div className="p-4 sm:p-6 bg-off-white/50 dark:bg-dark-gray/30">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                          <User className="w-5 h-5 text-blue-500" />
                        </div>
                        <div>
                          <p className="font-medium text-dark-gray dark:text-white">
                            {schedule.employee?.name || 'Unknown'}
                          </p>
                          <p className="text-xs text-medium-gray">Editing schedule</p>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="block text-xs font-medium text-medium-gray mb-1.5">Frequency</label>
                          <div className="relative">
                            <select
                              value={editData?.frequency}
                              onChange={(e) => setEditData({ ...editData!, frequency: e.target.value as RecurringFrequency })}
                              className={selectClass}
                            >
                              <option value="WEEKLY">Weekly</option>
                              <option value="BIWEEKLY">Every 2 Weeks</option>
                              <option value="MONTHLY">Monthly</option>
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-medium-gray pointer-events-none" />
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-medium-gray mb-1.5">Day</label>
                          <div className="relative">
                            <select
                              value={editData?.dayOfWeek}
                              onChange={(e) => setEditData({ ...editData!, dayOfWeek: parseInt(e.target.value) })}
                              className={selectClass}
                            >
                              {dayNames.map((day, index) => (
                                <option key={day} value={index}>{day}</option>
                              ))}
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-medium-gray pointer-events-none" />
                          </div>
                        </div>

                      </div>

                      {/* Available time slots for edit */}
                      <div className="mt-4 rounded-xl border border-off-white dark:border-medium-gray/20 p-4">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center">
                            <Clock className="w-4 h-4 text-purple-500" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-dark-gray dark:text-white">Available time slots</p>
                            {editWorkingHoursLabel && (
                              <p className="text-xs text-medium-gray">{editWorkingHoursLabel}</p>
                            )}
                          </div>
                        </div>
                        {editSlotsLoading ? (
                          <p className="text-sm text-medium-gray flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading slots for next {dayNames[editData?.dayOfWeek ?? 0]}...
                          </p>
                        ) : editSlots.length > 0 ? (
                          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                            {editSlots.map((slot) => {
                              const timeInTz = slotToTimeInTz(slot.start, editReporterTimeZone)
                              const isSelected = editData?.timeOfDay === timeInTz
                              return (
                                <button
                                  key={slot.start}
                                  type="button"
                                  onClick={() => setEditData({ ...editData!, timeOfDay: timeInTz })}
                                  className={`py-2 px-2 rounded-xl border text-sm font-medium transition-colors ${
                                    isSelected
                                      ? 'border-orange bg-orange/10 text-orange dark:bg-orange/20'
                                      : 'border-off-white dark:border-medium-gray/20 hover:border-orange/50 text-dark-gray dark:text-white'
                                  }`}
                                >
                                  {f.time(slot.start)}
                                </button>
                              )
                            })}
                          </div>
                        ) : (
                          <p className="text-sm text-medium-gray">
                            No free slots in overlapping working hours for that day. Try a different day.
                          </p>
                        )}
                      </div>

                      <div className="flex justify-end gap-2 mt-4">
                        <button
                          onClick={cancelEditing}
                          disabled={editLoading}
                          className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors min-h-[44px] rounded-xl"
                        >
                          <X className="w-4 h-4" />
                          Cancel
                        </button>
                        <button
                          onClick={() => handleUpdate(schedule.id)}
                          disabled={editLoading}
                          className="flex items-center gap-1.5 px-5 py-2.5 text-sm bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 transition-all min-h-[44px]"
                        >
                          {editLoading ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Saving...
                            </>
                          ) : (
                            <>
                              <Check className="w-4 h-4" />
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
