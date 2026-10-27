'use client'

import { AlertTriangle } from 'lucide-react'
import { Pill, type PillTone } from '@/components/ui/pill'
import { cn } from '@/lib/utils'

/** Shared by the CSV import and the Keka sync dialogs — both return this shape from lib/user-import's planner. */
export type RowAction = 'create' | 'update' | 'unchanged' | 'error'
export type PreviewFilter = 'all' | RowAction

export interface PreviewRow {
  line: number
  email: string
  name: string
  action: RowAction
  changes: string[]
  errors: string[]
  warnings: string[]
}

export interface PreviewData {
  summary: Record<RowAction, number>
  newDepartments: string[]
  promotions: { email: string; name: string }[]
  ignoredColumns: string[]
  rows: PreviewRow[]
}

export const ACTION_META: Record<RowAction, { label: string; tone: PillTone }> = {
  create: { label: 'New', tone: 'green' },
  update: { label: 'Update', tone: 'blue' },
  unchanged: { label: 'No change', tone: 'neutral' },
  error: { label: 'Error', tone: 'red' },
}

export const initialFilter = (d: PreviewData): PreviewFilter => (d.summary.error > 0 ? 'error' : 'all')

export function ImportPreview({
  data,
  done,
  filter,
  onFilter,
  extraNotes = [],
  lineLabel = 'Line',
}: {
  data: PreviewData
  done: boolean
  filter: PreviewFilter
  onFilter: (f: PreviewFilter) => void
  /** Additional lines for the summary box (e.g. Keka "skipped" employees) */
  extraNotes?: React.ReactNode[]
  lineLabel?: string
}) {
  const rows = data.rows.filter((r) => filter === 'all' || r.action === filter)
  const hasNotes = data.newDepartments.length > 0 || data.promotions.length > 0 || data.ignoredColumns.length > 0 || extraNotes.length > 0
  return (
    <>
      {hasNotes && (
        <ul className="text-sm space-y-1 rounded-xl bg-off-white/60 dark:bg-charcoal p-3">
          {data.newDepartments.length > 0 && (
            <li className="text-dark-gray dark:text-white">
              <span className="text-medium-gray">{done ? 'Departments created:' : 'New departments:'}</span> {data.newDepartments.join(', ')}
            </li>
          )}
          {data.promotions.length > 0 && (
            <li className="text-dark-gray dark:text-white">
              <span className="text-medium-gray">{done ? 'Promoted to Manager:' : 'Will become Manager (now has direct reports):'}</span>{' '}
              {data.promotions.map((p) => p.name || p.email).join(', ')}
            </li>
          )}
          {data.ignoredColumns.length > 0 && <li className="text-amber-600 dark:text-amber-400">Ignored columns: {data.ignoredColumns.join(', ')}</li>}
          {extraNotes.map((n, i) => (
            <li key={i} className="text-dark-gray dark:text-white">
              {n}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter rows">
        {(['all', 'create', 'update', 'unchanged', 'error'] as PreviewFilter[]).map((f) => {
          const count = f === 'all' ? data.rows.length : data.summary[f]
          if (f !== 'all' && count === 0) return null
          return (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => onFilter(f)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                filter === f ? 'bg-dark-gray text-white dark:bg-white dark:text-dark-gray' : 'text-medium-gray hover:bg-off-white dark:hover:bg-charcoal'
              )}
            >
              {f === 'all' ? 'All' : ACTION_META[f].label} <span className="opacity-70">{count}</span>
            </button>
          )
        })}
      </div>

      <div className="max-h-[45vh] overflow-y-auto border border-off-white dark:border-medium-gray/20 rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-off-white dark:bg-charcoal sticky top-0">
            <tr>
              <th scope="col" className="px-3 py-2 text-left text-medium-gray w-14">{lineLabel}</th>
              <th scope="col" className="px-3 py-2 text-left text-medium-gray">User</th>
              <th scope="col" className="px-3 py-2 text-left text-medium-gray w-28">Result</th>
              <th scope="col" className="px-3 py-2 text-left text-medium-gray">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-off-white dark:divide-medium-gray/20">
            {rows.map((r) => (
              <tr key={`${r.line}-${r.email}`} className="align-top">
                <td className="px-3 py-2 text-medium-gray tabular-nums">{r.line}</td>
                <td className="px-3 py-2">
                  <div className="text-dark-gray dark:text-white">{r.name}</div>
                  {r.name !== r.email && <div className="text-xs text-medium-gray">{r.email}</div>}
                </td>
                <td className="px-3 py-2">
                  <Pill tone={ACTION_META[r.action].tone}>{ACTION_META[r.action].label}</Pill>
                </td>
                <td className="px-3 py-2 space-y-1">
                  {r.errors.map((e, i) => (
                    <p key={`e${i}`} className="text-red-600 dark:text-red-400">
                      {e}
                    </p>
                  ))}
                  {r.action !== 'error' && r.changes.length > 0 && (
                    <p className="text-medium-gray">
                      {r.action === 'create' ? 'Sets' : 'Changes'}: {r.changes.join(', ')}
                    </p>
                  )}
                  {r.warnings.map((w, i) => (
                    <p key={`w${i}`} className="flex items-start gap-1 text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                      {w}
                    </p>
                  ))}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-medium-gray">
                  No rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
