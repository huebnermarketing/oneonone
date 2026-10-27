'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic } from 'lucide-react'
import { Select } from '@/components/ui/select'

interface MicOption {
  deviceId: string
  label: string
}

/**
 * Microphone chooser shown next to "Start Recording". '' = the system default microphone (always the
 * initial choice — nothing is remembered). Device names are only exposed by the browser after mic
 * permission, so until then the list offers a one-click "Show my microphones". A live level bar shows
 * the selected mic is picking up sound.
 */
export function MicPicker({ value, onChange }: { value: string; onChange: (deviceId: string) => void }) {
  const [mics, setMics] = useState<MicOption[]>([])
  const [labelsHidden, setLabelsHidden] = useState(false)
  const [level, setLevel] = useState(0)
  const [meterOn, setMeterOn] = useState(false)
  const meterRef = useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null)

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const devices = await navigator.mediaDevices.enumerateDevices()
    const inputs = devices.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    setLabelsHidden(inputs.length > 0 && inputs.every((d) => !d.label))
    setMics(inputs.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` })))
  }, [])

  useEffect(() => {
    void refresh()
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refresh)
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
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2">
        <Mic className="w-4 h-4 text-medium-gray" aria-hidden="true" />
        <Select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Microphone"
          wrapperClassName="inline-block"
          className="w-auto max-w-[16rem] px-3 py-2 focus:ring-orange/50"
        >
          <option value="">System default microphone</option>
          {mics.map((m) => (
            <option key={m.deviceId} value={m.deviceId}>
              {m.label}
            </option>
          ))}
        </Select>
        <button
          type="button"
          onClick={() => setMeterOn((v) => !v)}
          aria-pressed={meterOn}
          className="text-sm text-blue-500 hover:underline whitespace-nowrap"
        >
          {meterOn ? 'Stop test' : labelsHidden ? 'Show my microphones' : 'Test mic'}
        </button>
      </div>
      {meterOn && (
        <div className="w-56 h-2 rounded-full bg-off-white dark:bg-dark-gray overflow-hidden" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
          <div className="h-full bg-green-500 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
      )}
    </div>
  )
}
