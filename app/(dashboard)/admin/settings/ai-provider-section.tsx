'use client'

import { useCallback, useEffect, useState } from 'react'
import { Key, Save, Loader2, CheckCircle2, AlertCircle, Eye, EyeOff, TestTube, RefreshCw, ChevronDown } from 'lucide-react'

export type AiProvider = 'OPENAI' | 'OPENROUTER'

export interface AiSettings {
  aiProvider: AiProvider
  openaiApiKey: string
  openaiApiKeySet: boolean
  openaiModel: string
  aiFastModel: string
  whisperModel: string
}

interface ModelOption {
  id: string
  name: string
  description: string
}

const PROVIDER_META: Record<AiProvider, { label: string; blurb: string; keyUrl: string; keyHint: string; defaults: { chat: string; fast: string; stt: string } }> = {
  OPENAI: {
    label: 'OpenAI',
    blurb: 'Direct OpenAI account. GPT models for analysis, Whisper for transcription.',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-…',
    defaults: { chat: 'gpt-4o', fast: 'gpt-4o-mini', stt: 'gpt-4o-transcribe' },
  },
  OPENROUTER: {
    label: 'OpenRouter',
    blurb: 'One key for OpenAI, Anthropic, Google and more — pick a different model per job.',
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or-v1-…',
    defaults: { chat: 'openai/gpt-4o', fast: 'openai/gpt-4o-mini', stt: 'openai/gpt-4o-transcribe' },
  },
}

/** Map a model id across providers so switching never leaves a stale id behind. */
function adaptModel(to: AiProvider, id: string, fallback: string): string {
  const v = id.trim()
  if (!v) return fallback
  if (to === 'OPENROUTER') return v.includes('/') ? v : `openai/${v}`
  return v.startsWith('openai/') ? v.slice(7) : v
}

const inputClass =
  'w-full px-4 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20'

function ModelPicker({
  label,
  hint,
  value,
  onChange,
  options,
  loading,
  onRefresh,
  canRefresh,
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  options: ModelOption[]
  loading: boolean
  onRefresh: () => void
  canRefresh: boolean
}) {
  const known = options.some((o) => o.id === value)
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-dark-gray dark:text-white">{label}</label>
        {canRefresh && (
          <button type="button" onClick={onRefresh} disabled={loading} className="flex items-center gap-1.5 text-xs text-dark-gray dark:text-white hover:text-medium-gray disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </div>
      <div className="grid sm:grid-cols-[1fr_auto] gap-2">
        <div className="relative">
          <select value={known ? value : '__custom'} onChange={(e) => e.target.value !== '__custom' && onChange(e.target.value)} className={`${inputClass} appearance-none pr-10`}>
            {!known && <option value="__custom">Custom: {value}</option>}
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} — {o.description}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-medium-gray pointer-events-none" />
        </div>
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} sm:w-64 font-mono text-sm`} aria-label={`${label} id`} />
      </div>
      <p className="text-xs text-medium-gray">{hint}</p>
    </div>
  )
}

export function AiProviderSection({ initial, onSaved }: { initial: AiSettings | null; onSaved: (s: AiSettings) => void }) {
  const [provider, setProvider] = useState<AiProvider>(initial?.aiProvider && PROVIDER_META[initial.aiProvider] ? initial.aiProvider : 'OPENAI')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [chatModel, setChatModel] = useState(initial?.openaiModel || 'gpt-4o')
  const [fastModel, setFastModel] = useState(initial?.aiFastModel || 'gpt-4o-mini')
  const [sttModel, setSttModel] = useState(initial?.whisperModel || 'gpt-4o-transcribe')
  const [chatOptions, setChatOptions] = useState<ModelOption[]>([])
  const [sttOptions, setSttOptions] = useState<ModelOption[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const keySet = !!initial?.openaiApiKeySet
  const meta = PROVIDER_META[provider] ?? PROVIDER_META.OPENAI
  const providerChanged = initial ? provider !== initial.aiProvider : false

  const fetchModels = useCallback(async () => {
    setLoadingModels(true)
    try {
      const [chat, stt] = await Promise.all([
        fetch('/api/settings/models?kind=chat').then((r) => r.json()),
        fetch('/api/settings/models?kind=transcription').then((r) => r.json()),
      ])
      setChatOptions(chat.models || [])
      setSttOptions(stt.models || [])
      if (chat.error) setMessage({ type: 'error', text: `Could not list models: ${chat.error}` })
    } catch {
      setMessage({ type: 'error', text: 'Could not list models from the provider' })
    } finally {
      setLoadingModels(false)
    }
  }, [])

  useEffect(() => {
    if (initial) {
      if (initial.aiProvider && PROVIDER_META[initial.aiProvider]) setProvider(initial.aiProvider)
      setChatModel(initial.openaiModel)
      setFastModel(initial.aiFastModel)
      setSttModel(initial.whisperModel)
    }
  }, [initial])

  useEffect(() => {
    if (keySet && !providerChanged) fetchModels()
  }, [keySet, providerChanged, fetchModels])

  const switchProvider = (next: AiProvider) => {
    if (next === provider) return
    const d = PROVIDER_META[next].defaults
    setProvider(next)
    setChatModel((v) => adaptModel(next, v, d.chat))
    setFastModel((v) => adaptModel(next, v, d.fast))
    setSttModel((v) => adaptModel(next, v, d.stt))
    setChatOptions([])
    setSttOptions([])
    setMessage({ type: 'success', text: `Switched to ${PROVIDER_META[next].label}. Enter a ${PROVIDER_META[next].label} key and save.` })
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    const updates: Record<string, string> = { aiProvider: provider, openaiModel: chatModel.trim(), aiFastModel: fastModel.trim(), whisperModel: sttModel.trim() }
    if (apiKey && !apiKey.includes('****')) updates.openaiApiKey = apiKey.trim()
    if (providerChanged && !updates.openaiApiKey && keySet) {
      setMessage({ type: 'error', text: `Enter a ${meta.label} API key — the stored key belongs to ${PROVIDER_META[initial!.aiProvider].label}.` })
      setSaving(false)
      return
    }
    try {
      const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
      const data = await res.json()
      if (!res.ok) {
        const detail = Array.isArray(data.details) ? `: ${data.details.map((d: { message: string }) => d.message).join(', ')}` : ''
        setMessage({ type: 'error', text: (data.error || 'Failed to save') + detail })
        return
      }
      setApiKey('')
      onSaved(data)
      setMessage({ type: 'success', text: 'AI settings saved' })
    } catch {
      setMessage({ type: 'error', text: 'Failed to save AI settings' })
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    setMessage(null)
    try {
      const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test-openai' }) })
      const data = await res.json()
      setMessage(res.ok ? { type: 'success', text: data.message } : { type: 'error', text: data.error })
    } catch {
      setMessage({ type: 'error', text: 'Failed to test connection' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
      <div className="p-5 border-b border-off-white dark:border-medium-gray/20 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
          <Key className="w-5 h-5 text-green-500" />
        </div>
        <div>
          <h3 className="font-semibold text-dark-gray dark:text-white">AI Provider</h3>
          <p className="text-sm text-medium-gray">One API key; choose a model for each job (analysis, search, transcription)</p>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {message && (
          <div className={`rounded-xl p-3 flex items-center gap-3 ${message.type === 'success' ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`} role="status">
            {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
            <p className={`text-sm ${message.type === 'success' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{message.text}</p>
          </div>
        )}

        {/* Provider */}
        <div className="grid sm:grid-cols-2 gap-2">
          {(Object.keys(PROVIDER_META) as AiProvider[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => switchProvider(p)}
              className={`p-4 rounded-xl border text-left transition-all ${provider === p ? 'border-dark-gray dark:border-white bg-off-white dark:bg-dark-gray' : 'border-off-white dark:border-medium-gray/20 hover:border-medium-gray/50'}`}
            >
              <p className="font-medium text-dark-gray dark:text-white">{PROVIDER_META[p].label}</p>
              <p className="text-xs text-medium-gray mt-0.5">{PROVIDER_META[p].blurb}</p>
            </button>
          ))}
        </div>

        {/* Key */}
        <div>
          <div className="flex items-center gap-2 text-sm mb-2">
            <span className={`w-2 h-2 rounded-full ${keySet && !providerChanged ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-medium-gray">
              API Key:{' '}
              {keySet && !providerChanged ? (
                <span className="text-green-600 dark:text-green-400">Configured ({initial?.openaiApiKey})</span>
              ) : (
                <span className="text-red-600 dark:text-red-400">{providerChanged ? `${meta.label} key required` : 'Not configured'}</span>
              )}
            </span>
          </div>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keySet && !providerChanged ? 'Enter new key to update' : meta.keyHint}
              className={`${inputClass} pr-12`}
              autoComplete="off"
            />
            <button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-4 top-1/2 -translate-y-1/2 text-medium-gray hover:text-dark-gray dark:hover:text-white" aria-label={showKey ? 'Hide key' : 'Show key'}>
              {showKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          <p className="text-xs text-medium-gray mt-1">
            Get a key from{' '}
            <a href={meta.keyUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
              {meta.keyUrl.replace('https://', '')}
            </a>
          </p>
        </div>

        {/* Models */}
        <ModelPicker
          label="Analysis model"
          hint="Used for meeting analysis, Ask-AI and organisation insights. Needs JSON output support."
          value={chatModel}
          onChange={setChatModel}
          options={chatOptions}
          loading={loadingModels}
          onRefresh={fetchModels}
          canRefresh={keySet && !providerChanged}
        />
        <ModelPicker
          label="Fast model"
          hint="Used for transcript search — high volume, low stakes. Pick something cheap."
          value={fastModel}
          onChange={setFastModel}
          options={chatOptions}
          loading={loadingModels}
          onRefresh={fetchModels}
          canRefresh={keySet && !providerChanged}
        />
        <ModelPicker
          label="Transcription model"
          hint={provider === 'OPENROUTER' ? 'Speech-to-text. openai/gpt-4o-transcribe is the recommended default — markedly better than whisper-1 on Hindi/Gujarati and far less prone to repeated-phrase hallucinations.' : 'Speech-to-text. gpt-4o-transcribe is recommended; whisper-1 is cheaper-looking but drifts scripts on Gujarati/Hindi.'}
          value={sttModel}
          onChange={setSttModel}
          options={sttOptions}
          loading={loadingModels}
          onRefresh={fetchModels}
          canRefresh={keySet && !providerChanged}
        />

        <div className="flex items-center gap-3 pt-2">
          <button onClick={save} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save AI Settings
          </button>
          {keySet && !providerChanged && (
            <button onClick={test} disabled={testing} className="flex items-center gap-2 px-5 py-2.5 border border-off-white dark:border-medium-gray/20 text-dark-gray dark:text-white rounded-xl font-medium hover:bg-off-white dark:hover:bg-charcoal disabled:opacity-50 transition-colors">
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <TestTube className="w-4 h-4" />}
              Test Connection
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
