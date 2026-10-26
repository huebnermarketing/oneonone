import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PaginationProps {
  offset: number
  limit: number
  total: number
  onChange: (offset: number) => void
  className?: string
  /** Noun for the count line, e.g. "entries" */
  noun?: string
}

/** Offset/limit pager: "Showing 51–100 of 240 entries" + prev/next. Hidden when everything fits on one page. */
export function Pagination({ offset, limit, total, onChange, className, noun = 'items' }: PaginationProps) {
  if (total <= limit) return null
  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + limit, total)
  const page = Math.floor(offset / limit) + 1
  const pages = Math.max(1, Math.ceil(total / limit))
  return (
    <nav aria-label="Pagination" className={cn('flex items-center justify-between gap-4 text-sm text-medium-gray', className)}>
      <p>
        Showing <span className="font-medium text-dark-gray dark:text-white">{from}–{to}</span> of{' '}
        <span className="font-medium text-dark-gray dark:text-white">{total}</span> {noun}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, offset - limit))}
          disabled={offset === 0}
          aria-label="Previous page"
          className="p-2 rounded-lg border border-off-white dark:border-medium-gray/20 hover:bg-off-white dark:hover:bg-dark-gray disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="tabular-nums">
          {page} / {pages}
        </span>
        <button
          type="button"
          onClick={() => onChange(offset + limit)}
          disabled={offset + limit >= total}
          aria-label="Next page"
          className="p-2 rounded-lg border border-off-white dark:border-medium-gray/20 hover:bg-off-white dark:hover:bg-dark-gray disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </nav>
  )
}
