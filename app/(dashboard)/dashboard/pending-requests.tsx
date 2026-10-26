'use client'

import Link from 'next/link'
import { AlertCircle, Clock, ChevronRight } from 'lucide-react'
import { useFormat } from '@/components/providers/timezone-provider'
import { plural } from '@/lib/ui'

interface PendingMeeting {
  id: string
  meetingDate: string
  proposerName: string
  otherPartyName: string
}

interface PendingRequestsProps {
  type: 'receiver' | 'proposer'
  meetings: PendingMeeting[]
}

export function PendingRequests({ type, meetings }: PendingRequestsProps) {
  const f = useFormat()
  if (meetings.length === 0) return null

  if (type === 'receiver') {
    return (
      <div className="rounded-2xl border-2 border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10 overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b border-amber-500/20 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h2 className="font-semibold text-dark-gray dark:text-white">
              {plural(meetings.length, 'meeting request')} awaiting your response
            </h2>
            <p className="text-sm text-medium-gray">Accept the proposed time or suggest an alternative</p>
          </div>
        </div>
        <div className="divide-y divide-amber-500/15">
          {meetings.map((m) => {
            const formattedDate = `${f.meetingShort(m.meetingDate)} ${f.abbrev(m.meetingDate)}`

            return (
              <Link
                key={m.id}
                href={`/meetings/${m.id}`}
                className="flex items-center gap-4 px-5 sm:px-6 py-4 even:bg-amber-500/[0.03] dark:even:bg-amber-500/[0.06] hover:bg-amber-500/5 dark:hover:bg-amber-500/10 transition-colors group active:scale-[0.98]"
              >
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-dark-gray dark:text-white">
                    {m.proposerName} proposed a meeting
                  </p>
                  <p className="text-sm text-medium-gray">
                    {formattedDate}
                  </p>
                </div>
                <span className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm font-medium bg-amber-500 text-white">
                  Respond
                  <ChevronRight className="w-4 h-4" />
                </span>
                <ChevronRight className="w-5 h-5 text-amber-500 sm:hidden" />
              </Link>
            )
          })}
        </div>
      </div>
    )
  }

  // Proposer: awaiting acceptance
  return (
    <div className="rounded-2xl border-2 border-blue-500/30 bg-blue-500/5 dark:bg-blue-500/10 overflow-hidden">
      <div className="px-5 sm:px-6 py-4 border-b border-blue-500/15 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
          <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <h2 className="font-semibold text-dark-gray dark:text-white">
            {plural(meetings.length, 'meeting proposal')} awaiting response
          </h2>
          <p className="text-sm text-medium-gray">Waiting for the other party to accept or suggest a new time</p>
        </div>
      </div>
      <div className="divide-y divide-blue-500/10">
        {meetings.map((m) => {
          const formattedDate = `${f.meetingShort(m.meetingDate)} ${f.abbrev(m.meetingDate)}`

          return (
            <Link
              key={m.id}
              href={`/meetings/${m.id}`}
              className="flex items-center gap-4 px-5 sm:px-6 py-4 even:bg-blue-500/[0.03] dark:even:bg-blue-500/[0.06] hover:bg-blue-500/5 dark:hover:bg-blue-500/10 transition-colors group active:scale-[0.98]"
            >
              <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-dark-gray dark:text-white">
                  Awaiting {m.otherPartyName}&apos;s response
                </p>
                <p className="text-sm text-medium-gray">
                  Proposed: {formattedDate}
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-blue-400 group-hover:text-blue-500 transition-colors" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}
