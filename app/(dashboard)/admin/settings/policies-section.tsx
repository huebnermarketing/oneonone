'use client'

import { useEffect, useState } from 'react'
import { ShieldCheck, Save, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { WEEK_ORDER, WEEKDAY_SHORT } from '@/lib/working-days'

export type CancelPolicy = 'ADMIN_ONLY' | 'REPORTER_AND_ADMIN' | 'ANY_PARTICIPANT'

export interface Policies {
  requireFormBeforeComplete: boolean
  cancelPolicy: CancelPolicy
  employeeCanViewRecording: boolean
  employeeCanViewNotes: boolean
  enableEmailReminders: boolean
  reminderHoursBefore: number
  shortReminderHoursBefore: number
  workingDays: number[]
}

const CANCEL_OPTIONS: { value: CancelPolicy; label: string; desc: string }[] = [
  { value: 'ADMIN_ONLY', label: 'Admins only', desc: 'Only Super Admins can cancel a meeting' },
  { value: 'REPORTER_AND_ADMIN', label: 'Reporter and admins', desc: 'The reporting manager running the 1:1, or an admin' },
  { value: 'ANY_PARTICIPANT', label: 'Either participant', desc: 'Employee or reporter can cancel their own meeting' },
]

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description: string
}) {
  return (
    <label className="flex items-start gap-3 p-4 rounded-xl border border-off-white dark:border-medium-gray/20 cursor-pointer hover:border-medium-gray/40 transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-5 h-5 rounded border-medium-gray text-dark-gray focus:ring-dark-gray/30"
      />
      <span>
        <span className="block font-medium text-dark-gray dark:text-white">{label}</span>
        <span className="block text-sm text-medium-gray">{description}</span>
      </span>
    </label>
  )
}

const inputClass =
  'w-24 px-3 py-2 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20'

/**
 * Admin → Settings → Policies. Receives the current values from the parent (loaded from GET /api/settings)
 * and saves only this section via PUT /api/settings.
 */
export function PoliciesSection({ initial }: { initial: Policies | null }) {
  const [form, setForm] = useState<Policies | null>(initial)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    setForm(initial)
  }, [initial])

  if (!form) return null

  const set = <K extends keyof Policies>(key: K, value: Policies[K]) => setForm({ ...form, [key]: value })

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (res.ok) {
        setMessage({ type: 'success', text: 'Policies saved' })
      } else {
        const detail = Array.isArray(data.details) ? `: ${data.details.map((d: { message: string }) => d.message).join(', ')}` : ''
        setMessage({ type: 'error', text: (data.error || 'Failed to save policies') + detail })
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to save policies' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
      <div className="p-5 border-b border-off-white dark:border-medium-gray/20 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-off-white dark:bg-dark-gray flex items-center justify-center">
          <ShieldCheck className="w-5 h-5 text-dark-gray dark:text-white" />
        </div>
        <div>
          <h3 className="font-semibold text-dark-gray dark:text-white">Policies</h3>
          <p className="text-sm text-medium-gray">Who can do what, and what employees can see. Applies immediately to everyone.</p>
        </div>
      </div>

      <div className="p-5 space-y-6">
        {/* Meetings */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-medium-gray">Meetings</h4>
          <div className="p-4 rounded-xl border border-off-white dark:border-medium-gray/20 space-y-3">
            <div>
              <p className="font-medium text-dark-gray dark:text-white">Working days</p>
              <p className="text-sm text-medium-gray">1:1s can only be scheduled or moved to these days (in the scheduler&apos;s timezone). Other days are greyed out.</p>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Working days">
              {WEEK_ORDER.map((d) => {
                const on = form.workingDays.includes(d)
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      set('workingDays', on ? form.workingDays.filter((x) => x !== d) : [...form.workingDays, d].sort((a, b) => a - b))
                    }
                    className={cn(
                      'w-14 h-10 rounded-xl text-sm font-medium border transition-colors',
                      on
                        ? 'bg-dark-gray text-white border-dark-gray dark:bg-white dark:text-dark-gray dark:border-white'
                        : 'border-off-white dark:border-medium-gray/20 text-medium-gray hover:text-dark-gray dark:hover:text-white'
                    )}
                  >
                    {WEEKDAY_SHORT[d]}
                  </button>
                )
              })}
            </div>
            {form.workingDays.length === 0 && <p className="text-sm text-red-500">Pick at least one day.</p>}
          </div>
          <Toggle
            checked={form.requireFormBeforeComplete}
            onChange={(v) => set('requireFormBeforeComplete', v)}
            label="Require the check-in form before completing"
            description="A meeting cannot be marked Completed until the employee has submitted their one-on-one form."
          />
          <div className="p-4 rounded-xl border border-off-white dark:border-medium-gray/20 space-y-3">
            <p className="font-medium text-dark-gray dark:text-white">Who can cancel a meeting</p>
            <div className="grid sm:grid-cols-3 gap-2">
              {CANCEL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => set('cancelPolicy', opt.value)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    form.cancelPolicy === opt.value
                      ? 'border-dark-gray dark:border-white bg-off-white dark:bg-dark-gray'
                      : 'border-off-white dark:border-medium-gray/20 hover:border-medium-gray/50'
                  }`}
                >
                  <p className="font-medium text-sm text-dark-gray dark:text-white">{opt.label}</p>
                  <p className="text-xs text-medium-gray">{opt.desc}</p>
                </button>
              ))}
            </div>
            <p className="text-xs text-medium-gray">Super Admins can always cancel. Cancelling removes the calendar event and notifies the other party.</p>
          </div>
        </div>

        {/* Employee visibility */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-medium-gray">Employee visibility</h4>
          <Toggle
            checked={form.employeeCanViewRecording}
            onChange={(v) => set('employeeCanViewRecording', v)}
            label="Employees can view their own recordings"
            description="Lets the employee open the audio, transcript and AI analysis of their own one-on-ones. Recording is still started by the reporter."
          />
          <Toggle
            checked={form.employeeCanViewNotes}
            onChange={(v) => set('employeeCanViewNotes', v)}
            label="Employees can read meeting notes"
            description="Shows the reporter's free-text notes on the meeting page to the employee (read-only)."
          />
        </div>

        {/* Reminders */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-medium-gray">Reminders</h4>
          <Toggle
            checked={form.enableEmailReminders}
            onChange={(v) => set('enableEmailReminders', v)}
            label="Send reminder emails"
            description="In-app reminders are always created; this controls the email copy."
          />
          <div className="grid sm:grid-cols-2 gap-4 p-4 rounded-xl border border-off-white dark:border-medium-gray/20">
            <div>
              <label className="block text-sm font-medium text-dark-gray dark:text-white mb-1">First reminder (hours before)</label>
              <input
                type="number"
                min={1}
                max={168}
                value={form.reminderHoursBefore}
                onChange={(e) => set('reminderHoursBefore', parseInt(e.target.value) || 24)}
                className={inputClass}
              />
              <p className="text-xs text-medium-gray mt-1">Email + in-app, to both participants.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-gray dark:text-white mb-1">Short-notice reminder (hours before)</label>
              <input
                type="number"
                min={0}
                max={48}
                value={form.shortReminderHoursBefore}
                onChange={(e) => set('shortReminderHoursBefore', parseInt(e.target.value) || 0)}
                className={inputClass}
              />
              <p className="text-xs text-medium-gray mt-1">In-app only. Set to 0 to disable.</p>
            </div>
          </div>
        </div>

        {message && (
          <div
            className={`flex items-center gap-2 text-sm ${message.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}
            role="status"
          >
            {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {message.text}
          </div>
        )}

        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Policies
        </button>
      </div>
    </div>
  )
}
