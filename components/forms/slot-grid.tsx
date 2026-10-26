'use client'

import { useFormat } from '@/components/providers/timezone-provider'
import type { FreeSlot } from '@/lib/slots'
import { cn } from '@/lib/utils'

export interface SlotGridProps {
  slots: FreeSlot[]
  /** Selected slot start (ISO instant) */
  value: string | null
  onChange: (iso: string) => void
  /** A slot that has already started renders disabled + struck through */
  isPast?: (iso: string) => boolean
  /** Rendered instead of the grid when `slots` is empty; nothing when omitted */
  emptyMessage?: React.ReactNode
  /** Id of the heading that names this group, for screen readers */
  'aria-labelledby'?: string
  disabled?: boolean
  className?: string
}

/** Grid of 30-minute time buttons rendered in the VIEWER's timezone. */
export function SlotGrid({ slots, value, onChange, isPast, emptyMessage, disabled, className, 'aria-labelledby': labelledBy }: SlotGridProps) {
  const f = useFormat()

  if (slots.length === 0) return emptyMessage ? <>{emptyMessage}</> : null

  return (
    <div role="group" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : 'Available time slots'} className={cn('grid grid-cols-3 sm:grid-cols-4 gap-2', className)}>
      {slots.map((slot) => {
        const past = isPast?.(slot.start) ?? false
        const unavailable = slot.available === false
        const blocked = past || unavailable || !!disabled
        const selected = value === slot.start
        const label = f.time(slot.start)
        return (
          <button
            key={slot.start}
            type="button"
            disabled={blocked}
            aria-pressed={selected}
            aria-label={past ? `${label} (already passed)` : unavailable ? `${label} (unavailable)` : undefined}
            title={past ? 'Already passed' : unavailable ? 'Unavailable' : undefined}
            onClick={() => onChange(slot.start)}
            className={cn(
              'px-3 py-2.5 rounded-xl text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-dark-gray/30 dark:focus-visible:ring-white/30',
              past
                ? 'bg-off-white dark:bg-dark-gray text-light-gray dark:text-medium-gray/40 cursor-not-allowed line-through'
                : unavailable || disabled
                  ? 'bg-off-white dark:bg-dark-gray text-light-gray dark:text-medium-gray/40 cursor-not-allowed'
                  : selected
                    ? 'bg-dark-gray dark:bg-white text-white dark:text-dark-gray'
                    : 'bg-off-white dark:bg-dark-gray text-dark-gray dark:text-white hover:bg-dark-gray/10 dark:hover:bg-white/10'
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
