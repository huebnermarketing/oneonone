'use client'

import { createContext, useContext } from 'react'

/** Shared between the app-wide recording host (recording-host.tsx) and MeetingRecorder — kept separate to avoid an import cycle. */

export interface RecorderSession {
  meetingId: string
  label: string
  /** Recording, paused, or parts recorded but not yet saved/processed */
  busy: boolean
  recording: boolean
  paused: boolean
  /** Seconds recorded so far, all parts */
  seconds: number
}

export interface Controls {
  togglePause: () => void
}

export interface HostApi {
  registerSlot: (meetingId: string, element: HTMLElement, props: unknown) => void
  unregisterSlot: (meetingId: string, element: HTMLElement) => void
  report: (session: RecorderSession) => void
  registerControls: (meetingId: string, controls: Controls | null) => void
  /** The busy session in this tab or another one, if any */
  busyElsewhere: (meetingId: string) => { meetingId: string; label: string } | null
  store: SessionStore
}


export const HostContext = createContext<HostApi | null>(null)
export const useRecordingHost = () => useContext(HostContext)

// ── session store (mini-bar re-renders every second without re-rendering the app) ──

export class SessionStore {
  private session: RecorderSession | null = null
  private listeners = new Set<() => void>()
  get = () => this.session
  set(s: RecorderSession | null) {
    this.session = s
    this.listeners.forEach((l) => l())
  }
  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
}

