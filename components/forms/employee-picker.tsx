'use client'

import { useId, useMemo, useState } from 'react'
import { Check, Search, User } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

export interface PickableEmployee {
  id: string
  name: string
  email: string
  department?: string | null
}

export interface EmployeePickerProps {
  employees: PickableEmployee[]
  /** Selected employee id */
  value: string | null
  onChange: (id: string) => void
  placeholder?: string
  disabled?: boolean
  /** Optional card header above the search box */
  title?: string
  description?: string
  /** Shown when `employees` is empty */
  emptyMessage?: string
  /** Validation message rendered under the list */
  error?: string
  /** Outer card class — set the max height here (default max-h-[280px]) */
  className?: string
}

/**
 * Searchable team-member list with initials avatars. Options are toggle buttons (`aria-pressed`),
 * so the whole thing works with Tab + Enter/Space; the search box is labelled for screen readers.
 */
export function EmployeePicker({
  employees,
  value,
  onChange,
  placeholder = 'Search by name or email...',
  disabled,
  title,
  description,
  emptyMessage = 'No team members available',
  error,
  className,
}: EmployeePickerProps) {
  const [query, setQuery] = useState('')
  const inputId = useId()
  const listId = useId()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return employees
    return employees.filter((e) => e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q) || (e.department ?? '').toLowerCase().includes(q))
  }, [employees, query])

  return (
    <div className={cn('rounded-xl border border-off-white dark:border-medium-gray/20 overflow-hidden flex flex-col max-h-[280px]', disabled && 'opacity-60', className)}>
      {title && (
        <div className="px-4 py-3 border-b border-off-white dark:border-medium-gray/20 flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0" aria-hidden="true">
            <User className="w-4 h-4 text-blue-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-dark-gray dark:text-white text-sm">{title}</p>
            {description && <p className="text-xs text-medium-gray truncate">{description}</p>}
          </div>
        </div>
      )}
      <div className="px-3 py-2.5 border-b border-off-white dark:border-medium-gray/20 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-medium-gray pointer-events-none" aria-hidden="true" />
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            aria-label={title ? `${title}: search` : 'Search team members'}
            aria-controls={listId}
            autoComplete="off"
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-off-white dark:border-medium-gray/20 bg-off-white dark:bg-charcoal text-dark-gray dark:text-white placeholder:text-medium-gray focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20 text-sm disabled:cursor-not-allowed"
          />
        </div>
      </div>
      <div id={listId} role="group" aria-label={title ?? 'Team members'} className="p-3 overflow-y-auto min-h-0 flex-1">
        {employees.length === 0 ? (
          <div className="text-center py-4">
            <User className="w-8 h-8 text-light-gray mx-auto mb-1" aria-hidden="true" />
            <p className="text-xs text-medium-gray">{emptyMessage}</p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-medium-gray text-center py-3" role="status">No matches for &quot;{query}&quot;</p>
        ) : (
          <div className="grid gap-1.5">
            {filtered.map((emp) => {
              const selected = value === emp.id
              return (
                <button
                  key={emp.id}
                  type="button"
                  disabled={disabled}
                  aria-pressed={selected}
                  onClick={() => onChange(emp.id)}
                  className={cn(
                    'flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-dark-gray/30 dark:focus-visible:ring-white/30 disabled:cursor-not-allowed',
                    selected
                      ? 'border-dark-gray dark:border-white bg-dark-gray/5 dark:bg-white/5'
                      : 'border-off-white dark:border-medium-gray/20 hover:border-medium-gray dark:hover:border-medium-gray/40'
                  )}
                >
                  <Avatar name={emp.name} size="sm" alt="" className="bg-off-white dark:bg-dark-gray text-blue-600 dark:text-blue-400 font-medium" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-dark-gray dark:text-white text-sm truncate">{emp.name}</p>
                    <p className="text-xs text-medium-gray truncate">
                      {emp.email}
                      {emp.department ? ` · ${emp.department}` : ''}
                    </p>
                  </div>
                  {selected && (
                    <div className="w-5 h-5 rounded-full bg-dark-gray dark:bg-white flex items-center justify-center shrink-0" aria-hidden="true">
                      <Check className="w-3 h-3 text-white dark:text-dark-gray" />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-500" role="alert">{error}</p>}
      </div>
    </div>
  )
}
