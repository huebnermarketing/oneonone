'use client'

import { useCallback, useMemo, useRef, useState } from 'react'

interface LeaveDay {
  date: string
  blocked: boolean
  hint: string
}

/**
 * Keka leave / holiday days for a scheduling DatePicker: loads each month as the picker shows it
 * (GET /api/meetings/leave-days) and returns `disabledDates` (whole day away), `dateHints` (tooltips)
 * and `onVisibleMonthChange`. Pass either the other person (`employeeId`) or the meeting (`meetingId`).
 */
export function useLeaveDays(target: { employeeId?: string | null; meetingId?: string | null }) {
  const key = target.meetingId ? `meetingId=${target.meetingId}` : target.employeeId ? `employeeId=${target.employeeId}` : null
  // Results per "<person>|YYYY-MM", so switching people never shows the previous person's leave
  const [byMonth, setByMonth] = useState<Record<string, LeaveDay[]>>({})
  const requested = useRef(new Set<string>())

  const onVisibleMonthChange = useCallback(
    (from: string, to: string) => {
      if (!key) return
      const month = `${key}|${from.slice(0, 7)}`
      if (requested.current.has(month)) return
      requested.current.add(month)
      fetch(`/api/meetings/leave-days?${key}&from=${from}&to=${to}`)
        .then((r) => (r.ok ? r.json() : { days: [] }))
        .then((data: { days?: LeaveDay[] }) => setByMonth((p) => ({ ...p, [month]: data.days ?? [] })))
        .catch(() => requested.current.delete(month))
    },
    [key]
  )

  return useMemo(() => {
    const days = Object.entries(byMonth)
      .filter(([k]) => key && k.startsWith(`${key}|`))
      .flatMap(([, v]) => v)
    return {
      disabledDates: days.filter((d) => d.blocked).map((d) => d.date),
      dateHints: Object.fromEntries(days.map((d) => [d.date, d.hint])),
      onVisibleMonthChange,
    }
  }, [byMonth, key, onVisibleMonthChange])
}
