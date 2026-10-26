'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { useState, useMemo, useEffect, useCallback, useId } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, Clock, User, ArrowLeft, Check, Loader2, AlertCircle, Video, MapPin } from 'lucide-react'
import { DatePicker } from '@/components/ui/date-picker'
import { useToast } from '@/components/ui/toast'
import { useFormat } from '@/components/providers/timezone-provider'
import { EmployeePicker } from '@/components/forms/employee-picker'
import { SlotGrid } from '@/components/forms/slot-grid'
import { buildFallbackSlots, isSlotInPast, type FreeSlot } from '@/lib/slots'

const formSchema = z.object({
  employeeId: z.string().min(1, 'Please select a team member'),
  meetingDate: z.string().min(1, 'Please select a date'),
  meetingTime: z.string().min(1, 'Please select a time slot'),
})

type FormData = z.infer<typeof formSchema>

interface NewMeetingFormProps {
  employees: Array<{ id: string; name: string; email: string }>
  currentUserId: string
  /** Viewer's work hours ("HH:mm", their profile zone) — bound the fallback grid when calendars are not connected. */
  workDayStart?: string | null
  workDayEnd?: string | null
}

export function NewMeetingForm({ employees, workDayStart, workDayEnd }: NewMeetingFormProps) {
  const router = useRouter()
  const { toastError, toastSuccess } = useToast()
  const f = useFormat()
  const meetingLinkId = useId()
  const slotsHeadingId = useId()
  const [isLoading, setIsLoading] = useState(false)

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
    defaultValues: { employeeId: '', meetingDate: '', meetingTime: '' },
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
      toastError('Failed to check calendar connection')
    } finally {
      setCalendarStatusLoading(false)
    }
  }, [toastError])

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

  const minDate = f.dateKey(new Date())
  const isToday = watchedDate === minDate
  const slotIsPast = useCallback((iso: string) => isToday && isSlotInPast(iso), [isToday])

  // Fallback when a calendar is not connected: every 30-min slot inside the viewer's work hours, built in
  // the VIEWER's timezone (profile), not the browser's
  const fallbackSlots = useMemo(
    () => (watchedDate && calendarUnavailable ? buildFallbackSlots(watchedDate, f.timeZone, workDayStart, workDayEnd) : []),
    [watchedDate, calendarUnavailable, f.timeZone, workDayStart, workDayEnd]
  )

  const selectTime = (iso: string) => setValue('meetingTime', iso, { shouldValidate: true })

  return (
    <div className="max-w-4xl">
      <button
        type="button"
        onClick={() => router.back()}
        className="flex items-center gap-2 text-medium-gray hover:text-dark-gray dark:hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        <span>Back to meetings</span>
      </button>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-[1fr,1fr] items-start">
          {/* Left: Team Member with search + scrollable list */}
          <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden flex flex-col max-h-[520px]">
            <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20 flex items-center gap-3 shrink-0">
              <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0" aria-hidden="true">
                <User className="w-5 h-5 text-blue-500" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-dark-gray dark:text-white">Select Team Member</h2>
                <p className="text-sm text-medium-gray truncate">Search by name or email</p>
              </div>
            </div>
            <EmployeePicker
              employees={employees}
              value={watchedEmployee || null}
              onChange={(id) => setValue('employeeId', id, { shouldValidate: true })}
              error={errors.employeeId?.message}
              className="border-0 rounded-none max-h-none min-h-0 flex-1"
            />
            <input type="hidden" {...register('employeeId')} />
          </div>

          {/* Right: Date, Available Slots, Submit */}
          <div className="space-y-6">
            {/* Calendar check: shown as soon as an employee is selected */}
            {watchedEmployee && (
              <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
                <div className="px-4 py-3 border-b border-off-white dark:border-medium-gray/20 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-blue-500 shrink-0" aria-hidden="true" />
                  <span className="text-sm font-medium text-dark-gray dark:text-white">Calendar check</span>
                </div>
                <div className="p-4">
                  {calendarStatusLoading ? (
                    <div className="flex items-center gap-2 text-sm text-medium-gray">
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
                      <span>Checking {selectedEmployee?.name ?? 'their'} calendar connection...</span>
                    </div>
                  ) : calendarStatus ? (
                    <div className="flex items-start gap-3">
                      {calendarStatus.yourCalendarConnected && calendarStatus.employeeCalendarConnected ? (
                        <Check className="w-5 h-5 text-green-500 shrink-0 mt-0.5" aria-hidden="true" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
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
                <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center" aria-hidden="true">
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
                  <p className="mt-2 text-sm text-red-500" role="alert">{errors.meetingDate.message}</p>
                )}
              </div>
            </div>

            {/* Time slots card (visible after date + employee selected) */}
            {watchedEmployee && watchedDate && (
              <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
                <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center" aria-hidden="true">
                    <Clock className="w-5 h-5 text-purple-500" />
                  </div>
                  <div>
                    <h2 id={slotsHeadingId} className="font-semibold text-dark-gray dark:text-white">Available time slots</h2>
                    <p className="text-sm text-medium-gray">
                      {workingHoursLabel ?? 'Free on both calendars'}
                    </p>
                  </div>
                </div>
                <div className="p-4">
                  {slotsLoading ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-medium-gray" role="status">
                      <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                      <span className="text-sm">
                        Checking {selectedEmployee?.name ?? 'their'} and your calendar for {formattedDateForSlots || 'this date'}...
                      </span>
                    </div>
                  ) : calendarUnavailable ? (
                    <div className="flex items-start gap-3 py-4 px-2">
                      <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-dark-gray dark:text-white mb-1">Calendar not connected</p>
                        <p className="text-sm text-medium-gray">{calendarMessage}</p>
                        <p className="text-sm text-medium-gray mt-2">You can still propose any time. The employee will be able to accept or suggest a different time.</p>
                        <SlotGrid
                          slots={fallbackSlots}
                          value={watchedTime || null}
                          onChange={selectTime}
                          isPast={slotIsPast}
                          aria-labelledby={slotsHeadingId}
                          className="mt-4"
                        />
                      </div>
                    </div>
                  ) : slotsFetched && slots.length === 0 ? (
                    <div className="text-center py-8">
                      <Calendar className="w-10 h-10 text-light-gray mx-auto mb-2" aria-hidden="true" />
                      <p className="text-sm font-medium text-dark-gray dark:text-white mb-1">No available slots</p>
                      <p className="text-sm text-medium-gray">Both calendars are fully booked on this date. Try another day.</p>
                    </div>
                  ) : (
                    <SlotGrid
                      slots={slots}
                      value={watchedTime || null}
                      onChange={selectTime}
                      isPast={slotIsPast}
                      aria-labelledby={slotsHeadingId}
                    />
                  )}
                  {/* Hidden input for react-hook-form */}
                  <input type="hidden" {...register('meetingTime')} />
                  {errors.meetingTime && (
                    <p className="mt-3 text-sm text-red-500" role="alert">{errors.meetingTime.message}</p>
                  )}
                </div>
              </div>
            )}

            {/* Meeting type: In person or Zoom */}
            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
              <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center" aria-hidden="true">
                  <Video className="w-5 h-5 text-indigo-500" />
                </div>
                <div>
                  <h2 className="font-semibold text-dark-gray dark:text-white">Meeting type</h2>
                  <p className="text-sm text-medium-gray">In person or over Zoom</p>
                </div>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex gap-3" role="radiogroup" aria-label="Meeting type">
                  <label className={`flex-1 flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${meetingType === 'IN_PERSON' ? 'border-dark-gray dark:border-white bg-dark-gray/5 dark:bg-white/5' : 'border-off-white dark:border-medium-gray/20 hover:border-medium-gray dark:hover:border-medium-gray/40'}`}>
                    <input type="radio" name="meetingType" checked={meetingType === 'IN_PERSON'} onChange={() => setMeetingType('IN_PERSON')} className="sr-only" />
                    <MapPin className="w-5 h-5 text-medium-gray shrink-0" aria-hidden="true" />
                    <span className="font-medium text-dark-gray dark:text-white">In person</span>
                  </label>
                  <label className={`flex-1 flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${meetingType === 'ZOOM' ? 'border-dark-gray dark:border-white bg-dark-gray/5 dark:bg-white/5' : 'border-off-white dark:border-medium-gray/20 hover:border-medium-gray dark:hover:border-medium-gray/40'}`}>
                    <input type="radio" name="meetingType" checked={meetingType === 'ZOOM'} onChange={() => setMeetingType('ZOOM')} className="sr-only" />
                    <Video className="w-5 h-5 text-medium-gray shrink-0" aria-hidden="true" />
                    <span className="font-medium text-dark-gray dark:text-white">Over Zoom</span>
                  </label>
                </div>
                {meetingType === 'ZOOM' && (
                  <div>
                    <label htmlFor={meetingLinkId} className="block text-sm font-medium text-dark-gray dark:text-white mb-2">Meeting invite <span className="text-red-500">*</span></label>
                    <input
                      id={meetingLinkId}
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
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    Sending proposal...
                  </>
                ) : (
                  <>
                    <Calendar className="w-4 h-4" aria-hidden="true" />
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
