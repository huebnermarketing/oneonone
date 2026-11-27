'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { GripVertical, Maximize2, Mic, Minimize2, Pause, Play } from 'lucide-react'
import { MeetingRecorder, type MeetingRecorderProps } from '@/app/(dashboard)/meetings/[id]/meeting-recorder'
import { HostContext, SessionStore, useRecordingHost, type Controls, type HostApi, type RecorderSession } from './recording-context'

export type SlotProps = MeetingRecorderProps & { label: string }

/**
 * App-wide recorder. A meeting's <MeetingRecorder> is rendered here, in the dashboard shell, and its DOM is
 * moved into the meeting page's slot (<RecorderSlot>) while that page is open. Navigating away (Edit
 * answers, sidebar, notifications…) only moves the DOM into a hidden holder — the component, its
 * MediaRecorder, microphone, timer and chunk uploads keep running — and a floating bar shows the live
 * recording with Pause/Resume and a link back. A recorder stays mounted while its meeting page is open or
 * its session is busy (recording, or parts not yet saved); then it is unmounted as before.
 *
 * One recording per browser: a localStorage heartbeat lets other tabs see an active recording.
 * Closing / reloading the tab still ends a recording (browser limit) — the host warns first.
 */

// ── cross-tab lock ──

const LOCK_KEY = 'ami-recording-active'
/** Identifies this browser tab for the cross-tab lock (module scope: computed once per tab) */
const TAB_ID = Math.random().toString(36).slice(2)
const LOCK_FRESH_MS = 15_000

function readLock(): { tabId: string; meetingId: string; label: string; at: number } | null {
  try {
    const raw = localStorage.getItem(LOCK_KEY)
    const lock = raw ? JSON.parse(raw) : null
    return lock && Date.now() - lock.at < LOCK_FRESH_MS ? lock : null
  } catch {
    return null
  }
}

export function RecordingHost({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const store = useMemo(() => new SessionStore(), [])
  const parkRef = useRef<HTMLDivElement>(null)
  const slots = useRef(new Map<string, HTMLElement>())
  const controls = useRef(new Map<string, Controls>())
  const tabId = TAB_ID
  // Recorders to keep mounted: meetingId → latest props from its page + the DOM node it renders into
  const [instances, setInstances] = useState<Record<string, { props: SlotProps; el: HTMLDivElement }>>({})
  const [slotTick, setSlotTick] = useState(0)

  const busyId = () => {
    const s = store.get()
    return s?.busy ? s.meetingId : null
  }

  const registerSlot = useCallback((meetingId: string, element: HTMLElement, props: unknown) => {
    slots.current.set(meetingId, element)
    setInstances((prev) => ({ ...prev, [meetingId]: { props: props as SlotProps, el: prev[meetingId]?.el ?? document.createElement('div') } }))
    setSlotTick((n) => n + 1)
  }, [])

  const unregisterSlot = useCallback(
    (meetingId: string, element: HTMLElement) => {
      if (slots.current.get(meetingId) !== element) return
      slots.current.delete(meetingId)
      // Keep it alive only while its session is busy
      if (busyId() !== meetingId) {
        setInstances((prev) => {
          const next = { ...prev }
          delete next[meetingId]
          return next
        })
      }
      setSlotTick((n) => n + 1)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const report = useCallback(
    (session: RecorderSession) => {
      const prev = store.get()
      if (session.busy || prev?.meetingId === session.meetingId) store.set(session.busy ? session : null)
      // A finished session whose page is gone: unmount it now
      if (!session.busy && !slots.current.has(session.meetingId)) {
        setInstances((p) => {
          if (!(session.meetingId in p)) return p
          const next = { ...p }
          delete next[session.meetingId]
          return next
        })
      }
    },
    [store]
  )

  const registerControls = useCallback((meetingId: string, c: Controls | null) => {
    if (c) controls.current.set(meetingId, c)
    else controls.current.delete(meetingId)
  }, [])

  const busyElsewhere = useCallback(
    (meetingId: string) => {
      const s = store.get()
      if (s?.busy && s.meetingId !== meetingId) return { meetingId: s.meetingId, label: s.label }
      const lock = readLock()
      if (lock && lock.tabId !== tabId && lock.meetingId !== meetingId) return { meetingId: lock.meetingId, label: `${lock.label} (another tab)` }
      return null
    },
    [store, tabId]
  )

  // Place each recorder's DOM: in its page slot when open, else in the hidden holder; drop released ones
  const placed = useRef(new Set<HTMLDivElement>())
  useLayoutEffect(() => {
    const live = new Set(Object.values(instances).map((i) => i.el))
    for (const el of placed.current) if (!live.has(el)) el.remove()
    placed.current = live
    for (const [meetingId, { el: host }] of Object.entries(instances)) {
      const target = slots.current.get(meetingId) ?? parkRef.current
      if (target && host.parentElement !== target) target.appendChild(host)
    }
  }, [instances, slotTick])

  // Heartbeat for other tabs + warn before closing the tab while a recording is busy
  useEffect(() => {
    const beat = () => {
      const s = store.get()
      try {
        if (s?.busy) localStorage.setItem(LOCK_KEY, JSON.stringify({ tabId, meetingId: s.meetingId, label: s.label, at: Date.now() }))
        else if (readLock()?.tabId === tabId) localStorage.removeItem(LOCK_KEY)
      } catch {
        /* storage unavailable */
      }
    }
    const timer = setInterval(beat, 5000)
    const unsub = store.subscribe(beat)
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!store.get()?.busy) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      clearInterval(timer)
      unsub()
      window.removeEventListener('beforeunload', onBeforeUnload)
      try {
        if (readLock()?.tabId === tabId) localStorage.removeItem(LOCK_KEY)
      } catch {
        /* ignore */
      }
    }
  }, [store, tabId])

  const api = useMemo<HostApi>(
    () => ({ registerSlot, unregisterSlot, report, registerControls, busyElsewhere, store }),
    [registerSlot, unregisterSlot, report, registerControls, busyElsewhere, store]
  )

  return (
    <HostContext.Provider value={api}>
      {children}
      <div ref={parkRef} hidden aria-hidden="true" />
      {Object.entries(instances).map(([meetingId, { props, el }]) => {
        const { label, ...recorderProps } = props
        return createPortal(<MeetingRecorder key={meetingId} {...recorderProps} meetingLabel={label} />, el, meetingId)
      })}
      <RecordingMiniBar store={store} controls={controls} pathname={pathname} />
    </HostContext.Provider>
  )
}

/** Placeholder on the meeting page; the recorder's DOM is moved in here while the page is open. */
export function RecorderSlot(props: SlotProps) {
  const host = useRecordingHost()
  const ref = useRef<HTMLDivElement>(null)
  // Props are plain values: re-register whenever the server sends new ones (router.refresh after processing)
  const propsKey = JSON.stringify(props)

  useLayoutEffect(() => {
    const el = ref.current
    if (!host || !el) return
    const next = JSON.parse(propsKey) as SlotProps
    host.registerSlot(next.meetingId, el, next)
    return () => host.unregisterSlot(next.meetingId, el)
  }, [host, propsKey])

  if (!host) {
    const { label, ...rest } = props
    return <MeetingRecorder {...rest} meetingLabel={label} />
  }
  return <div ref={ref} />
}

function fmt(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
}

const BAR_POS_KEY = 'ami-recording-bar'
const EDGE = 16

interface BarPrefs {
  /** Offsets from the right and bottom edges of the window, px */
  right: number
  bottom: number
  minimized: boolean
}

function loadBarPrefs(): BarPrefs | null {
  try {
    const p = JSON.parse(localStorage.getItem(BAR_POS_KEY) ?? 'null')
    return p && typeof p.right === 'number' && typeof p.bottom === 'number' ? { right: p.right, bottom: p.bottom, minimized: !!p.minimized } : null
  } catch {
    return null
  }
}

function saveBarPrefs(p: BarPrefs) {
  try {
    localStorage.setItem(BAR_POS_KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable */
  }
}

/**
 * Floating "Recording" bar on pages other than the meeting's own. Drag it by the grip (or arrow keys on
 * the grip) anywhere on screen, or minimise it to a small pill; both are remembered in this browser. While
 * it is shown, extra space at the bottom of the page lets you scroll any button out from under it.
 */
function RecordingMiniBar({ store, controls, pathname }: { store: SessionStore; controls: React.RefObject<Map<string, Controls>>; pathname: string }) {
  const session = useSyncExternalStore(store.subscribe, store.get, () => null)
  const [prefs, setPrefs] = useState<BarPrefs | null>(() => (typeof window === 'undefined' ? null : loadBarPrefs()))
  const barRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  if (!session?.busy) return null
  // On its own meeting page the full recorder is already visible
  if (pathname === `/meetings/${session.meetingId}`) return null
  const c = controls.current?.get(session.meetingId)
  const minimized = prefs?.minimized ?? false
  const live = session.recording && !session.paused

  /** Keep the bar fully on screen */
  const clamp = (right: number, bottom: number) => {
    const el = barRef.current
    const w = el?.offsetWidth ?? 320
    const h = el?.offsetHeight ?? 56
    return {
      right: Math.min(Math.max(right, EDGE / 2), window.innerWidth - w - EDGE / 2),
      bottom: Math.min(Math.max(bottom, EDGE / 2), window.innerHeight - h - EDGE / 2),
    }
  }
  const update = (next: Partial<BarPrefs>, persist = true) => {
    setPrefs((prev) => {
      const merged = { right: prev?.right ?? 24, bottom: prev?.bottom ?? 24, minimized: prev?.minimized ?? false, ...next }
      if (persist) saveBarPrefs(merged)
      return merged
    })
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const el = barRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    drag.current = { dx: rect.right - e.clientX, dy: rect.bottom - e.clientY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    update(clamp(window.innerWidth - e.clientX - drag.current.dx, window.innerHeight - e.clientY - drag.current.dy), false)
  }
  const onPointerUp = () => {
    if (!drag.current) return
    drag.current = null
    setPrefs((p) => {
      if (p) saveBarPrefs(p)
      return p
    })
  }
  const onGripKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16
    const cur = { right: prefs?.right ?? 24, bottom: prefs?.bottom ?? 24 }
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    const m = moves[e.key]
    if (!m) return
    e.preventDefault()
    update(clamp(cur.right + m[0], cur.bottom + m[1]))
  }

  const position = prefs ? { right: prefs.right, bottom: prefs.bottom } : undefined
  const dot = (
    <span className="relative flex w-2.5 h-2.5 flex-shrink-0" aria-hidden="true">
      {live && <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 animate-ping" />}
      <span className={`relative inline-flex rounded-full w-2.5 h-2.5 ${live ? 'bg-red-500' : 'bg-amber-400'}`} />
    </span>
  )
  const status = session.recording ? (session.paused ? 'Recording paused' : 'Recording') : 'Recording not saved yet'
  const grip = (
    <span
      role="button"
      tabIndex={0}
      aria-label="Move recording bar (drag, or use arrow keys)"
      title="Drag to move"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onGripKey}
      className="flex items-center justify-center w-5 self-stretch -ml-1 cursor-grab active:cursor-grabbing touch-none opacity-50 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange/50 rounded"
    >
      <GripVertical className="w-4 h-4" aria-hidden="true" />
    </span>
  )

  return (
    <>
      {/* Room at the end of the page so nothing stays hidden under the bar */}
      {!minimized && <div aria-hidden="true" className="h-24 bg-off-white dark:bg-dark-gray" />}
      <div
        ref={barRef}
        role="status"
        aria-live="polite"
        aria-label="Meeting recording"
        style={position}
        className={`fixed z-[60] ${position ? '' : 'bottom-20 lg:bottom-6 right-4 lg:right-6'} flex items-center gap-2 rounded-2xl bg-dark-gray dark:bg-white text-white dark:text-dark-gray shadow-2xl max-w-[calc(100vw-1rem)] ${minimized ? 'pl-2 pr-1.5 py-1.5' : 'pl-2 pr-2 py-2'}`}
      >
        {grip}
        {minimized ? (
          <button
            type="button"
            onClick={() => update({ minimized: false })}
            aria-label={`${status}, ${fmt(session.seconds)}. Expand recording bar`}
            title="Expand"
            className="flex items-center gap-2 px-1.5 py-0.5 rounded-xl hover:bg-white/10 dark:hover:bg-dark-gray/10 focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:outline-none"
          >
            {dot}
            <span className="text-xs tabular-nums">{fmt(session.seconds)}</span>
            <Maximize2 className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
          </button>
        ) : (
          <>
            {dot}
            <div className="min-w-0 pl-1">
              <p className="text-sm font-medium truncate">
                {status}
                <span className="font-normal opacity-70"> · {session.label}</span>
              </p>
              <p className="text-xs tabular-nums opacity-70">{fmt(session.seconds)}</p>
            </div>
            {session.recording && c && (
              <button
                type="button"
                onClick={() => c.togglePause()}
                aria-label={session.paused ? 'Resume recording' : 'Pause recording'}
                className="p-2 rounded-xl hover:bg-white/10 dark:hover:bg-dark-gray/10 transition-colors focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:outline-none"
              >
                {session.paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              </button>
            )}
            <Link
              href={`/meetings/${session.meetingId}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 dark:bg-dark-gray/10 text-sm font-medium hover:bg-white/20 dark:hover:bg-dark-gray/20 transition-colors whitespace-nowrap"
            >
              <Mic className="w-4 h-4" aria-hidden="true" />
              {session.recording ? 'Back to meeting' : 'Save recording'}
            </Link>
            <button
              type="button"
              onClick={() => update({ minimized: true })}
              aria-label="Minimise recording bar"
              title="Minimise"
              className="p-2 rounded-xl hover:bg-white/10 dark:hover:bg-dark-gray/10 transition-colors focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:outline-none"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </>
  )
}
