'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { CheckCircle2, XCircle, Clock, Mic } from 'lucide-react'
import { useFormat } from '@/components/providers/timezone-provider'
import { MeetingStatusPill, Pill } from '@/components/ui/pill'
import { Pagination } from '@/components/ui/pagination'

interface MeetingHistoryItem {
  id: string
  meetingDate: Date
  status: string
  formSubmittedAt: Date | string | null
  reporter: { name: string | null }
  recording: {
    status: string
    summary: string | null
    sentiment: unknown
    qualityScore: number | null
  } | null
}

interface MeetingHistoryListProps {
  /** One page, newest first — paged on the server via `?page=`. */
  meetings: MeetingHistoryItem[]
  total: number
  offset: number
  pageSize: number
}

export function MeetingHistoryList({ meetings, total, offset, pageSize }: MeetingHistoryListProps) {
  const f = useFormat()
  const router = useRouter()
  const pathname = usePathname()
  const [isNavigating, startTransition] = useTransition()
  const now = new Date()

  const goTo = (nextOffset: number) => {
    const page = Math.floor(nextOffset / pageSize) + 1
    startTransition(() => router.push(page > 1 ? `${pathname}?page=${page}` : pathname, { scroll: false }))
  }

  return (
    <>
      <div
        aria-busy={isNavigating}
        className={`divide-y divide-off-white dark:divide-medium-gray/20 transition-opacity ${isNavigating ? 'opacity-60' : ''}`}
      >
        {meetings.map((meeting) => {
          const date = new Date(meeting.meetingDate)
          const isPast = date < now
          const isMissed =
            isPast && meeting.status === 'SCHEDULED' && !meeting.formSubmittedAt
          const hasRecording =
            meeting.recording && meeting.recording.status === 'COMPLETED'
          const sentiment = hasRecording
            ? (meeting.recording!.sentiment as { label?: string } | null)?.label
            : null
          const quality = hasRecording ? meeting.recording!.qualityScore : null

          return (
            <Link
              key={meeting.id}
              href={`/meetings/${meeting.id}`}
              className="block px-4 sm:px-6 py-3 sm:py-4 even:bg-off-white/40 dark:even:bg-charcoal/40 hover:bg-off-white/70 dark:hover:bg-charcoal/60 active:bg-off-white dark:active:bg-charcoal transition-colors"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    meeting.status === 'COMPLETED'
                      ? 'bg-green-500/10'
                      : isMissed
                        ? 'bg-red-500/10'
                        : 'bg-blue-500/10'
                  }`}
                >
                  {meeting.status === 'COMPLETED' ? (
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                  ) : isMissed ? (
                    <XCircle className="w-5 h-5 text-red-500" />
                  ) : (
                    <Clock className="w-5 h-5 text-blue-500" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm text-dark-gray dark:text-white">
                      {f.meetingShort(date)}
                    </p>
                    {hasRecording && (
                      <Mic className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-medium-gray">
                    with {meeting.reporter.name}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {sentiment && (
                    <Pill
                      tone={sentiment === 'positive' ? 'green' : sentiment === 'negative' ? 'red' : 'neutral'}
                      className="hidden sm:inline-flex px-2 py-0.5 text-[10px]"
                    >
                      {sentiment}
                    </Pill>
                  )}
                  {quality !== null && (
                    <Pill tone="amber" className="hidden sm:inline-flex px-2 py-0.5 text-[10px]">Q:{quality}</Pill>
                  )}
                  {isMissed ? (
                    <Pill tone="red" className="px-2 py-0.5 text-[10px] sm:text-xs">Missed</Pill>
                  ) : (
                    <MeetingStatusPill status={meeting.status} className="px-2 py-0.5 text-[10px] sm:text-xs" />
                  )}
                </div>
              </div>

              {hasRecording && meeting.recording!.summary && (
                <div className="mt-2 ml-13 pl-[52px]">
                  <p className="text-xs text-medium-gray line-clamp-2">
                    {meeting.recording!.summary}
                  </p>
                </div>
              )}
            </Link>
          )
        })}
      </div>
      <Pagination
        offset={offset}
        limit={pageSize}
        total={total}
        onChange={goTo}
        noun="meetings"
        className="px-4 sm:px-6 py-3 border-t border-off-white dark:border-medium-gray/20"
      />
    </>
  )
}
