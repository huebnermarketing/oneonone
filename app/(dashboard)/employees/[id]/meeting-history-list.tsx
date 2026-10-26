'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, XCircle, Clock, Mic } from 'lucide-react'
import { useFormat } from '@/components/providers/timezone-provider'

interface MeetingHistoryItem {
  id: string
  meetingDate: Date
  status: string
  formSubmittedAt: Date | string | null
  reporter: { name: string }
  recording: {
    id: string
    status: string
    summary: string | null
    keyPoints: unknown
    sentiment: unknown
    qualityScore: number | null
    duration: number | null
    language: string | null
    processedAt: Date | null
  } | null
}

interface MeetingHistoryListProps {
  meetings: MeetingHistoryItem[]
}

const INITIAL_DISPLAY = 20

export function MeetingHistoryList({ meetings }: MeetingHistoryListProps) {
  const f = useFormat()
  const [showAll, setShowAll] = useState(false)
  const now = new Date()

  const displayedMeetings = showAll ? meetings : meetings.slice(0, INITIAL_DISPLAY)
  const hasMore = meetings.length > INITIAL_DISPLAY

  return (
    <>
      <div className="divide-y divide-off-white dark:divide-medium-gray/20">
        {displayedMeetings.map((meeting) => {
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
                    <span
                      className={`hidden sm:inline px-2 py-0.5 text-[10px] font-medium rounded-full ${
                        sentiment === 'positive'
                          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                          : sentiment === 'negative'
                            ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                            : 'bg-gray-500/10 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      {sentiment}
                    </span>
                  )}
                  {quality !== null && (
                    <span className="hidden sm:inline px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      Q:{quality}
                    </span>
                  )}
                  <span
                    className={`px-2 py-0.5 text-[10px] sm:text-xs font-medium rounded-full ${
                      meeting.status === 'COMPLETED'
                        ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                        : isMissed
                          ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                          : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    }`}
                  >
                    {meeting.status === 'COMPLETED'
                      ? 'Completed'
                      : isMissed
                        ? 'Missed'
                        : 'Scheduled'}
                  </span>
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
      {hasMore && (
        <div className="px-4 sm:px-6 py-3 border-t border-off-white dark:border-medium-gray/20">
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-sm font-medium text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors"
          >
            {showAll
              ? 'Show fewer meetings'
              : `Show all ${meetings.length} meetings`}
          </button>
        </div>
      )}
    </>
  )
}
