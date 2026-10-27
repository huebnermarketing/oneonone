'use client'

import { History } from 'lucide-react'
import { useFormat } from '@/components/providers/timezone-provider'
import { formFieldTitle, type FormAnswerChange } from '@/lib/form-fields'
import { plural } from '@/lib/ui'

export interface FormRevisionView {
  id: string
  kind: 'SUBMITTED' | 'RESUBMITTED' | 'EDITED'
  /** ISO time */
  at: string
  by: string
  changes: FormAnswerChange[]
}

const VERB: Record<FormRevisionView['kind'], string> = {
  SUBMITTED: 'submitted the form',
  RESUBMITTED: 'updated their answers',
  EDITED: 'edited the answers',
}

/** Collapsible who/when/what list of every submit and edit of the check-in answers (newest first). */
export function FormAnswerHistory({ revisions }: { revisions: FormRevisionView[] }) {
  const f = useFormat()
  return (
    <details className="group rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20">
      <summary className="flex items-center gap-2 px-6 py-4 cursor-pointer select-none text-sm font-medium text-dark-gray dark:text-white list-none [&::-webkit-details-marker]:hidden">
        <History className="w-4 h-4 text-medium-gray" aria-hidden="true" />
        Answer history
        <span className="font-normal text-medium-gray">({plural(revisions.length, 'update')})</span>
        <span className="ml-auto text-xs text-medium-gray group-open:hidden">Show</span>
        <span className="ml-auto text-xs text-medium-gray hidden group-open:inline">Hide</span>
      </summary>
      <ol className="border-t border-off-white dark:border-medium-gray/20 divide-y divide-off-white dark:divide-medium-gray/20">
        {revisions.map((rev) => (
          <li key={rev.id} className="px-6 py-4 space-y-3">
            <p className="text-sm">
              <span className="font-medium text-dark-gray dark:text-white">{rev.by}</span>{' '}
              <span className="text-medium-gray">{VERB[rev.kind]}</span>
              <span className="text-medium-gray"> · {f.meetingShort(rev.at)}</span>
            </p>
            {rev.kind === 'SUBMITTED' ? (
              <p className="text-sm text-medium-gray">Answered: {rev.changes.map((c) => formFieldTitle(c.field)).join(', ')}</p>
            ) : (
              <ul className="space-y-3">
                {rev.changes.map((c) => (
                  <li key={c.field} className="text-sm">
                    <p className="font-medium text-dark-gray dark:text-white mb-1">{formFieldTitle(c.field)}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-lg bg-red-500/5 border border-red-500/15 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-red-600/80 dark:text-red-400/80 mb-0.5">Before</p>
                        <p className="whitespace-pre-wrap text-medium-gray">{c.before ?? <em>empty</em>}</p>
                      </div>
                      <div className="rounded-lg bg-green-500/5 border border-green-500/15 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-green-700/80 dark:text-green-400/80 mb-0.5">After</p>
                        <p className="whitespace-pre-wrap text-dark-gray dark:text-light-gray">{c.after ?? <em>empty</em>}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </details>
  )
}
