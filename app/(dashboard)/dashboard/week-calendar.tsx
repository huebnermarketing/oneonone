'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Calendar, Clock, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useFormat } from '@/components/providers/timezone-provider'

interface CalendarMeeting {
  id: string
  meetingDate: string
  status: string
  employee?: { name: string | null }
  reporter?: { name: string | null }
}

interface WeekCalendarProps {
  initialMeetings: CalendarMeeting[]
  initialWeekStart: string
  /** End of preloaded range (e.g. 1 year). When navigating within this range, filter from initialMeetings instead of fetching. */
  initialRangeEnd?: string
  userRole: string
}

type ViewMode = 'week' | 'month'

const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthNamesFull = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function getMonday(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

function getWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  })
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** "YYYY-MM-DD" of a grid cell built from local Y/M/D parts — a calendar day, compared against `f.dateKey(instant)`. */
function gridDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isSameWeek(a: Date, b: Date) {
  return isSameDay(getMonday(a), getMonday(b))
}

function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

function weekLabel(weekStart: Date): string {
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  const startMonth = monthNames[weekStart.getMonth()]
  const endMonth = monthNames[weekEnd.getMonth()]
  if (weekStart.getMonth() === weekEnd.getMonth()) {
    return `${startMonth} ${weekStart.getDate()} – ${weekEnd.getDate()}, ${weekStart.getFullYear()}`
  }
  if (weekStart.getFullYear() === weekEnd.getFullYear()) {
    return `${startMonth} ${weekStart.getDate()} – ${endMonth} ${weekEnd.getDate()}, ${weekStart.getFullYear()}`
  }
  return `${startMonth} ${weekStart.getDate()}, ${weekStart.getFullYear()} – ${endMonth} ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`
}

function monthLabel(date: Date): string {
  return `${monthNamesFull[date.getMonth()]} ${date.getFullYear()}`
}

function getMonthGridDays(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const dayOfWeek = first.getDay()
  const startOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const gridStart = new Date(year, month, 1 + startOffset)

  const days: Date[] = []
  const d = new Date(gridStart)
  // Always show 6 rows (42 cells) for consistent height
  for (let i = 0; i < 42; i++) {
    days.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return days
}

const statusDot: Record<string, string> = {
  PROPOSED: 'bg-amber-500',
  SCHEDULED: 'bg-blue-500',
  COMPLETED: 'bg-green-500',
  CANCELLED: 'bg-red-400',
}

const statusBadge: Record<string, { label: string; classes: string }> = {
  PROPOSED: { label: 'Proposed', classes: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  SCHEDULED: { label: 'Scheduled', classes: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  COMPLETED: { label: 'Completed', classes: 'bg-green-500/10 text-green-600 dark:text-green-400' },
  CANCELLED: { label: 'Cancelled', classes: 'bg-red-500/10 text-red-600 dark:text-red-400' },
}

// ── Week View ────────────────────────────────────────────────────────────────

function WeekView({ meetings, days, today, userRole }: {
  meetings: CalendarMeeting[]
  days: Date[]
  today: Date
  userRole: string
}) {
  const f = useFormat()
  return (
    <>
      {/* Desktop: 7-column grid */}
      <div className="hidden sm:block overflow-x-auto">
        <div className="grid grid-cols-7 min-w-[56rem] w-full divide-x divide-off-white dark:divide-medium-gray/20 min-h-[140px]">
          {days.map((day, idx) => {
            const isToday = isSameDay(day, today)
            const dayMeetings = meetings
              .filter((m) => f.dateKey(m.meetingDate) === gridDayKey(day))
              .sort((a, b) => new Date(a.meetingDate).getTime() - new Date(b.meetingDate).getTime())

            return (
              <div key={idx} className={`flex flex-col ${isToday ? 'bg-blue-500/5 dark:bg-blue-500/10' : ''}`}>
                <div className={`px-2 py-2 text-center border-b border-off-white dark:border-medium-gray/20 ${isToday ? 'bg-blue-500/10' : ''}`}>
                  <p className="text-xs font-medium text-medium-gray">{dayLabels[idx]}</p>
                  <p className={`text-sm font-bold ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-dark-gray dark:text-white'}`}>
                    {day.getDate()}
                  </p>
                </div>
                <div className="flex-1 p-1.5 space-y-1">
                  {dayMeetings.length === 0 && (
                    <p className="text-[10px] text-light-gray text-center pt-2">—</p>
                  )}
                  {dayMeetings.map((m) => {
                    const time = f.time(m.meetingDate)
                    const name = userRole === 'EMPLOYEE' ? m.reporter?.name : m.employee?.name
                    const badge = statusBadge[m.status] ?? statusBadge.SCHEDULED

                    return (
                      <Link key={m.id} href={`/meetings/${m.id}`} className="block px-1.5 py-1.5 rounded-lg hover:bg-off-white/70 dark:hover:bg-dark-gray/50 transition-colors group">
                        <p className="text-[11px] font-medium text-dark-gray dark:text-white truncate group-hover:underline">
                          {name || 'Meeting'}
                        </p>
                        <p className="text-[10px] text-medium-gray">{time}</p>
                        <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${badge.classes}`}>
                          {badge.label}
                        </span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Mobile: stacked list */}
      <div className="sm:hidden divide-y divide-off-white dark:divide-medium-gray/20">
        {days.map((day, idx) => {
          const isToday = isSameDay(day, today)
          const dayMeetings = meetings
            .filter((m) => f.dateKey(m.meetingDate) === gridDayKey(day))
            .sort((a, b) => new Date(a.meetingDate).getTime() - new Date(b.meetingDate).getTime())

          if (dayMeetings.length === 0 && !isToday) return null

          return (
            <div key={idx} className={`px-4 py-3 ${isToday ? 'bg-blue-500/5 dark:bg-blue-500/10' : ''}`}>
              <div className="flex items-center gap-2 mb-2">
                <p className={`text-xs font-bold ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-dark-gray dark:text-white'}`}>
                  {dayLabels[idx]} {day.getDate()}
                </p>
                {isToday && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">Today</span>
                )}
              </div>
              {dayMeetings.length === 0 ? (
                <p className="text-xs text-light-gray">No meetings</p>
              ) : (
                <div className="space-y-2">
                  {dayMeetings.map((m) => {
                    const time = f.time(m.meetingDate)
                    const name = userRole === 'EMPLOYEE' ? m.reporter?.name : m.employee?.name
                    const badge = statusBadge[m.status] ?? statusBadge.SCHEDULED

                    return (
                      <Link key={m.id} href={`/meetings/${m.id}`} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-off-white/70 dark:hover:bg-dark-gray/50 transition-colors">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                          <Clock className="w-4 h-4 text-blue-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-dark-gray dark:text-white truncate">{name || 'Meeting'}</p>
                          <p className="text-xs text-medium-gray">{time}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${badge.classes}`}>
                          {badge.label}
                        </span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        {days.every((day) => {
          const dayMeetings = meetings.filter((m) => f.dateKey(m.meetingDate) === gridDayKey(day))
          return dayMeetings.length === 0 && !isSameDay(day, today)
        }) && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-medium-gray">No meetings this week</p>
          </div>
        )}
      </div>
    </>
  )
}

// ── Month View ───────────────────────────────────────────────────────────────

function MonthView({ meetings, monthDate, today, userRole }: {
  meetings: CalendarMeeting[]
  monthDate: Date
  today: Date
  userRole: string
}) {
  const f = useFormat()
  const gridDays = getMonthGridDays(monthDate.getFullYear(), monthDate.getMonth())
  const currentMonth = monthDate.getMonth()
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)

  const selectedMeetings = selectedDay
    ? meetings
        .filter((m) => f.dateKey(m.meetingDate) === gridDayKey(selectedDay))
        .sort((a, b) => new Date(a.meetingDate).getTime() - new Date(b.meetingDate).getTime())
    : []

  return (
    <div>
      {/* Desktop month grid */}
      <div className="hidden sm:block">
        {/* Day-of-week header */}
        <div className="grid grid-cols-7 border-b border-off-white dark:border-medium-gray/20">
          {dayLabels.map((label) => (
            <div key={label} className="px-2 py-2 text-center">
              <p className="text-xs font-medium text-medium-gray">{label}</p>
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {gridDays.map((day, idx) => {
            const isToday = isSameDay(day, today)
            const isCurrentMonth = day.getMonth() === currentMonth
            const isSelected = selectedDay && isSameDay(day, selectedDay)
            const dayMeetings = meetings.filter((m) => f.dateKey(m.meetingDate) === gridDayKey(day))
            const uniqueStatuses = [...new Set(dayMeetings.map((m) => m.status))]

            return (
              <button
                key={idx}
                onClick={() => setSelectedDay(isSelected ? null : day)}
                className={`
                  relative min-h-[72px] p-1.5 text-left border-b border-r border-off-white dark:border-medium-gray/20 transition-colors
                  ${idx % 7 === 0 ? 'border-l-0' : ''}
                  ${isSelected ? 'bg-blue-500/10 dark:bg-blue-500/15' : isToday ? 'bg-blue-500/5 dark:bg-blue-500/10' : 'hover:bg-off-white/50 dark:hover:bg-dark-gray/30'}
                  ${!isCurrentMonth ? 'opacity-40' : ''}
                `}
              >
                <span className={`
                  inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold
                  ${isToday ? 'bg-blue-600 text-white' : isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-dark-gray dark:text-white'}
                `}>
                  {day.getDate()}
                </span>

                {dayMeetings.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {dayMeetings.length <= 2 ? (
                      dayMeetings.map((m) => {
                        const name = userRole === 'EMPLOYEE' ? m.reporter?.name : m.employee?.name
                        const dot = statusDot[m.status] ?? statusDot.SCHEDULED
                        return (
                          <div key={m.id} className="flex items-center gap-1 px-0.5">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                            <span className="text-[10px] text-dark-gray dark:text-white truncate leading-tight">
                              {name || 'Meeting'}
                            </span>
                          </div>
                        )
                      })
                    ) : (
                      <div className="flex items-center gap-1 px-0.5">
                        {uniqueStatuses.slice(0, 3).map((s) => (
                          <span key={s} className={`w-1.5 h-1.5 rounded-full ${statusDot[s] ?? statusDot.SCHEDULED}`} />
                        ))}
                        <span className="text-[10px] font-medium text-medium-gray">{dayMeetings.length}</span>
                      </div>
                    )}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Mobile month grid */}
      <div className="sm:hidden">
        <div className="grid grid-cols-7">
          {dayLabels.map((label) => (
            <div key={label} className="px-1 py-1.5 text-center">
              <p className="text-[10px] font-medium text-medium-gray">{label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {gridDays.map((day, idx) => {
            const isToday = isSameDay(day, today)
            const isCurrentMonth = day.getMonth() === currentMonth
            const isSelected = selectedDay && isSameDay(day, selectedDay)
            const dayMeetings = meetings.filter((m) => f.dateKey(m.meetingDate) === gridDayKey(day))

            return (
              <button
                key={idx}
                onClick={() => setSelectedDay(isSelected ? null : day)}
                className={`
                  relative flex flex-col items-center py-2 transition-colors
                  ${isSelected ? 'bg-blue-500/10' : isToday ? 'bg-blue-500/5' : ''}
                  ${!isCurrentMonth ? 'opacity-30' : ''}
                `}
              >
                <span className={`
                  w-7 h-7 flex items-center justify-center rounded-full text-xs font-semibold
                  ${isToday ? 'bg-blue-600 text-white' : isSelected ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400' : 'text-dark-gray dark:text-white'}
                `}>
                  {day.getDate()}
                </span>

                {dayMeetings.length > 0 && (
                  <div className="flex gap-0.5 mt-1">
                    {dayMeetings.slice(0, 3).map((m) => (
                      <span key={m.id} className={`w-1 h-1 rounded-full ${statusDot[m.status] ?? statusDot.SCHEDULED}`} />
                    ))}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Expanded day detail */}
      {selectedDay && (
        <div className="border-t border-off-white dark:border-medium-gray/20 px-4 sm:px-6 py-4">
          <h3 className="text-sm font-semibold text-dark-gray dark:text-white mb-3">
            {f.dateOnly(gridDayKey(selectedDay), 'weekday')}
            {isSameDay(selectedDay, today) && (
              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium align-middle">Today</span>
            )}
          </h3>
          {selectedMeetings.length === 0 ? (
            <p className="text-sm text-medium-gray">No meetings on this day</p>
          ) : (
            <div className="space-y-2">
              {selectedMeetings.map((m) => {
                const time = f.time(m.meetingDate)
                const name = userRole === 'EMPLOYEE' ? m.reporter?.name : m.employee?.name
                const badge = statusBadge[m.status] ?? statusBadge.SCHEDULED

                return (
                  <Link key={m.id} href={`/meetings/${m.id}`} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-off-white/70 dark:hover:bg-dark-gray/50 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                      <Clock className="w-4 h-4 text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-dark-gray dark:text-white truncate">{name || 'Meeting'}</p>
                      <p className="text-xs text-medium-gray">{time}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 ${badge.classes}`}>
                      {badge.label}
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Calendar Component ──────────────────────────────────────────────────

export function WeekCalendar({ initialMeetings, initialWeekStart, initialRangeEnd, userRole }: WeekCalendarProps) {
  const todayMonday = getMonday(new Date())
  const today = new Date()
  const rangeEnd = useMemo(() => (initialRangeEnd ? new Date(initialRangeEnd) : null), [initialRangeEnd])

  const [view, setView] = useState<ViewMode>('week')

  // Week state
  const [weekStart, setWeekStart] = useState<Date>(new Date(initialWeekStart))
  const [weekMeetings, setWeekMeetings] = useState<CalendarMeeting[]>(() => {
    const start = new Date(initialWeekStart)
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    return initialMeetings.filter((m) => {
      const d = new Date(m.meetingDate).getTime()
      return d >= start.getTime() && d < end.getTime()
    })
  })
  const [weekLoading, setWeekLoading] = useState(false)

  // Month state
  const [monthDate, setMonthDate] = useState<Date>(new Date(today.getFullYear(), today.getMonth(), 1))
  const [monthMeetings, setMonthMeetings] = useState<CalendarMeeting[]>([])
  const [monthLoading, setMonthLoading] = useState(false)
  const [monthFetched, setMonthFetched] = useState<string | null>(null)

  const isCurrentWeek = isSameWeek(weekStart, todayMonday)
  const isCurrentMonth = isSameMonth(monthDate, today)
  const days = getWeekDays(weekStart)

  const fetchRange = useCallback(async (start: Date, end: Date): Promise<CalendarMeeting[]> => {
    const res = await fetch(`/api/meetings?start=${start.toISOString()}&end=${end.toISOString()}`)
    if (res.ok) {
      const data = await res.json()
      return (data as CalendarMeeting[]).filter((m) => m.status !== 'CANCELLED')
    }
    return []
  }, [])

  // Week meetings: use preloaded 1-year data when in range, otherwise fetch
  useEffect(() => {
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)
    const inPreloadedRange =
      rangeEnd &&
      weekStart.getTime() >= new Date(initialWeekStart).getTime() &&
      weekEnd.getTime() <= rangeEnd.getTime()

    if (inPreloadedRange) {
      const filtered = initialMeetings.filter((m) => {
        const t = new Date(m.meetingDate).getTime()
        return t >= weekStart.getTime() && t < weekEnd.getTime()
      })
      setWeekMeetings(filtered)
      return
    }

    setWeekLoading(true)
    fetchRange(weekStart, weekEnd)
      .then((data) => {
        setWeekMeetings(data)
      })
      .catch(() => {})
      .finally(() => setWeekLoading(false))
  }, [weekStart, initialWeekStart, initialMeetings, rangeEnd, fetchRange])

  // Month meetings: use preloaded 1-year data when in range, otherwise fetch
  useEffect(() => {
    if (view !== 'month') return
    const key = `${monthDate.getFullYear()}-${monthDate.getMonth()}`
    if (monthFetched === key) return

    const gridDays = getMonthGridDays(monthDate.getFullYear(), monthDate.getMonth())
    const start = gridDays[0]
    const end = gridDays[gridDays.length - 1]
    const endPlusOne = new Date(end)
    endPlusOne.setDate(endPlusOne.getDate() + 1)

    const inPreloadedRange =
      rangeEnd &&
      start.getTime() >= new Date(initialWeekStart).getTime() &&
      endPlusOne.getTime() <= rangeEnd.getTime()

    if (inPreloadedRange) {
      const filtered = initialMeetings.filter((m) => {
        const t = new Date(m.meetingDate).getTime()
        return t >= start.getTime() && t < endPlusOne.getTime()
      })
      setMonthMeetings(filtered)
      setMonthFetched(key)
      return
    }

    setMonthLoading(true)
    fetchRange(start, endPlusOne)
      .then((data) => {
        setMonthMeetings(data)
        setMonthFetched(key)
      })
      .catch(() => setMonthFetched(key))
      .finally(() => setMonthLoading(false))
  }, [view, monthDate, monthFetched, initialWeekStart, initialMeetings, rangeEnd, fetchRange])

  // Navigation
  const goToPreviousWeek = () => {
    const prev = new Date(weekStart)
    prev.setDate(prev.getDate() - 7)
    setWeekStart(prev)
  }
  const goToNextWeek = () => {
    const next = new Date(weekStart)
    next.setDate(next.getDate() + 7)
    setWeekStart(next)
  }
  const goToPreviousMonth = () => {
    setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))
  }
  const goToNextMonth = () => {
    setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))
  }

  const goToToday = () => {
    if (view === 'week') {
      setWeekStart(todayMonday)
    } else {
      setMonthDate(new Date(today.getFullYear(), today.getMonth(), 1))
    }
  }

  const loading = view === 'week' ? weekLoading : monthLoading
  const showTodayBtn = view === 'week' ? !isCurrentWeek : !isCurrentMonth
  const headerLabel = view === 'week' ? weekLabel(weekStart) : monthLabel(monthDate)
  const goPrev = view === 'week' ? goToPreviousWeek : goToPreviousMonth
  const goNext = view === 'week' ? goToNextWeek : goToNextMonth

  return (
    <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
      {/* Header with navigation + view toggle */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-off-white dark:border-medium-gray/20 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Calendar className="w-5 h-5 text-dark-gray dark:text-white flex-shrink-0" />
          <h2 className="font-semibold text-dark-gray dark:text-white text-sm sm:text-base truncate">
            {headerLabel}
          </h2>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-medium-gray flex-shrink-0" />}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {/* View toggle */}
          <div className="hidden sm:flex items-center bg-off-white dark:bg-dark-gray rounded-lg p-0.5">
            <button
              onClick={() => setView('week')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                view === 'week'
                  ? 'bg-white dark:bg-charcoal text-dark-gray dark:text-white shadow-sm'
                  : 'text-medium-gray hover:text-dark-gray dark:hover:text-white'
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setView('month')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                view === 'month'
                  ? 'bg-white dark:bg-charcoal text-dark-gray dark:text-white shadow-sm'
                  : 'text-medium-gray hover:text-dark-gray dark:hover:text-white'
              }`}
            >
              Month
            </button>
          </div>

          {/* Mobile view toggle */}
          <div className="sm:hidden flex items-center bg-off-white dark:bg-dark-gray rounded-lg p-0.5">
            <button
              onClick={() => setView('week')}
              className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                view === 'week'
                  ? 'bg-white dark:bg-charcoal text-dark-gray dark:text-white shadow-sm'
                  : 'text-medium-gray'
              }`}
            >
              W
            </button>
            <button
              onClick={() => setView('month')}
              className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                view === 'month'
                  ? 'bg-white dark:bg-charcoal text-dark-gray dark:text-white shadow-sm'
                  : 'text-medium-gray'
              }`}
            >
              M
            </button>
          </div>

          {showTodayBtn && (
            <button
              onClick={goToToday}
              className="px-2.5 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-500/10 rounded-lg hover:bg-blue-500/20 transition-colors min-h-[32px]"
            >
              Today
            </button>
          )}
          <button
            onClick={goPrev}
            className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg hover:bg-off-white dark:hover:bg-dark-gray transition-colors"
            aria-label={view === 'week' ? 'Previous week' : 'Previous month'}
          >
            <ChevronLeft className="w-5 h-5 text-medium-gray" />
          </button>
          <button
            onClick={goNext}
            className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg hover:bg-off-white dark:hover:bg-dark-gray transition-colors"
            aria-label={view === 'week' ? 'Next week' : 'Next month'}
          >
            <ChevronRight className="w-5 h-5 text-medium-gray" />
          </button>
        </div>
      </div>

      {/* View content */}
      {view === 'week' ? (
        <WeekView meetings={weekMeetings} days={days} today={today} userRole={userRole} />
      ) : (
        <MonthView meetings={monthMeetings} monthDate={monthDate} today={today} userRole={userRole} />
      )}
    </div>
  )
}
