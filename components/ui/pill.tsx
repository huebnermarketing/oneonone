import type { MeetingStatus, TodoPriority, TodoStatus } from '@prisma/client'
import { cn } from '@/lib/utils'

export type PillTone = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'orange' | 'purple'

const TONES: Record<PillTone, string> = {
  neutral: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
  blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  green: 'bg-green-500/10 text-green-600 dark:text-green-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  red: 'bg-red-500/10 text-red-600 dark:text-red-400',
  orange: 'bg-orange/10 text-orange',
  purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
}

/** Rounded status chip. `dot` adds a leading colour dot (todo priority style). */
export function Pill({ tone = 'neutral', dot, className, children }: { tone?: PillTone; dot?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full whitespace-nowrap', TONES[tone], className)}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', tone === 'orange' ? 'bg-orange' : tone === 'red' ? 'bg-red-500' : tone === 'green' ? 'bg-green-500' : tone === 'blue' ? 'bg-blue-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-gray-500')} />}
      {children}
    </span>
  )
}

export const MEETING_STATUS_META: Record<MeetingStatus, { label: string; tone: PillTone }> = {
  PROPOSED: { label: 'Proposed', tone: 'amber' },
  SCHEDULED: { label: 'Scheduled', tone: 'blue' },
  COMPLETED: { label: 'Completed', tone: 'green' },
  CANCELLED: { label: 'Cancelled', tone: 'red' },
}

/** Meeting status chip. A SCHEDULED meeting whose time has passed shows "Pending" (awaiting completion). */
export function MeetingStatusPill({ status, isPast, className }: { status: MeetingStatus | string; isPast?: boolean; className?: string }) {
  const meta = MEETING_STATUS_META[status as MeetingStatus] ?? { label: status, tone: 'neutral' as PillTone }
  const label = status === 'SCHEDULED' && isPast ? 'Pending' : meta.label
  return <Pill tone={meta.tone} className={className}>{label}</Pill>
}

export const TODO_STATUS_META: Record<TodoStatus, { label: string; tone: PillTone }> = {
  NOT_STARTED: { label: 'Not Started', tone: 'neutral' },
  IN_PROGRESS: { label: 'In Progress', tone: 'blue' },
  DONE: { label: 'Done', tone: 'green' },
}

export function TodoStatusPill({ status, className }: { status: TodoStatus | string; className?: string }) {
  const meta = TODO_STATUS_META[status as TodoStatus] ?? { label: status, tone: 'neutral' as PillTone }
  return <Pill tone={meta.tone} className={className}>{meta.label}</Pill>
}

export const TODO_PRIORITY_META: Record<TodoPriority, { label: string; tone: PillTone }> = {
  HIGH: { label: 'High', tone: 'red' },
  MEDIUM: { label: 'Medium', tone: 'orange' },
  LOW: { label: 'Low', tone: 'neutral' },
}

export function TodoPriorityPill({ priority, className }: { priority: TodoPriority | string; className?: string }) {
  const meta = TODO_PRIORITY_META[priority as TodoPriority] ?? { label: priority, tone: 'neutral' as PillTone }
  return <Pill tone={meta.tone} dot className={className}>{meta.label}</Pill>
}
