import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const ACCENTS = {
  blue: { icon: 'bg-blue-500/10 text-blue-500', hover: 'hover:border-blue-500/30' },
  amber: { icon: 'bg-amber-500/10 text-amber-500', hover: 'hover:border-amber-500/30' },
  green: { icon: 'bg-green-500/10 text-green-500', hover: 'hover:border-green-500/30' },
  red: { icon: 'bg-red-500/10 text-red-500', hover: 'hover:border-red-500/30' },
  orange: { icon: 'bg-orange/10 text-orange', hover: 'hover:border-orange/30' },
  neutral: { icon: 'bg-medium-gray/10 text-medium-gray', hover: 'hover:border-medium-gray/50' },
} as const

export interface StatCardProps {
  label: string
  value: React.ReactNode
  icon?: LucideIcon
  accent?: keyof typeof ACCENTS
  /** Small line under the value */
  hint?: React.ReactNode
  href?: string
  className?: string
}

/** Dashboard/report number tile. Becomes a link when `href` is set. */
export function StatCard({ label, value, icon: Icon, accent = 'neutral', hint, href, className }: StatCardProps) {
  const a = ACCENTS[accent]
  const body = (
    <div
      className={cn(
        'rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-4 sm:p-5 transition-colors',
        href && cn(a.hover, 'active:scale-[0.98]'),
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs sm:text-sm text-medium-gray truncate">{label}</p>
          <p className="mt-1 text-2xl sm:text-3xl font-bold text-dark-gray dark:text-white tabular-nums">{value}</p>
          {hint && <p className="mt-1 text-xs text-medium-gray">{hint}</p>}
        </div>
        {Icon && (
          <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', a.icon)}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
    </div>
  )
  return href ? <Link href={href} className="block">{body}</Link> : body
}
