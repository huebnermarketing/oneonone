'use client'

import { Clock } from 'lucide-react'
import { MEETING_DURATIONS, formatDuration, type MeetingDuration } from '@/lib/meeting-duration'
import { cn } from '@/lib/utils'

/** Segmented "15 min | 30 min" choice for a meeting's length. */
export function DurationToggle({ value, onChange, disabled, className }: { value: MeetingDuration; onChange: (d: MeetingDuration) => void; disabled?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span className="flex items-center gap-1.5 text-sm font-medium text-dark-gray dark:text-white">
        <Clock className="w-4 h-4 text-medium-gray" aria-hidden="true" />
        Length
      </span>
      <div role="radiogroup" aria-label="Meeting length" className="inline-flex rounded-xl bg-off-white dark:bg-dark-gray p-1">
        {MEETING_DURATIONS.map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={value === d}
            disabled={disabled}
            onClick={() => onChange(d)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-dark-gray/30 dark:focus-visible:ring-white/30 disabled:opacity-50',
              value === d ? 'bg-white dark:bg-charcoal text-dark-gray dark:text-white shadow-sm' : 'text-medium-gray hover:text-dark-gray dark:hover:text-white'
            )}
          >
            {formatDuration(d)}
          </button>
        ))}
      </div>
    </div>
  )
}
