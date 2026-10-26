'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Calendar, Repeat, ArrowLeft, Loader2, Check, AlertCircle, Clock, Search, User, Video, MapPin } from 'lucide-react'
import { RecurringFrequency } from '@prisma/client'
import { NewMeetingForm } from './new-meeting-form'
import { useToast } from '@/components/ui/toast'
import { useFormat } from '@/components/providers/timezone-provider'

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const frequencyOptions: { value: RecurringFrequency; label: string }[] = [
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'BIWEEKLY', label: 'Every 2 weeks' },
  { value: 'MONTHLY', label: 'Monthly' },
]

interface FreeSlot { start: string; end: string }

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

function slotToTimeInTz(slotStartIso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(slotStartIso))
}

interface ScheduleMeetingClientProps {
  employees: Array<{ id: string; name: string; email: string }>
  currentUserId: string
}

type ScheduleType = 'one-time' | 'recurring'

export function ScheduleMeetingClient({ employees, currentUserId }: ScheduleMeetingClientProps) {
  const router = useRouter()
  const { toastError } = useToast()
  const f = useFormat()
  const [scheduleType, setScheduleType] = useState<ScheduleType | null>(null)
  const [recurringLoading, setRecurringLoading] = useState(false)
  const [recurringForm, setRecurringForm] = useState({
    employeeId: '',
    frequency: 'BIWEEKLY' as RecurringFrequency,
    dayOfWeek: 1,
    timeOfDay: '',
    meetingType: 'IN_PERSON' as 'IN_PERSON' | 'ZOOM',
    meetingLink: '',
  })

  const [recurringSlots, setRecurringSlots] = useState<FreeSlot[]>([])
  const [recurringSlotsLoading, setRecurringSlotsLoading] = useState(false)
  const [recurringWorkingHoursLabel, setRecurringWorkingHoursLabel] = useState<string | null>(null)
  const [reporterTimeZone, setReporterTimeZone] = useState<string>('Asia/Kolkata')

  const [recurringEmployeeSearch, setRecurringEmployeeSearch] = useState('')

  const filteredRecurringEmployees = useMemo(() => {
    const q = recurringEmployeeSearch.trim().toLowerCase()
    if (!q) return employees
    return employees.filter(
      (e) => e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q)
    )
  }, [employees, recurringEmployeeSearch])

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
    const date = getNextOccurrenceDate(recurringForm.dayOfWeek)
    fetch(`/api/meetings/availability?employeeId=${encodeURIComponent(recurringForm.employeeId)}&date=${encodeURIComponent(date)}`)
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
  }, [recurringForm.employeeId, recurringForm.dayOfWeek])

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
    } finally {
      setRecurringAvailabilityLoading(false)
    }
  }, [recurringForm.employeeId, recurringForm.dayOfWeek, recurringForm.timeOfDay, recurringForm.frequency])

  useEffect(() => {
    if (recurringForm.employeeId && recurringForm.timeOfDay) {
      fetchRecurringAvailability()
    } else {
      setRecurringAvailability(null)
    }
  }, [recurringForm.employeeId, recurringForm.dayOfWeek, recurringForm.timeOfDay, recurringForm.frequency, fetchRecurringAvailability])

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
          <ArrowLeft className="w-4 h-4" />
          <span>Back to meetings</span>
        </button>

        <p className="text-medium-gray">Choose how you want to schedule:</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setScheduleType('one-time')}
            className="flex flex-col items-start gap-3 p-6 rounded-2xl border-2 border-light-gray/40 dark:border-medium-gray/40 hover:border-dark-gray dark:hover:border-white hover:bg-off-white/50 dark:hover:bg-charcoal/50 transition-all text-left"
          >
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
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
            <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
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
      <div className="max-w-2xl">
        <button
          type="button"
          onClick={() => setScheduleType(null)}
          className="flex items-center gap-2 text-medium-gray hover:text-dark-gray dark:hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
        <NewMeetingForm employees={employees} currentUserId={currentUserId} />
      </div>
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
        <ArrowLeft className="w-4 h-4" />
        <span>Back</span>
      </button>

      <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
        <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
            <Repeat className="w-5 h-5 text-green-500" />
          </div>
          <div>
            <h2 className="font-semibold text-dark-gray dark:text-white">Recurring schedule</h2>
            <p className="text-sm text-medium-gray">Meetings will be created automatically</p>
          </div>
        </div>

        <form onSubmit={handleRecurringSubmit} className="p-6 space-y-6">
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
                  value={recurringEmployeeSearch}
                  onChange={(e) => setRecurringEmployeeSearch(e.target.value)}
                  placeholder="Search by name or email..."
                  className="w-full pl-9 pr-4 py-2 rounded-xl border border-off-white dark:border-medium-gray/20 bg-off-white dark:bg-charcoal text-dark-gray dark:text-white placeholder:text-medium-gray focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20 text-sm"
                />
              </div>
            </div>
            <div className="p-3 overflow-y-auto min-h-0 flex-1">
              {employees.length === 0 ? (
                <div className="text-center py-4">
                  <User className="w-8 h-8 text-light-gray mx-auto mb-1" />
                  <p className="text-xs text-medium-gray">No team members available</p>
                </div>
              ) : filteredRecurringEmployees.length === 0 ? (
                <p className="text-xs text-medium-gray text-center py-3">No matches for &quot;{recurringEmployeeSearch}&quot;</p>
              ) : (
                <div className="grid gap-1.5">
                  {filteredRecurringEmployees.map((emp) => (
                    <button
                      key={emp.id}
                      type="button"
                      onClick={() => setRecurringForm({ ...recurringForm, employeeId: emp.id })}
                      className={`flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all ${
                        recurringForm.employeeId === emp.id
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
                      {recurringForm.employeeId === emp.id && (
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

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
                Frequency
              </label>
              <select
                value={recurringForm.frequency}
                onChange={(e) =>
                  setRecurringForm({ ...recurringForm, frequency: e.target.value as RecurringFrequency })
                }
                className="w-full rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal px-4 py-3 text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20"
              >
                {frequencyOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
                Day of week
              </label>
              <select
                value={recurringForm.dayOfWeek}
                onChange={(e) =>
                  setRecurringForm({ ...recurringForm, dayOfWeek: parseInt(e.target.value, 10) })
                }
                className="w-full rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal px-4 py-3 text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20"
              >
                {dayNames.map((day, i) => (
                  <option key={day} value={i}>
                    {day}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-2xl border border-off-white dark:border-medium-gray/20 p-4 sm:p-5">
            <p className="font-semibold text-dark-gray dark:text-white mb-3">Meeting type</p>
            <div className="flex gap-3 mb-4">
              <label className={`flex-1 flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${recurringForm.meetingType === 'IN_PERSON' ? 'border-dark-gray dark:border-white bg-dark-gray/5 dark:bg-white/5' : 'border-off-white dark:border-medium-gray/20'}`}>
                <input type="radio" name="recurringMeetingType" checked={recurringForm.meetingType === 'IN_PERSON'} onChange={() => setRecurringForm({ ...recurringForm, meetingType: 'IN_PERSON', meetingLink: '' })} className="sr-only" />
                <MapPin className="w-4 h-4 text-medium-gray" />
                <span className="text-sm font-medium text-dark-gray dark:text-white">In person</span>
              </label>
              <label className={`flex-1 flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${recurringForm.meetingType === 'ZOOM' ? 'border-dark-gray dark:border-white bg-dark-gray/5 dark:bg-white/5' : 'border-off-white dark:border-medium-gray/20'}`}>
                <input type="radio" name="recurringMeetingType" checked={recurringForm.meetingType === 'ZOOM'} onChange={() => setRecurringForm({ ...recurringForm, meetingType: 'ZOOM' })} className="sr-only" />
                <Video className="w-4 h-4 text-medium-gray" />
                <span className="text-sm font-medium text-dark-gray dark:text-white">Over Zoom</span>
              </label>
            </div>
            {recurringForm.meetingType === 'ZOOM' && (
              <div>
                <label className="block text-sm font-medium text-dark-gray dark:text-white mb-1.5">Meeting invite <span className="text-red-500">*</span></label>
                <input
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
                  Loading slots for next {dayNames[recurringForm.dayOfWeek]}...
                </p>
              ) : recurringSlots.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mt-3">
                  {recurringSlots.map((slot) => {
                    const timeInTz = slotToTimeInTz(slot.start, reporterTimeZone)
                    const isSelected = recurringForm.timeOfDay === timeInTz
                    return (
                      <button
                        key={slot.start}
                        type="button"
                        onClick={() => setRecurringForm({ ...recurringForm, timeOfDay: timeInTz })}
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

          {recurringForm.employeeId && recurringForm.timeOfDay && (
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
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
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
