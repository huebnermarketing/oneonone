'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Mic } from 'lucide-react'
import { Select } from '@/components/ui/select'

interface MicOption {
  deviceId: string
  label: string
}

/** Chrome/Edge report the OS default as an extra "Default - <name>" entry; strip the prefix. */
const defaultLabel = (label: string) => label.replace(/^default\s*[-–:]\s*/i, '').trim()

/**
 * Microphone chooser shown next to "Start Recording". '' = the system default microphone (always the
 * initial choice — nothing is remembered), shown by its real name ("CORSAIR HS55 (system default)")
 * and following the OS setting when it changes. Device names are only exposed by the browser after
 * mic permission, so until then the list offers a one-click "Show my microphones". A live level bar
 * shows the selected mic is picking up sound.
 */
export function MicPicker({ value, onChange }: { value: string; onChange: (deviceId: string) => void }) {
  const selectId = useId()
  const [mics, setMics] = useState<MicOption[]>([])
  const [labelsHidden, setLabelsHidden] = useState(false)
  /** Name of the OS default input, when the browser tells us */
  const [defaultName, setDefaultName] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const [meterOn, setMeterOn] = useState(false)
  const meterRef = useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null)

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
    const osDefault = devices.find((d) => d.deviceId === 'default')
    if (osDefault?.label) setDefaultName(defaultLabel(osDefault.label))
    // Before mic permission is granted for this site, Chrome lists one input with no id and no name
    // (Safari/Firefox: ids but no names) — the real list needs permission first
    setLabelsHidden(devices.length === 0 || devices.every((d) => !d.label))
    const inputs = devices.filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    setMics(inputs.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` })))
  }, [])

  // Ask for mic permission once (the browser prompt), then release the mic and load the real list
  const unlock = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
    } catch {
      // denied: the recorder's own troubleshooting covers this when recording starts
    }
    await refresh()
  }, [refresh])

  useEffect(() => {
    void refresh()
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh)
    // Permission granted in the browser's site settings → load the list without a reload
    let perm: PermissionStatus | null = null
    navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((status) => {
        perm = status
        status.addEventListener('change', refresh)
      })
      .catch(() => {})
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', refresh)
      perm?.removeEventListener('change', refresh)
    }
  }, [refresh])

  // If the chosen mic is unplugged, fall back to the system default
  useEffect(() => {
    if (value && mics.length > 0 && !mics.some((m) => m.deviceId === value)) onChange('')
  }, [mics, value, onChange])

  const stopMeter = useCallback(() => {
    const m = meterRef.current
    if (!m) return
    cancelAnimationFrame(m.raf)
    m.stream.getTracks().forEach((t) => t.stop())
    void m.ctx.close()
    meterRef.current = null
    setLevel(0)
  }, [])

  const startMeter = useCallback(
    async (deviceId: string) => {
      stopMeter()
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true })
        // Browsers without a "default" entry (Safari, Firefox): the default stream's track names the device
        const track = stream.getAudioTracks()[0]
        if (!deviceId && track?.label) setDefaultName(defaultLabel(track.label))
        const ctx = new AudioContext()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        ctx.createMediaStreamSource(stream).connect(analyser)
        const data = new Uint8Array(analyser.fftSize)
        const tick = () => {
          analyser.getByteTimeDomainData(data)
          let peak = 0
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
          setLevel(Math.min(1, peak / 64))
          if (meterRef.current) meterRef.current.raf = requestAnimationFrame(tick)
        }
        meterRef.current = { stream, ctx, raf: requestAnimationFrame(tick) }
        void refresh() // permission granted → real device names
      } catch {
        setMeterOn(false)
      }
    },
    [refresh, stopMeter]
  )

  // Meter follows the selection while it's on; always released on unmount (e.g. when recording starts)
  useEffect(() => {
    if (meterOn) void startMeter(value)
    else stopMeter()
  }, [meterOn, value, startMeter, stopMeter])
  useEffect(() => stopMeter, [stopMeter])

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between mb-1.5">
        <label htmlFor={selectId} className="flex items-center gap-1.5 text-xs font-medium text-medium-gray">
          <Mic className="w-3.5 h-3.5" aria-hidden="true" />
          Microphone
        </label>
        {labelsHidden && !meterOn ? (
          <button type="button" onClick={unlock} className="text-xs font-medium text-blue-500 hover:underline">
            Show my microphones
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setMeterOn((v) => !v)}
            aria-pressed={meterOn}
            className="text-xs font-medium text-blue-500 hover:underline"
          >
            {meterOn ? 'Stop test' : 'Test mic'}
          </button>
        )}
      </div>
      <Select id={selectId} value={value} onChange={(e) => onChange(e.target.value)} className="px-3 py-2.5 truncate focus:ring-orange/50">
        <option value="">{defaultName ? `${defaultName} (system default)` : 'System default microphone'}</option>
        {/* the default device is already the first option; listing it again just confuses */}
        {mics.filter((m) => m.label !== defaultName).map((m) => (
          <option key={m.deviceId} value={m.deviceId}>
            {m.label}
          </option>
        ))}
      </Select>
      {labelsHidden && (
        <p className="mt-1.5 text-xs text-medium-gray">Allow microphone access to see and pick a specific mic.</p>
      )}
      {meterOn && (
        <div className="mt-2 h-1.5 rounded-full bg-off-white dark:bg-dark-gray overflow-hidden" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
          <div className="h-full bg-green-500 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
      )}
    </div>
  )
}
