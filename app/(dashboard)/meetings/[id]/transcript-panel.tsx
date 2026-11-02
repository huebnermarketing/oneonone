'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Copy, FileText, Search, Sparkles } from 'lucide-react'
import { initials } from '@/components/ui/avatar'
import { useToast } from '@/components/ui/toast'
import { toParagraphs, type SpeakerTurn } from '@/lib/transcript-format'
import { plural } from '@/lib/ui'
import { cn } from '@/lib/utils'

const COLLAPSED_TURNS = 8
const COLLAPSED_PARAGRAPHS = 4

const TONE = {
  REPORTER: { avatar: 'bg-orange/15 text-orange', name: 'text-orange', bar: 'border-orange/40' },
  EMPLOYEE: { avatar: 'bg-blue-500/15 text-blue-600 dark:text-blue-400', name: 'text-blue-600 dark:text-blue-400', bar: 'border-blue-500/40' },
} as const

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Text with every match of `query` wrapped in <mark>. */
function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const parts = text.split(new RegExp(`(${escapeRe(query)})`, 'gi'))
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-500/40 text-inherit rounded px-0.5">
            {p}
          </mark>
        ) : (
          p
        )
      )}
    </>
  )
}

/**
 * Transcript tab: speaker-labelled turns when the AI labelled them (MeetingRecording.speakerTurns),
 * otherwise the plain transcript in paragraphs. Search highlights matches; copy gives "Name: text" lines.
 */
export function TranscriptPanel({
  transcript,
  turns,
  reporterName,
  employeeName,
}: {
  transcript: string | null
  turns: SpeakerTurn[] | null
  reporterName: string
  employeeName: string
}) {
  const { toastError } = useToast()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const names = { REPORTER: reporterName || 'Manager', EMPLOYEE: employeeName || 'Employee' }
  const q = query.trim()
  const paragraphs = useMemo(() => (turns?.length ? [] : toParagraphs(transcript ?? '')), [turns, transcript])
  const blocks = turns?.length ? turns : paragraphs
  const matches = useMemo(() => {
    if (!q) return 0
    const re = new RegExp(escapeRe(q), 'gi')
    return blocks.reduce((n, b) => n + ((typeof b === 'string' ? b : b.text).match(re)?.length ?? 0), 0)
  }, [blocks, q])

  if (!transcript?.trim()) {
    return <p className="text-medium-gray">No transcript available</p>
  }

  const limit = turns?.length ? COLLAPSED_TURNS : COLLAPSED_PARAGRAPHS
  // While searching, show everything so no match is hidden
  const showAll = expanded || !!q || blocks.length <= limit
  const visible = showAll ? blocks : blocks.slice(0, limit)

  const copy = async () => {
    const text = turns?.length ? turns.map((t) => `${names[t.speaker]}: ${t.text}`).join('\n\n') : paragraphs.join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toastError('Could not copy the transcript')
    }
  }

  return (
    <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20">
      <div className="flex flex-wrap items-center gap-3 px-6 pt-5 pb-4 border-b border-off-white dark:border-medium-gray/20">
        <h4 className="font-semibold text-dark-gray dark:text-white flex items-center gap-2 mr-auto">
          <FileText className="w-5 h-5 text-orange" aria-hidden="true" />
          Transcript
        </h4>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-medium-gray" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transcript"
            aria-label="Search transcript"
            className="w-56 pl-9 pr-3 py-2 text-sm rounded-xl border border-off-white dark:border-medium-gray/20 bg-off-white/60 dark:bg-dark-gray text-dark-gray dark:text-white placeholder:text-medium-gray focus:outline-none focus:ring-2 focus:ring-orange/40"
          />
        </div>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border border-off-white dark:border-medium-gray/20 text-dark-gray dark:text-white hover:bg-off-white dark:hover:bg-dark-gray transition-colors"
        >
          {copied ? <Check className="w-4 h-4 text-green-500" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className="px-6 py-4 space-y-1">
        {q && (
          <p className="text-xs text-medium-gray pb-2" role="status">
            {matches ? `${plural(matches, 'match', 'matches')} for "${q}"` : `No matches for "${q}"`}
          </p>
        )}
        {turns?.length ? (
          <>
            <p className="flex items-center gap-1.5 text-xs text-medium-gray pb-3">
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              Speakers labelled by AI from the conversation; quick exchanges may be mislabelled.
            </p>
            <ol className="space-y-4">
              {(visible as SpeakerTurn[]).map((t, i) => (
                <li key={i} className="flex gap-3">
                  <span className={cn('w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold', TONE[t.speaker].avatar)} aria-hidden="true">
                    {initials(names[t.speaker])}
                  </span>
                  <div className="min-w-0">
                    <p className={cn('text-sm font-semibold mb-0.5', TONE[t.speaker].name)}>{names[t.speaker]}</p>
                    <p className="text-charcoal dark:text-light-gray leading-relaxed">
                      <Highlighted text={t.text} query={q} />
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className="space-y-4">
            {(visible as string[]).map((p, i) => (
              <p key={i} className="text-charcoal dark:text-light-gray leading-relaxed">
                <Highlighted text={p} query={q} />
              </p>
            ))}
          </div>
        )}
      </div>

      {!q && blocks.length > limit && (
        <div className="px-6 pb-5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium text-orange hover:text-orange/80 transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
            {expanded ? 'Show less' : `Show full transcript (${plural(blocks.length - limit, turns?.length ? 'more turn' : 'more paragraph')})`}
          </button>
        </div>
      )}
    </div>
  )
}
