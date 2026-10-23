'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { 
  Key, 
  Cloud, 
  Mic, 
  Save, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Eye,
  EyeOff,
  TestTube,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Database,
  Users,
  Calendar,
  FileText,
  Building2
} from 'lucide-react'
import { PoliciesSection, type Policies } from './policies-section'

interface Settings extends Policies {
  openaiApiKey: string
  openaiApiKeySet: boolean
  openaiModel: string
  whisperModel: string
  awsRegion: string
  awsAccessKeyId: string
  awsAccessKeyIdSet: boolean
  awsSecretKey: string
  awsSecretKeySet: boolean
  awsS3Bucket: string
  maxRecordingMins: number
}

interface OpenAIModel {
  id: string
  name: string
  description: string
}

export function SettingsClient() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testingS3, setTestingS3] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [openaiMessage, setOpenaiMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [awsMessage, setAwsMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Form state
  const [openaiApiKey, setOpenaiApiKey] = useState('')
  const [openaiModel, setOpenaiModel] = useState('gpt-4o')
  const [whisperModel, setWhisperModel] = useState('whisper-1')
  const [awsRegion, setAwsRegion] = useState('')
  const [awsAccessKeyId, setAwsAccessKeyId] = useState('')
  const [awsSecretKey, setAwsSecretKey] = useState('')
  const [awsS3Bucket, setAwsS3Bucket] = useState('')
  const [maxRecordingMins, setMaxRecordingMins] = useState(25)

  // Show/hide sensitive fields
  const [showOpenaiKey, setShowOpenaiKey] = useState(false)
  const [showAwsSecret, setShowAwsSecret] = useState(false)

  // Available models
  const [availableModels, setAvailableModels] = useState<OpenAIModel[]>([])
  const [loadingModels, setLoadingModels] = useState(false)

  // Clear data state
  const [dataCounts, setDataCounts] = useState<{
    recordings: number
    todos: number
    meetings: number
    calendarEvents: number
    users: number
    departments: number
  } | null>(null)
  const [clearType, setClearType] = useState<string>('all')
  const [keepCurrentUser, setKeepCurrentUser] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [clearConfirmText, setClearConfirmText] = useState('')

  useEffect(() => {
    fetchSettings()
    fetchDataCounts()
  }, [])

  // Fetch available models when API key is set
  useEffect(() => {
    if (settings?.openaiApiKeySet) {
      fetchAvailableModels()
    }
  }, [settings?.openaiApiKeySet])

  const fetchAvailableModels = async () => {
    setLoadingModels(true)
    try {
      const response = await fetch('/api/settings/models')
      if (response.ok) {
        const data = await response.json()
        setAvailableModels(data.models)
      }
    } catch (error) {
      // Error handled by toast
    } finally {
      setLoadingModels(false)
    }
  }

  const fetchDataCounts = async () => {
    try {
      const response = await fetch('/api/admin/clear-data')
      if (response.ok) {
        const data = await response.json()
        setDataCounts(data)
      }
    } catch (error) {
      // Error handled by toast
    }
  }

  const handleClearData = async () => {
    setClearing(true)
    try {
      const response = await fetch('/api/admin/clear-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearType, keepCurrentUser, confirm: clearConfirmText.trim() }),
      })

      const data = await response.json()
      
      if (response.ok) {
        setMessage({ 
          type: 'success', 
          text: `Successfully cleared data. Deleted: ${Object.entries(data.deleted)
            .filter(([_, count]) => (count as number) > 0)
            .map(([key, count]) => `${count} ${key}`)
            .join(', ') || 'No data to clear'}`
        })
        fetchDataCounts()
        setShowClearConfirm(false)
        setClearConfirmText('')
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to clear data' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to clear data' })
    } finally {
      setClearing(false)
    }
  }

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/settings')
      if (response.ok) {
        const data = await response.json()
        setSettings(data)
        setOpenaiModel(data.openaiModel || 'gpt-4o')
        setWhisperModel(data.whisperModel || 'whisper-1')
        setAwsRegion(data.awsRegion || '')
        setAwsS3Bucket(data.awsS3Bucket || '')
        setMaxRecordingMins(data.maxRecordingMins || 25)
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to load settings' })
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (section: 'openai' | 'aws' | 'recording') => {
    setSaving(true)
    // Clear section-specific messages
    if (section === 'openai') setOpenaiMessage(null)
    if (section === 'aws') setAwsMessage(null)
    setMessage(null)

    try {
      let updates: Record<string, string | number | null> = {}

      if (section === 'openai') {
        updates = {
          openaiModel,
          whisperModel,
        }
        // Only include API key if it was changed (not empty and different from masked value)
        if (openaiApiKey && !openaiApiKey.includes('****')) {
          updates.openaiApiKey = openaiApiKey
        }
      } else if (section === 'aws') {
        // Always include region and bucket (even if empty to allow clearing)
        updates = {
          awsRegion: awsRegion || null,
          awsS3Bucket: awsS3Bucket || null,
        }
        // Only include credentials if provided (not empty and not masked)
        if (awsAccessKeyId && !awsAccessKeyId.includes('****')) {
          updates.awsAccessKeyId = awsAccessKeyId
        }
        if (awsSecretKey && !awsSecretKey.includes('****')) {
          updates.awsSecretKey = awsSecretKey
        }
      } else if (section === 'recording') {
        updates = { maxRecordingMins }
      }

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })

      if (response.ok) {
        const data = await response.json()
        setSettings(data)
        
        // Set section-specific success message
        const successMsg = { type: 'success' as const, text: 'Settings saved successfully' }
        if (section === 'openai') {
          setOpenaiMessage(successMsg)
          setOpenaiApiKey('')
        } else if (section === 'aws') {
          setAwsMessage(successMsg)
          setAwsAccessKeyId('')
          setAwsSecretKey('')
        } else {
          setMessage(successMsg)
        }
      } else {
        const error = await response.json()
        const errorMsg = { type: 'error' as const, text: error.error || 'Failed to save settings' }
        if (section === 'openai') setOpenaiMessage(errorMsg)
        else if (section === 'aws') setAwsMessage(errorMsg)
        else setMessage(errorMsg)
      }
    } catch (error) {
      const errorMsg = { type: 'error' as const, text: 'Failed to save settings' }
      if (section === 'openai') setOpenaiMessage(errorMsg)
      else if (section === 'aws') setAwsMessage(errorMsg)
      else setMessage(errorMsg)
    } finally {
      setSaving(false)
    }
  }

  const handleTestOpenAI = async () => {
    setTesting(true)
    setOpenaiMessage(null)

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test-openai' }),
      })

      const data = await response.json()

      if (response.ok) {
        setOpenaiMessage({ type: 'success', text: data.message })
      } else {
        setOpenaiMessage({ type: 'error', text: data.error })
      }
    } catch (error) {
      setOpenaiMessage({ type: 'error', text: 'Failed to test connection' })
    } finally {
      setTesting(false)
    }
  }

  const handleTestS3 = async () => {
    setTestingS3(true)
    setAwsMessage(null)

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test-s3' }),
      })

      const data = await response.json()

      if (response.ok) {
        setAwsMessage({ type: 'success', text: data.message })
      } else {
        setAwsMessage({ type: 'error', text: data.error })
      }
    } catch (error) {
      setAwsMessage({ type: 'error', text: 'Failed to test S3 connection' })
    } finally {
      setTestingS3(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-medium-gray animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Message */}
      {message && (
        <div className={`rounded-xl p-4 flex items-center gap-3 ${
          message.type === 'success' 
            ? 'bg-green-500/10 border border-green-500/20' 
            : 'bg-red-500/10 border border-red-500/20'
        }`}>
          {message.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          )}
          <p className={message.type === 'success' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
            {message.text}
          </p>
        </div>
      )}

      {/* OpenAI Configuration */}
      <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
        <div className="p-5 border-b border-off-white dark:border-medium-gray/20 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
            <Key className="w-5 h-5 text-green-500" />
          </div>
          <div>
            <h3 className="font-semibold text-dark-gray dark:text-white">OpenAI Configuration</h3>
            <p className="text-sm text-medium-gray">Configure OpenAI API for transcription and analysis</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* OpenAI Message */}
          {openaiMessage && (
            <div className={`rounded-xl p-3 flex items-center gap-3 ${
              openaiMessage.type === 'success' 
                ? 'bg-green-500/10 border border-green-500/20' 
                : 'bg-red-500/10 border border-red-500/20'
            }`}>
              {openaiMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              )}
              <p className={`text-sm ${openaiMessage.type === 'success' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                {openaiMessage.text}
              </p>
            </div>
          )}

          {/* API Key Status */}
          <div className="flex items-center gap-2 text-sm">
            <span className={`w-2 h-2 rounded-full ${settings?.openaiApiKeySet ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-medium-gray">
              API Key: {settings?.openaiApiKeySet ? (
                <span className="text-green-600 dark:text-green-400">Configured ({settings.openaiApiKey})</span>
              ) : (
                <span className="text-red-600 dark:text-red-400">Not configured</span>
              )}
            </span>
          </div>

          {/* API Key Input */}
          <div>
            <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
              OpenAI API Key
            </label>
            <div className="relative">
              <input
                type={showOpenaiKey ? 'text' : 'password'}
                value={openaiApiKey}
                onChange={(e) => setOpenaiApiKey(e.target.value)}
                placeholder={settings?.openaiApiKeySet ? 'Enter new key to update' : 'sk-...'}
                className="w-full px-4 py-3 pr-12 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20"
              />
              <button
                type="button"
                onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-medium-gray hover:text-dark-gray dark:hover:text-white"
              >
                {showOpenaiKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <p className="text-xs text-medium-gray mt-1">
              Get your API key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">platform.openai.com</a>
            </p>
          </div>

          {/* Model Selection */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-dark-gray dark:text-white">
                GPT Model (Analysis)
              </label>
              {settings?.openaiApiKeySet && (
                <button
                  onClick={fetchAvailableModels}
                  disabled={loadingModels}
                  className="flex items-center gap-1.5 text-xs text-dark-gray dark:text-white hover:text-medium-gray disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingModels ? 'animate-spin' : ''}`} />
                  Refresh Models
                </button>
              )}
            </div>
            
            {availableModels.length > 0 ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {availableModels.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => setOpenaiModel(model.id)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      openaiModel === model.id
                        ? 'border-dark-gray dark:border-white bg-dark-gray/5 dark:bg-white/5 ring-2 ring-dark-gray/10 dark:ring-white/10'
                        : 'border-off-white dark:border-medium-gray/20 hover:border-medium-gray/50'
                    }`}
                  >
                    <p className={`font-medium text-sm ${
                      openaiModel === model.id ? 'text-dark-gray dark:text-white' : 'text-dark-gray dark:text-white'
                    }`}>
                      {model.name}
                    </p>
                    <p className="text-xs text-medium-gray mt-0.5">{model.description}</p>
                  </button>
                ))}
              </div>
            ) : (
              <select
                value={openaiModel}
                onChange={(e) => setOpenaiModel(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20"
              >
                <optgroup label="Latest Models">
                  <option value="gpt-4.5-preview">GPT-4.5 Preview (Newest)</option>
                  <option value="gpt-4o">GPT-4o (Recommended)</option>
                  <option value="gpt-4o-mini">GPT-4o Mini (Fast & Affordable)</option>
                </optgroup>
                <optgroup label="Reasoning Models">
                  <option value="o1">o1 (Advanced Reasoning)</option>
                  <option value="o1-mini">o1-mini (Fast Reasoning)</option>
                  <option value="o1-preview">o1 Preview</option>
                </optgroup>
                <optgroup label="Previous Generation">
                  <option value="gpt-4-turbo">GPT-4 Turbo</option>
                  <option value="gpt-4">GPT-4</option>
                  <option value="gpt-3.5-turbo">GPT-3.5 Turbo (Budget)</option>
                </optgroup>
              </select>
            )}
            
            <p className="text-xs text-medium-gray">
              Selected: <span className="font-medium text-dark-gray dark:text-white">{openaiModel}</span>
              {!settings?.openaiApiKeySet && ' • Add API key to fetch latest available models'}
            </p>
          </div>

          {/* Whisper Model */}
          <div>
            <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
              Whisper Model (Transcription)
            </label>
            <select
              value={whisperModel}
              onChange={(e) => setWhisperModel(e.target.value)}
              className="w-full sm:w-64 px-4 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20"
            >
              <option value="whisper-1">Whisper-1 (Multilingual)</option>
            </select>
            <p className="text-xs text-medium-gray mt-1">Whisper supports 50+ languages including Hindi, Gujarati, English</p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => handleSave('openai')}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save OpenAI Settings
            </button>

            {settings?.openaiApiKeySet && (
              <button
                onClick={handleTestOpenAI}
                disabled={testing}
                className="flex items-center gap-2 px-5 py-2.5 border border-off-white dark:border-medium-gray/20 text-dark-gray dark:text-white rounded-xl font-medium hover:bg-off-white dark:hover:bg-charcoal disabled:opacity-50 transition-colors"
              >
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <TestTube className="w-4 h-4" />}
                Test Connection
              </button>
            )}
          </div>
        </div>
      </div>

      {/* AWS S3 Configuration */}
      <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
        <div className="p-5 border-b border-off-white dark:border-medium-gray/20 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
            <Cloud className="w-5 h-5 text-blue-500" />
          </div>
          <div>
            <h3 className="font-semibold text-dark-gray dark:text-white">AWS S3 Configuration</h3>
            <p className="text-sm text-medium-gray">Configure S3 storage for meeting recordings</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* AWS Message */}
          {awsMessage && (
            <div className={`rounded-xl p-3 flex items-center gap-3 ${
              awsMessage.type === 'success' 
                ? 'bg-green-500/10 border border-green-500/20' 
                : 'bg-red-500/10 border border-red-500/20'
            }`}>
              {awsMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              )}
              <p className={`text-sm ${awsMessage.type === 'success' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                {awsMessage.text}
              </p>
            </div>
          )}

          {/* Status - Check ALL required fields */}
          {(() => {
            const hasRegion = !!settings?.awsRegion
            const hasAccessKey = !!settings?.awsAccessKeyIdSet
            const hasSecretKey = !!settings?.awsSecretKeySet
            const hasBucket = !!settings?.awsS3Bucket
            const isFullyConfigured = hasRegion && hasAccessKey && hasSecretKey && hasBucket
            const isPartiallyConfigured = hasRegion || hasAccessKey || hasSecretKey || hasBucket
            
            return (
              <div className="flex items-center gap-2 text-sm">
                <span className={`w-2 h-2 rounded-full ${
                  isFullyConfigured ? 'bg-green-500' : isPartiallyConfigured ? 'bg-yellow-500' : 'bg-red-500'
                }`} />
                <span className="text-medium-gray">
                  S3 Configuration: {isFullyConfigured ? (
                    <span className="text-green-600 dark:text-green-400">Fully Configured</span>
                  ) : isPartiallyConfigured ? (
                    <span className="text-yellow-600 dark:text-yellow-400">
                      Incomplete ({[
                        !hasRegion && 'Region',
                        !hasAccessKey && 'Access Key',
                        !hasSecretKey && 'Secret Key',
                        !hasBucket && 'Bucket'
                      ].filter(Boolean).join(', ')} missing)
                    </span>
                  ) : (
                    <span className="text-red-600 dark:text-red-400">Not configured</span>
                  )}
                </span>
              </div>
            )
          })()}

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
                AWS Region
              </label>
              <input
                type="text"
                value={awsRegion}
                onChange={(e) => setAwsRegion(e.target.value)}
                placeholder="ap-south-1"
                className="w-full px-4 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
                S3 Bucket Name
              </label>
              <input
                type="text"
                value={awsS3Bucket}
                onChange={(e) => setAwsS3Bucket(e.target.value)}
                placeholder="ami-one-on-one-recordings"
                className="w-full px-4 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
              AWS Access Key ID
            </label>
            <input
              type="text"
              value={awsAccessKeyId}
              onChange={(e) => setAwsAccessKeyId(e.target.value)}
              placeholder={settings?.awsAccessKeyIdSet ? 'Enter new key to update' : 'AKIA...'}
              className="w-full px-4 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
              AWS Secret Access Key
            </label>
            <div className="relative">
              <input
                type={showAwsSecret ? 'text' : 'password'}
                value={awsSecretKey}
                onChange={(e) => setAwsSecretKey(e.target.value)}
                placeholder={settings?.awsSecretKeySet ? 'Enter new key to update' : 'Your secret key'}
                className="w-full px-4 py-3 pr-12 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20"
              />
              <button
                type="button"
                onClick={() => setShowAwsSecret(!showAwsSecret)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-medium-gray hover:text-dark-gray dark:hover:text-white"
              >
                {showAwsSecret ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => handleSave('aws')}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save AWS Settings
            </button>

            <button
              onClick={handleTestS3}
              disabled={testingS3}
              className="flex items-center gap-2 px-5 py-2.5 border border-off-white dark:border-medium-gray/20 text-dark-gray dark:text-white rounded-xl font-medium hover:bg-off-white dark:hover:bg-charcoal disabled:opacity-50 transition-colors"
            >
              {testingS3 ? <Loader2 className="w-4 h-4 animate-spin" /> : <TestTube className="w-4 h-4" />}
              Test S3 Connection
            </button>

            <Link
              href="/admin/storage"
              className="flex items-center gap-2 px-5 py-2.5 text-orange hover:text-orange/80 font-medium rounded-xl transition-colors"
            >
              View recording storage &amp; usage →
            </Link>
          </div>
        </div>
      </div>

      {/* Recording Settings */}
      <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
        <div className="p-5 border-b border-off-white dark:border-medium-gray/20 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-off-white dark:bg-dark-gray flex items-center justify-center">
            <Mic className="w-5 h-5 text-dark-gray dark:text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-dark-gray dark:text-white">Recording Settings</h3>
            <p className="text-sm text-medium-gray">Configure meeting recording options</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
              Maximum Recording Duration (minutes)
            </label>
            <input
              type="number"
              min="5"
              max="60"
              value={maxRecordingMins}
              onChange={(e) => setMaxRecordingMins(parseInt(e.target.value) || 25)}
              className="w-full sm:w-48 px-4 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20"
            />
            <p className="text-xs text-medium-gray mt-1">
              Recordings will automatically stop after this duration
            </p>
          </div>

          <button
            onClick={() => handleSave('recording')}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Recording Settings
          </button>
        </div>
      </div>

      {/* Policies */}
      <PoliciesSection initial={settings} />

      {/* Data Management */}
      <div className="rounded-2xl bg-white dark:bg-charcoal border border-red-500/20 overflow-hidden">
        <div className="p-5 border-b border-red-500/20 bg-red-500/5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
            <Database className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <h3 className="font-semibold text-dark-gray dark:text-white">Data Management</h3>
            <p className="text-sm text-medium-gray">Clear test data before going live</p>
          </div>
        </div>

        <div className="p-5 space-y-6">
          {/* Current Data Counts */}
          {dataCounts && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="rounded-xl bg-off-white dark:bg-charcoal p-3 text-center">
                <Users className="w-5 h-5 text-blue-500 mx-auto mb-1" />
                <p className="text-lg font-bold text-dark-gray dark:text-white">{dataCounts.users}</p>
                <p className="text-xs text-medium-gray">Users</p>
              </div>
              <div className="rounded-xl bg-off-white dark:bg-charcoal p-3 text-center">
                <Building2 className="w-5 h-5 text-dark-gray dark:text-white mx-auto mb-1" />
                <p className="text-lg font-bold text-dark-gray dark:text-white">{dataCounts.departments}</p>
                <p className="text-xs text-medium-gray">Departments</p>
              </div>
              <div className="rounded-xl bg-off-white dark:bg-charcoal p-3 text-center">
                <Calendar className="w-5 h-5 text-green-500 mx-auto mb-1" />
                <p className="text-lg font-bold text-dark-gray dark:text-white">{dataCounts.meetings}</p>
                <p className="text-xs text-medium-gray">Meetings</p>
              </div>
              <div className="rounded-xl bg-off-white dark:bg-charcoal p-3 text-center">
                <FileText className="w-5 h-5 text-amber-500 mx-auto mb-1" />
                <p className="text-lg font-bold text-dark-gray dark:text-white">{dataCounts.todos}</p>
                <p className="text-xs text-medium-gray">To-Dos</p>
              </div>
              <div className="rounded-xl bg-off-white dark:bg-charcoal p-3 text-center">
                <Mic className="w-5 h-5 text-pink-500 mx-auto mb-1" />
                <p className="text-lg font-bold text-dark-gray dark:text-white">{dataCounts.recordings}</p>
                <p className="text-xs text-medium-gray">Recordings</p>
              </div>
              <div className="rounded-xl bg-off-white dark:bg-charcoal p-3 text-center">
                <Calendar className="w-5 h-5 text-teal-500 mx-auto mb-1" />
                <p className="text-lg font-bold text-dark-gray dark:text-white">{dataCounts.calendarEvents}</p>
                <p className="text-xs text-medium-gray">Cal Events</p>
              </div>
            </div>
          )}

          {/* Clear Options */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-dark-gray dark:text-white">
              What to clear
            </label>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {[
                { id: 'all', label: 'All Data', desc: 'Clear everything' },
                { id: 'meetings', label: 'Meetings', desc: 'Meetings, todos, recordings' },
                { id: 'todos', label: 'To-Dos Only', desc: 'Just task items' },
                { id: 'recordings', label: 'Recordings Only', desc: 'Audio files & transcripts' },
                { id: 'users', label: 'Users', desc: 'All user accounts' },
                { id: 'departments', label: 'Departments', desc: 'Department structure' },
              ].map((option) => (
                <button
                  key={option.id}
                  onClick={() => setClearType(option.id)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    clearType === option.id
                      ? 'border-red-500 bg-red-500/5'
                      : 'border-off-white dark:border-medium-gray/20 hover:border-red-500/50'
                  }`}
                >
                  <p className={`font-medium text-sm ${
                    clearType === option.id ? 'text-red-500' : 'text-dark-gray dark:text-white'
                  }`}>
                    {option.label}
                  </p>
                  <p className="text-xs text-medium-gray">{option.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Keep Current User Option */}
          {(clearType === 'all' || clearType === 'users') && (
            <label className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 cursor-pointer">
              <input
                type="checkbox"
                checked={keepCurrentUser}
                onChange={(e) => setKeepCurrentUser(e.target.checked)}
                className="w-5 h-5 rounded border-amber-500 text-amber-500 focus:ring-amber-500"
              />
              <div>
                <p className="font-medium text-dark-gray dark:text-white">Keep my account</p>
                <p className="text-sm text-medium-gray">Your admin account will not be deleted</p>
              </div>
            </label>
          )}

          {/* Clear Button */}
          {!showClearConfirm ? (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Clear {clearType === 'all' ? 'All Data' : clearType.charAt(0).toUpperCase() + clearType.slice(1)}
            </button>
          ) : (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-red-500">Are you sure?</p>
                  <p className="text-sm text-medium-gray mt-1">
                    This action cannot be undone. All selected data will be permanently deleted.
                    {clearType === 'all' && keepCurrentUser && ' Your admin account will be preserved.'}
                  </p>
                </div>
              </div>
              <div>
                <label className="block text-sm text-medium-gray mb-1">
                  Type <span className="font-mono font-semibold text-red-500">{clearType}</span> to confirm
                </label>
                <input
                  type="text"
                  value={clearConfirmText}
                  onChange={(e) => setClearConfirmText(e.target.value)}
                  autoComplete="off"
                  className="w-full sm:w-64 px-3 py-2 rounded-xl border border-red-500/30 bg-white dark:bg-charcoal text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500/30"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleClearData}
                  disabled={clearing || clearConfirmText.trim() !== clearType}
                  className="flex items-center gap-2 px-5 py-2.5 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 disabled:opacity-50 transition-colors"
                >
                  {clearing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Clearing...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Yes, Clear Data
                    </>
                  )}
                </button>
                <button
                  onClick={() => { setShowClearConfirm(false); setClearConfirmText('') }}
                  disabled={clearing}
                  className="px-5 py-2.5 text-medium-gray hover:text-dark-gray dark:hover:text-white font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
