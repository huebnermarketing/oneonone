'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DatePickerProps {
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  placeholder?: string
  label?: string
  className?: string
  /** Weekdays that can't be picked (0 = Sunday … 6 = Saturday), e.g. non-working days */
  disabledWeekdays?: number[]
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'Select date',
  label,
  className,
  disabledWeekdays,
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number } | null>(null)
  const [viewDate, setViewDate] = useState(() => {
    if (value) return new Date(value)
    return new Date()
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Parse the value to display
  const selectedDate = value ? new Date(value) : null

  // Position dropdown when opening; open upward if not enough space below
  const DROPDOWN_HEIGHT = 380
  useEffect(() => {
    if (!isOpen || !containerRef.current) {
      setDropdownRect(null)
      return
    }
    const updatePosition = () => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const dropdownWidth = 320
      const spaceBelow = window.innerHeight - rect.bottom - 16
      const openAbove = spaceBelow < DROPDOWN_HEIGHT && rect.top > DROPDOWN_HEIGHT + 16
      let top: number
      if (openAbove) {
        top = rect.top - DROPDOWN_HEIGHT - 8
      } else {
        top = rect.bottom + 8
      }
      let left = rect.left
      if (left + dropdownWidth > window.innerWidth) left = window.innerWidth - dropdownWidth
      if (left < 8) left = 8
      setDropdownRect({ top, left })
    }
    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [isOpen])

  // Handle click outside (trigger or portaled dropdown)
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      if (containerRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Get days in month
  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate()
  }

  // Get first day of month (0 = Sunday)
  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay()
  }

  // Navigate months
  const prevMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))
  }

  const nextMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))
  }

  // Check if a date is disabled
  const isDateDisabled = (date: Date) => {
    const dateStr = formatDateValue(date)
    if (min && dateStr < min) return true
    if (max && dateStr > max) return true
    if (disabledWeekdays?.includes(date.getDay())) return true
    return false
  }

  // Check if a date is selected
  const isDateSelected = (date: Date) => {
    if (!selectedDate) return false
    return (
      date.getDate() === selectedDate.getDate() &&
      date.getMonth() === selectedDate.getMonth() &&
      date.getFullYear() === selectedDate.getFullYear()
    )
  }

  // Check if a date is today
  const isToday = (date: Date) => {
    const today = new Date()
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    )
  }

  // Format date for value (YYYY-MM-DD)
  const formatDateValue = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  // Format date for display
  const formatDateDisplay = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  // Select a date
  const selectDate = (day: number) => {
    const newDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), day)
    if (!isDateDisabled(newDate)) {
      onChange(formatDateValue(newDate))
      setIsOpen(false)
    }
  }

  // Generate calendar grid
  const generateCalendarDays = () => {
    const year = viewDate.getFullYear()
    const month = viewDate.getMonth()
    const daysInMonth = getDaysInMonth(year, month)
    const firstDay = getFirstDayOfMonth(year, month)
    const daysInPrevMonth = getDaysInMonth(year, month - 1)
    
    const days: { day: number; isCurrentMonth: boolean; date: Date }[] = []
    
    // Previous month days
    for (let i = firstDay - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i
      days.push({
        day,
        isCurrentMonth: false,
        date: new Date(year, month - 1, day)
      })
    }
    
    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({
        day: i,
        isCurrentMonth: true,
        date: new Date(year, month, i)
      })
    }
    
    // Next month days (fill to 42 cells = 6 rows)
    const remaining = 42 - days.length
    for (let i = 1; i <= remaining; i++) {
      days.push({
        day: i,
        isCurrentMonth: false,
        date: new Date(year, month + 1, i)
      })
    }
    
    return days
  }

  // Quick select options
  const quickSelect = (option: 'today' | 'tomorrow' | 'nextWeek') => {
    const date = new Date()
    if (option === 'tomorrow') {
      date.setDate(date.getDate() + 1)
    } else if (option === 'nextWeek') {
      date.setDate(date.getDate() + 7)
    }
    // Tomorrow / next week roll forward past disabled weekdays (e.g. weekends)
    if (option !== 'today') for (let i = 0; i < 7 && isDateDisabled(date); i++) date.setDate(date.getDate() + 1)
    if (isDateDisabled(date)) return
    const value = formatDateValue(date)
    const withinMin = !min || value >= min
    const withinMax = !max || value <= max
    if (withinMin && withinMax) {
      onChange(value)
      setIsOpen(false)
    }
  }

  return (
    <div ref={containerRef} className={cn('relative overflow-visible', className)}>
      {label && (
        <label className="flex items-center gap-2 text-sm font-medium text-dark-gray dark:text-white mb-2">
          <Calendar className="w-4 h-4 text-medium-gray" />
          {label}
        </label>
      )}
      
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'w-full flex items-center justify-between px-4 py-3.5 rounded-xl border text-left transition-all shadow-sm',
          'bg-white dark:bg-charcoal border-light-gray/30 dark:border-medium-gray/30',
          'hover:border-medium-gray/50 dark:hover:border-medium-gray/40',
          'focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20',
          isOpen && 'ring-2 ring-dark-gray/20 dark:ring-white/20'
        )}
      >
        <span className={cn(
          'truncate',
          selectedDate ? 'text-dark-gray dark:text-white' : 'text-medium-gray'
        )}>
          {selectedDate ? formatDateDisplay(selectedDate) : placeholder}
        </span>
        <svg className="w-4 h-4 text-medium-gray flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Calendar - portaled so it is never clipped by overflow */}
      {isOpen && dropdownRect && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] w-[320px] bg-white dark:bg-charcoal rounded-2xl border border-off-white dark:border-medium-gray/20 shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200"
          style={{ top: dropdownRect.top, left: dropdownRect.left }}
        >
          {/* Quick Select */}
          <div className="flex gap-2 p-3 border-b border-off-white dark:border-medium-gray/20 bg-off-white/50 dark:bg-charcoal/50">
            <button
              type="button"
              onClick={() => quickSelect('today')}
              disabled={isDateDisabled(new Date())}
              className="disabled:opacity-40 disabled:cursor-not-allowed flex-1 px-3 py-2 text-xs font-medium text-medium-gray hover:text-dark-gray dark:hover:text-white hover:bg-white dark:hover:bg-dark-gray rounded-lg transition-colors"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => quickSelect('tomorrow')}
              className="flex-1 px-3 py-2 text-xs font-medium text-medium-gray hover:text-dark-gray dark:hover:text-white hover:bg-white dark:hover:bg-dark-gray rounded-lg transition-colors"
            >
              Tomorrow
            </button>
            <button
              type="button"
              onClick={() => quickSelect('nextWeek')}
              className="flex-1 px-3 py-2 text-xs font-medium text-medium-gray hover:text-dark-gray dark:hover:text-white hover:bg-white dark:hover:bg-dark-gray rounded-lg transition-colors"
            >
              Next Week
            </button>
          </div>

          {/* Month Navigation */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-off-white dark:border-medium-gray/20">
            <button
              type="button"
              onClick={prevMonth}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-off-white dark:hover:bg-charcoal transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-medium-gray" />
            </button>
            <h3 className="text-sm font-semibold text-dark-gray dark:text-white">
              {MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}
            </h3>
            <button
              type="button"
              onClick={nextMonth}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-off-white dark:hover:bg-charcoal transition-colors"
            >
              <ChevronRight className="w-5 h-5 text-medium-gray" />
            </button>
          </div>

          {/* Calendar Grid */}
          <div className="p-3">
            {/* Day Headers */}
            <div className="grid grid-cols-7 mb-2">
              {DAYS.map(day => (
                <div key={day} className="h-8 flex items-center justify-center">
                  <span className="text-xs font-medium text-medium-gray">{day}</span>
                </div>
              ))}
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 gap-1">
              {generateCalendarDays().map((item, index) => {
                const disabled = isDateDisabled(item.date)
                const selected = isDateSelected(item.date)
                const today = isToday(item.date)
                
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => item.isCurrentMonth && selectDate(item.day)}
                    disabled={disabled || !item.isCurrentMonth}
                    className={cn(
                      'h-10 w-full rounded-xl text-sm font-medium transition-all',
                      'flex items-center justify-center',
                      // Not current month
                      !item.isCurrentMonth && 'text-light-gray dark:text-medium-gray/50 cursor-default',
                      // Current month - default
                      item.isCurrentMonth && !selected && !today && !disabled && 
                        'text-dark-gray dark:text-white hover:bg-off-white dark:hover:bg-charcoal',
                      // Today
                      today && !selected && 
                        'bg-off-white dark:bg-charcoal text-dark-gray dark:text-white font-semibold',
                      // Selected
                      selected && 
                        'bg-dark-gray dark:bg-white text-white dark:text-dark-gray shadow-lg',
                      // Disabled
                      disabled && item.isCurrentMonth && 
                        'text-light-gray dark:text-medium-gray/50 cursor-not-allowed hover:bg-transparent'
                    )}
                  >
                    {item.day}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Clear Button */}
          {selectedDate && (
            <div className="px-3 pb-3">
              <button
                type="button"
                onClick={() => {
                  onChange('')
                  setIsOpen(false)
                }}
                className="w-full py-2 text-xs font-medium text-medium-gray hover:text-red-500 rounded-lg transition-colors"
              >
                Clear Date
              </button>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
