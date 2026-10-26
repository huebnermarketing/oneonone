'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { useState, useMemo, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, Clock, User, ArrowLeft, Check, Search, Loader2, AlertCircle, Video, MapPin } from 'lucide-react'
import { DatePicker } from '@/components/ui/date-picker'
import { useToast } from '@/components/ui/toast'
import { useFormat } from '@/components/providers/timezone-provider'
import { startOfDayInTz } from '@/lib/dates'

const formSchema = z.object({
  employeeId: z.string().min(1, 'Please select a team member'),
  meetingDate: z.string().min(1, 'Please select a date'),
  meetingTime: z.string().min(1, 'Please select a time slot'),
})

type FormData = z.infer<typeof formSchema>

interface FreeSlot {
  start: string
  end: string
}

interface NewMeetingFormProps {
  employees: Array<{ id: string; name: string; email: string }>
  currentUserId: string
}

export function NewMeetingForm({ employees, currentUserId }: NewMeetingFormProps) {
  const router = useRouter()
  const { toastError, toastSuccess } = useToast()
  const f = useFormat()
  const [isLoading, setIsLoading] = useState(false)
  const [employeeSearch, setEmployeeSearch] = useState('')

  // Availability state
  const [slots, setSlots] = useState<FreeSlot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [calendarUnavailable, setCalendarUnavailable] = useState(false)
  const [calendarMessage, setCalendarMessage] = useState('')
  const [workingHoursLabel, setWorkingHoursLabel] = useState<string | null>(null)
  const [slotsFetched, setSlotsFetched] = useState(false)
  // Calendar status when an employee is selected (before date)
  const [calendarStatusLoading, setCalendarStatusLoading] = useState(false)
  const [calendarStatus, setCalendarStatus] = useState<{
    yourCalendarConnected: boolean
    employeeCalendarConnected: boolean
    employeeName: string | null
    message: string
  } | null>(null)
  const [meetingType, setMeetingType] = useState<'IN_PERSON' | 'ZOOM'>('IN_PERSON')
  const [meetingLink, setMeetingLink] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
  })

  const watchedEmployee = watch('employeeId')
  const watchedDate = watch('meetingDate')
  const watchedTime = watch('meetingTime')

  const selectedEmployee = useMemo(
    () => (watchedEmployee ? employees.find((e) => e.id === watchedEmployee) : null),
    [employees, watchedEmployee]
  )

  const formattedDateForSlots = useMemo(() => {
    if (!watchedDate) return ''
    return f.dateOnly(watchedDate, 'weekday')
  }, [watchedDate, f])

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase()
    if (!q) return employees
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q)
    )
  }, [employees, employeeSearch])

  // When user selects an employee, check that person's calendar connection status
  const fetchCalendarStatus = useCallback(async (employeeId: string) => {
    setCalendarStatusLoading(true)
    setCalendarStatus(null)
    try {
      const res = await fetch(`/api/meetings/availability?employeeId=${encodeURIComponent(employeeId)}`)
      const data = await res.json()
      if (res.ok) {
        setCalendarStatus({
          yourCalendarConnected: data.yourCalendarConnected ?? false,
          employeeCalendarConnected: data.employeeCalendarConnected ?? false,
          employeeName: data.employeeName ?? null,
          message: data.message ?? '',
        })
      }
    } catch {
      setCalendarStatus(null)
    } finally {
      setCalendarStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    if (watchedEmployee) {
      fetchCalendarStatus(watchedEmployee)
    } else {
      setCalendarStatus(null)
      setCalendarStatusLoading(false)
    }
  }, [watchedEmployee, fetchCalendarStatus])

  // Fetch availability when both employee and date are selected
  const fetchAvailability = useCallback(async (employeeId: string, date: string) => {
    setSlotsLoading(true)
    setSlots([])
    setSlotsFetched(false)
    setCalendarUnavailable(false)
    setCalendarMessage('')
    setValue('meetingTime', '')

    try {
      const res = await fetch(`/api/meetings/availability?employeeId=${encodeURIComponent(employeeId)}&date=${encodeURIComponent(date)}`)
      const data = await res.json()

      if (data.calendarUnavailable) {
        setCalendarUnavailable(true)
        setCalendarMessage(data.message || 'Calendar not connected.')
        setWorkingHoursLabel(null)
      } else {
        setSlots(data.slots ?? [])
        setWorkingHoursLabel(data.workingHoursLabel ?? null)
      }
      setSlotsFetched(true)
    } catch {
      toastError('Failed to load availability')
    } finally {
      setSlotsLoading(false)
    }
  }, [setValue, toastError])

  useEffect(() => {
    if (watchedEmployee && watchedDate) {
      fetchAvailability(watchedEmployee, watchedDate)
    } else {
      setSlots([])
      setSlotsFetched(false)
      setCalendarUnavailable(false)
      setWorkingHoursLabel(null)
    }
  }, [watchedEmployee, watchedDate, fetchAvailability])

  const onSubmit = async (data: FormData) => {
    if (meetingType === 'ZOOM' && !meetingLink.trim()) {
      toastError('Please enter the Zoom meeting invite link.')
      return
    }
    setIsLoading(true)
    try {
      const response = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: data.employeeId,
          meetingDate: data.meetingTime,
          meetingType,
          meetingLink: meetingType === 'ZOOM' ? meetingLink.trim() : undefined,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to propose meeting')
      }

      const meeting = await response.json()
      toastSuccess('Meeting proposal sent')
      router.push(`/meetings/${meeting.id}`)
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'Failed to propose meeting. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const today = new Date()
  const minDate = f.dateKey(today)

  const isToday = watchedDate === minDate

  function isSlotInPast(slotDate: Date) {
    return slotDate.getTime() <= Date.now()
  }

  return (
    <div className="max-w-4xl">
      <button
        type="button"
        onClick={() => router.back()}
        className="flex items-center gap-2 text-medium-gray hover:text-dark-gray dark:hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to meetings</span>
      </button>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-[1fr,1fr] items-start">
          {/* Left: Team Member with search + scrollable list */}
          <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden flex flex-col max-h-[520px]">
            <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20 flex items-center gap-3 shrink-0">
              <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                <User className="w-5 h-5 text-blue-500" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-dark-gray dark:text-white">Select Team Member</h2>
                <p className="text-sm text-medium-gray truncate">Search by name or email</p>
              </div>
            </div>
            <div className="p-4 border-b border-off-white dark:border-medium-gray/20 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-medium-gray pointer-events-none" />
                <input
                  type="text"
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                  placeholder="Search by name or email..."
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-off-white dark:border-medium-gray/20 bg-off-white dark:bg-charcoal text-dark-gray dark:text-white placeholder:text-medium-gray focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20 text-sm"
                />
              </div>
            </div>
            <div className="p-4 overflow-y-auto min-h-0 flex-1">
              {employees.length === 0 ? (
                <div className="text-center py-6">
                  <User className="w-10 h-10 text-light-gray mx-auto mb-2" />
                  <p className="text-sm text-medium-gray">No team members available</p>
                </div>
              ) : filteredEmployees.length === 0 ? (
                <p className="text-sm text-medium-gray text-center py-4">No matches for &quot;{employeeSearch}&quot;</p>
              ) : (
                <div className="grid gap-2">
                  {filteredEmployees.map((employee) => (
                    <label
                      key={employee.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        watchedEmployee === employee.id
                          ? 'border-dark-gray dark:border-white bg-dark-gray/5 dark:bg-white/5'
                          : 'border-off-white dark:border-medium-gray/20 hover:border-medium-gray dark:hover:border-medium-gray/40'
                      }`}
                    >
                      <input
                        type="radio"
                        {...register('employeeId')}
                        value={employee.id}
                        className="sr-only"
                      />
                      <div className="w-9 h-9 rounded-full bg-off-white dark:bg-dark-gray flex items-center justify-center shrink-0">
                        <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                          {employee.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-dark-gray dark:text-white text-sm truncate">{employee.name}</p>
                        <p className="text-xs text-medium-gray truncate">{employee.email}</p>
                      </div>
                      {watchedEmployee === employee.id && (
                        <div className="w-5 h-5 rounded-full bg-dark-gray dark:bg-white flex items-center justify-center shrink-0">
                          <Check className="w-3 h-3 text-white dark:text-dark-gray" />
                        </div>
                      )}
                    </label>
                  ))}
                </div>
              )}
              {errors.employeeId && (
                <p className="mt-3 text-sm text-red-500">{errors.employeeId.message}</p>
              )}
            </div>
          </div>

          {/* Right: Date, Available Slots, Submit */}
          <div className="space-y-6">
            {/* Calendar check: shown as soon as an employee is selected */}
            {watchedEmployee && (
              <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
                <div className="px-4 py-3 border-b border-off-white dark:border-medium-gray/20 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-blue-500 shrink-0" />
                  <span className="text-sm font-medium text-dark-gray dark:text-white">Calendar check</span>
                </div>
                <div className="p-4">
                  {calendarStatusLoading ? (
                    <div className="flex items-center gap-2 text-sm text-medium-gray">
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                      <span>Checking {selectedEmployee?.name ?? 'their'} calendar connection...</span>
                    </div>
                  ) : calendarStatus ? (
                    <div className="flex items-start gap-3">
                      {calendarStatus.yourCalendarConnected && calendarStatus.employeeCalendarConnected ? (
                        <Check className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                      )}
                      <p className="text-sm text-dark-gray dark:text-white">{calendarStatus.message}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            {/* Date picker card */}
            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-visible flex flex-col">
              <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <h2 className="font-semibold text-dark-gray dark:text-white">Pick a date</h2>
                  <p className="text-sm text-medium-gray">Available time slots will appear below</p>
                </div>
              </div>
              <div className="p-6">
                <DatePicker
                  label="Date"
                  value={watchedDate || ''}
                  onChange={(value) => setValue('meetingDate', value, { shouldValidate: true })}
                  min={minDate}
                  placeholder="Select meeting date"
                />
                {errors.meetingDate && (
                  <p className="mt-2 text-sm text-red-500">{errors.meetingDate.message}</p>
                )}
              </div>
            </div>

            {/* Time slots card (visible after date + employee selected) */}
            {watchedEmployee && watchedDate && (
              <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
                <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-purple-500" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-dark-gray dark:text-white">Available time slots</h2>
                    <p className="text-sm text-medium-gray">
                      {workingHoursLabel ?? 'Free on both calendars'}
                    </p>
                  </div>
                </div>
                <div className="p-4">
                  {slotsLoading ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-medium-gray">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="text-sm">
                        Checking {selectedEmployee?.name ?? 'their'} and your calendar for {formattedDateForSlots || 'this date'}...
                      </span>
                    </div>
                  ) : calendarUnavailable ? (
                    <div className="flex items-start gap-3 py-4 px-2">
                      <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-dark-gray dark:text-white mb-1">Calendar not connected</p>
                        <p className="text-sm text-medium-gray">{calendarMessage}</p>
                        <p className="text-sm text-medium-gray mt-2">You can still propose any time. The employee will be able to accept or suggest a different time.</p>
                        {/* Fallback: show all 30-min slots */}
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-4">
                          {Array.from({ length: 20 }, (_, i) => {
                            const hour = 9 + Math.floor(i / 2)
                            const min = i % 2 === 0 ? '00' : '30'
                            const time = `${String(hour).padStart(2, '0')}:${min}`
                            // Slot is HH:mm on the chosen day in the VIEWER's timezone (profile), not the browser's
                            const dt = new Date(startOfDayInTz(watchedDate, f.timeZone).getTime() + (hour * 60 + parseInt(min)) * 60_000)
                            const iso = dt.toISOString()
                            const display = f.time(dt)
                            const past = isToday && isSlotInPast(dt)
                            return (
                              <button
                                key={time}
                                type="button"
                                disabled={past}
                                onClick={() => setValue('meetingTime', iso, { shouldValidate: true })}
                                className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                                  past
                                    ? 'bg-off-white dark:bg-dark-gray text-light-gray dark:text-medium-gray/40 cursor-not-allowed line-through'
                                    : watchedTime === iso
                                      ? 'bg-dark-gray dark:bg-white text-white dark:text-dark-gray'
                                      : 'bg-off-white dark:bg-dark-gray text-dark-gray dark:text-white hover:bg-dark-gray/10 dark:hover:bg-white/10'
                                }`}
                              >
                                {display}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  ) : slotsFetched && slots.length === 0 ? (
                    <div className="text-center py-8">
                      <Calendar className="w-10 h-10 text-light-gray mx-auto mb-2" />
                      <p className="text-sm font-medium text-dark-gray dark:text-white mb-1">No available slots</p>
                      <p className="text-sm text-medium-gray">Both calendars are fully booked on this date. Try another day.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {slots.map((slot) => {
                        const past = isToday && isSlotInPast(new Date(slot.start))
                        return (
                          <button
                            key={slot.start}
                            type="button"
                            disabled={past}
                            onClick={() => setValue('meetingTime', slot.start, { shouldValidate: true })}
                            className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                              past
                                ? 'bg-off-white dark:bg-dark-gray text-light-gray dark:text-medium-gray/40 cursor-not-allowed line-through'
                                : watchedTime === slot.start
                                  ? 'bg-dark-gray dark:bg-white text-white dark:text-dark-gray'
                                  : 'bg-off-white dark:bg-dark-gray text-dark-gray dark:text-white hover:bg-dark-gray/10 dark:hover:bg-white/10'
                            }`}
                          >
                            {f.time(slot.start)}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {/* Hidden input for react-hook-form */}
                  <input type="hidden" {...register('meetingTime')} />
                  {errors.meetingTime && (
                    <p className="mt-3 text-sm text-red-500">{errors.meetingTime.message}</p>
                  )}
                </div>
              </div>
            )}

            {/* Meeting type: In person or Zoom */}
            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
              <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center">
                  <Video className="w-5 h-5 text-indigo-500" />
                </div>
                <div>
                  <h2 className="font-semibold text-dark-gray dark:text-white">Meeting type</h2>
                  <p className="text-sm text-medium-gray">In person or over Zoom</p>
                </div>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex gap-3">
                  <label className={`flex-1 flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${meetingType === 'IN_PERSON' ? 'border-dark-gray dark:border-white bg-dark-gray/5 dark:bg-white/5' : 'border-off-white dark:border-medium-gray/20 hover:border-medium-gray dark:hover:border-medium-gray/40'}`}>
                    <input type="radio" name="meetingType" checked={meetingType === 'IN_PERSON'} onChange={() => setMeetingType('IN_PERSON')} className="sr-only" />
                    <MapPin className="w-5 h-5 text-medium-gray shrink-0" />
                    <span className="font-medium text-dark-gray dark:text-white">In person</span>
                  </label>
                  <label className={`flex-1 flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${meetingType === 'ZOOM' ? 'border-dark-gray dark:border-white bg-dark-gray/5 dark:bg-white/5' : 'border-off-white dark:border-medium-gray/20 hover:border-medium-gray dark:hover:border-medium-gray/40'}`}>
                    <input type="radio" name="meetingType" checked={meetingType === 'ZOOM'} onChange={() => setMeetingType('ZOOM')} className="sr-only" />
                    <Video className="w-5 h-5 text-medium-gray shrink-0" />
                    <span className="font-medium text-dark-gray dark:text-white">Over Zoom</span>
                  </label>
                </div>
                {meetingType === 'ZOOM' && (
                  <div>
                    <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">Meeting invite <span className="text-red-500">*</span></label>
                    <input
                      type="url"
                      value={meetingLink}
                      onChange={(e) => setMeetingLink(e.target.value)}
                      placeholder="https://zoom.us/j/..."
                      className="w-full px-4 py-2.5 rounded-xl border border-off-white dark:border-medium-gray/20 bg-off-white dark:bg-charcoal text-dark-gray dark:text-white placeholder:text-medium-gray focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20 text-sm"
                    />
                    <p className="mt-1.5 text-xs text-medium-gray">Paste the Zoom meeting invite link. The Fathom recorder can join this call; the transcript will sync to this meeting automatically after the call ends.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Submit */}
            <div className="flex flex-col sm:flex-row justify-end gap-3">
              <button
                type="button"
                onClick={() => router.back()}
                className="px-6 py-3 rounded-xl text-medium-gray hover:text-dark-gray dark:hover:text-white hover:bg-off-white dark:hover:bg-charcoal transition-all order-2 sm:order-1"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || employees.length === 0 || !watchedTime || (meetingType === 'ZOOM' && !meetingLink.trim())}
                className="px-6 py-3 rounded-xl bg-dark-gray dark:bg-white text-white dark:text-dark-gray font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 order-1 sm:order-2 min-h-[44px]"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending proposal...
                  </>
                ) : (
                  <>
                    <Calendar className="w-4 h-4" />
                    Propose Time
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
