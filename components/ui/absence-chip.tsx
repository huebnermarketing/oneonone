import { Pill } from '@/components/ui/pill'
import { cn } from '@/lib/utils'
import type { AbsenceChipData } from '@/lib/absence-format'

const TONE = { holiday: 'purple', leave: 'red', pending: 'amber' } as const

/** "On leave" / "Half-day leave" / "Leave pending" / "Holiday" from Keka, next to a person's name. */
export function AbsenceChips({ chips, className }: { chips: AbsenceChipData[]; className?: string }) {
  if (chips.length === 0) return null
  return (
    <>
      {chips.map((c) => (
        <Pill key={c.label} tone={TONE[c.kind]} className={cn('flex-shrink-0 whitespace-nowrap', className)}>
          {c.label}
        </Pill>
      ))}
    </>
  )
}
