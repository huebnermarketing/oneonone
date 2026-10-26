'use client'

import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { formattersFor, resolveTimeZone, type Formatters } from '@/lib/dates'
import { DEFAULT_TIMEZONE } from '@/lib/constants'

interface TimeZoneContextValue {
  timeZone: string
  /** False until the user has a timezone on their profile (we are rendering in the app default). */
  isSet: boolean
  format: Formatters
}

const TimeZoneContext = createContext<TimeZoneContextValue | null>(null)

/**
 * Supplies the VIEWER's timezone to every client component. `timeZone` is `User.timeZone` from the
 * session. When it is unset we render in the app default and, once, write the browser's zone to the
 * profile so the next render is right — users can still change it in Profile.
 */
export function TimeZoneProvider({ timeZone, children }: { timeZone: string | null | undefined; children: React.ReactNode }) {
  const router = useRouter()
  const isSet = !!timeZone
  const resolved = resolveTimeZone(timeZone)
  const attempted = useRef(false)

  useEffect(() => {
    if (isSet || attempted.current) return
    attempted.current = true
    let detected: string | undefined
    try {
      detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      detected = undefined
    }
    if (!detected || detected === resolved) return
    fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeZone: detected }),
    })
      .then((r) => {
        if (r.ok) router.refresh()
      })
      .catch(() => {})
  }, [isSet, resolved, router])

  const value = useMemo<TimeZoneContextValue>(() => ({ timeZone: resolved, isSet, format: formattersFor(resolved) }), [resolved, isSet])
  return <TimeZoneContext.Provider value={value}>{children}</TimeZoneContext.Provider>
}

/** The viewer's IANA timezone. Outside the provider (auth pages, tests) → app default. */
export function useTimeZone(): string {
  return useContext(TimeZoneContext)?.timeZone ?? DEFAULT_TIMEZONE
}

/** Bound date formatters for the viewer's timezone: `const f = useFormat(); f.meetingShort(date)`. */
export function useFormat(): Formatters {
  const ctx = useContext(TimeZoneContext)
  return useMemo(() => ctx?.format ?? formattersFor(DEFAULT_TIMEZONE), [ctx])
}
