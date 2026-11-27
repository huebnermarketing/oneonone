'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'

const SKIP_SECONDS = 15
const SPEEDS = [1, 1.25, 1.5, 2] as const

function fmt(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = (s % 60).toString().padStart(2, '0')
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export interface AudioPlayerProps {
  src: string
  /** Length in seconds from our own records — used while the browser can't tell (recordings made before they were seekable) */
  knownDuration?: number | null
  /** Smaller layout without speed / volume (recorder part previews) */
  compact?: boolean
  label?: string
  className?: string
}

/**
 * Same controls in every browser (the native <audio controls> differ: Safari has ±15 s, Chrome doesn't):
 * play/pause, back/forward 15 s, scrubber with time, speed (1×–2×), mute + volume.
 * Keyboard inside the player: Space / K play-pause, ← / → 15 s, M mute.
 *
 * Browser-recorded WebM without a duration reports Infinity; the player asks the browser to work it out
 * (seek to the end once) so scrubbing and skipping work, and shows `knownDuration` meanwhile.
 */
export function AudioPlayer({ src, knownDuration, compact = false, label = 'Recording', className }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const probing = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState<number>(knownDuration && knownDuration > 0 ? knownDuration : 0)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)

  const audio = () => audioRef.current

  const readDuration = useCallback(() => {
    const a = audioRef.current
    if (!a) return
    if (Number.isFinite(a.duration) && a.duration > 0) {
      setDuration(a.duration)
      if (probing.current) {
        probing.current = false
        a.currentTime = 0
        setCurrent(0)
      }
    } else if (a.duration === Infinity && !probing.current) {
      // No duration in the file: seeking far past the end makes the browser scan it and report the real one
      probing.current = true
      a.currentTime = 1e101
    }
  }, [])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    a.playbackRate = speed
  }, [speed])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    a.muted = muted
    a.volume = volume
  }, [muted, volume])

  const toggle = () => {
    const a = audio()
    if (!a) return
    if (a.paused) a.play().catch(() => setPlaying(false))
    else a.pause()
  }

  const seekTo = (t: number) => {
    const a = audio()
    if (!a) return
    const max = duration || (Number.isFinite(a.duration) ? a.duration : t)
    const next = Math.max(0, Math.min(t, max))
    a.currentTime = next
    setCurrent(next)
  }
  const skip = (delta: number) => seekTo((audio()?.currentTime ?? current) + delta)

  const cycleSpeed = () => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName
    if (e.key === 'ArrowLeft' || e.key === 'j') {
      e.preventDefault()
      skip(-SKIP_SECONDS)
    } else if (e.key === 'ArrowRight' || e.key === 'l') {
      e.preventDefault()
      skip(SKIP_SECONDS)
    } else if ((e.key === ' ' && tag !== 'BUTTON') || e.key === 'k') {
      e.preventDefault()
      toggle()
    } else if (e.key === 'm') {
      setMuted((m) => !m)
    }
  }

  const iconBtn =
    'relative flex items-center justify-center rounded-full text-dark-gray dark:text-white hover:bg-white dark:hover:bg-dark-gray transition-colors focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:outline-none disabled:opacity-40'
  const total = duration
  const progress = total > 0 ? Math.min(100, (current / total) * 100) : 0

  return (
    <div
      role="group"
      aria-label={`${label} player`}
      onKeyDown={onKeyDown}
      className={cn('flex items-center gap-1.5 sm:gap-2 min-w-0', compact ? '' : 'rounded-xl bg-off-white dark:bg-charcoal px-2 sm:px-3 py-2', className)}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={readDuration}
        onDurationChange={readDuration}
        onTimeUpdate={() => {
          const a = audio()
          if (a && !probing.current) setCurrent(a.currentTime)
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          seekTo(0)
        }}
      />

      <button type="button" onClick={() => skip(-SKIP_SECONDS)} className={cn(iconBtn, compact ? 'w-8 h-8' : 'w-9 h-9')} aria-label={`Back ${SKIP_SECONDS} seconds`} title={`Back ${SKIP_SECONDS}s (←)`}>
        <RotateCcw className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
        <span className="absolute text-[8px] font-bold leading-none pt-px">{SKIP_SECONDS}</span>
      </button>
      <button
        type="button"
        onClick={toggle}
        className={cn('flex items-center justify-center rounded-full bg-dark-gray dark:bg-white text-white dark:text-dark-gray hover:bg-charcoal dark:hover:bg-off-white transition-colors focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:outline-none flex-shrink-0', compact ? 'w-8 h-8' : 'w-10 h-10')}
        aria-label={playing ? 'Pause' : 'Play'}
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>
      <button type="button" onClick={() => skip(SKIP_SECONDS)} className={cn(iconBtn, compact ? 'w-8 h-8' : 'w-9 h-9')} aria-label={`Forward ${SKIP_SECONDS} seconds`} title={`Forward ${SKIP_SECONDS}s (→)`}>
        <RotateCw className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
        <span className="absolute text-[8px] font-bold leading-none pt-px">{SKIP_SECONDS}</span>
      </button>

      <span className="text-xs tabular-nums text-medium-gray w-11 text-right flex-shrink-0">{fmt(current)}</span>
      <input
        type="range"
        min={0}
        max={total || 0}
        step={0.1}
        value={Math.min(current, total || 0)}
        onChange={(e) => seekTo(Number(e.target.value))}
        disabled={!total}
        aria-label="Seek"
        aria-valuetext={`${fmt(current)} of ${fmt(total)}`}
        className="flex-1 min-w-[60px] h-1.5 rounded-full appearance-none cursor-pointer accent-orange disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:ring-offset-2"
        style={{ background: `linear-gradient(to right, #F37022 ${progress}%, rgba(127,127,127,0.25) ${progress}%)` }}
      />
      <span className="text-xs tabular-nums text-medium-gray w-11 flex-shrink-0">{total ? fmt(total) : '--:--'}</span>

      {!compact && (
        <>
          <button
            type="button"
            onClick={cycleSpeed}
            className="px-2 h-8 rounded-lg text-xs font-semibold tabular-nums text-dark-gray dark:text-white hover:bg-white dark:hover:bg-dark-gray transition-colors focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:outline-none flex-shrink-0"
            aria-label={`Playback speed ${speed}×, change`}
            title="Playback speed"
          >
            {speed}×
          </button>
          <button type="button" onClick={() => setMuted((m) => !m)} className={cn(iconBtn, 'w-8 h-8 flex-shrink-0')} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute (M)' : 'Mute (M)'}>
            {muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => {
              setVolume(Number(e.target.value))
              setMuted(Number(e.target.value) === 0)
            }}
            aria-label="Volume"
            className="hidden md:block w-20 h-1.5 accent-orange cursor-pointer flex-shrink-0"
          />
        </>
      )}
    </div>
  )
}
