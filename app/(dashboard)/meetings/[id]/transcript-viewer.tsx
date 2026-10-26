'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { 
  FileText, 
  Lightbulb, 
  CheckSquare, 
  TrendingUp, 
  Star, 
  Globe, 
  Volume2,
  ChevronDown,
  ChevronUp,
  Trash2,
  Loader2,
  Plus,
  Check
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-modal'
import { languageName } from '@/lib/ui'
import { TodoPriorityPill } from '@/components/ui/pill'

interface TranscriptViewerProps {
  recording: {
    id: string
    meetingId: string
    transcript: string | null
    language: string | null
    summary: string | null
    keyPoints: string[] | null
    autoTodos: Array<{
      title: string
      description: string
      assignTo: string
      priority: string
    }> | null
    sentiment: {
      score: number
      label: string
      employeeMood: string
      reporterEngagement: string
      overallTone: string
    } | null
    qualityScore: number | null
    qualityDetails: {
      clarity: number
      actionability: number
      engagement: number
      goalAlignment: number
      followUp: number
      overallFeedback: string
    } | null
    duration: number | null
    audioPlaybackUrl: string | null
  }
  employeeId?: string
  reporterId?: string
  /** false = read-only view (employee); hides delete and add-to-todo */
  canManage?: boolean
}

export function TranscriptViewer({ recording, employeeId, reporterId, canManage = true }: TranscriptViewerProps) {
  const router = useRouter()
  const { toastError } = useToast()
  const confirm = useConfirm()
  const [showFullTranscript, setShowFullTranscript] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [activeTab, setActiveTab] = useState<'summary' | 'transcript' | 'analysis'>('summary')
  const [audioUrl, setAudioUrl] = useState<string | null>(recording.audioPlaybackUrl)
  const [addedTodos, setAddedTodos] = useState<Set<number>>(new Set())
  const [addingTodo, setAddingTodo] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const handleAudioEnded = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0
    }
  }, [])

  // Fetch signed audio URL on mount
  useEffect(() => {
    async function fetchAudioUrl() {
      try {
        const response = await fetch(`/api/meetings/${recording.meetingId}/recording`)
        if (response.ok) {
          const data = await response.json()
          if (data.recording?.audioPlaybackUrl) {
            setAudioUrl(data.recording.audioPlaybackUrl)
          }
        }
      } catch {
        toastError('Failed to load recording audio')
      }
    }
    
    if (!recording.audioPlaybackUrl) {
      fetchAudioUrl()
    }
  }, [recording.meetingId, recording.audioPlaybackUrl, toastError])

  const handleDelete = async () => {
    if (!await confirm('Are you sure you want to delete this recording? This cannot be undone.', { variant: 'danger' })) {
      return
    }

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/meetings/${recording.meetingId}/recording`, {
        method: 'DELETE',
      })

      if (response.ok) {
        router.refresh()
      } else {
        toastError('Failed to delete recording')
      }
    } catch (error) {
      toastError('Failed to delete recording')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleAddTodo = async (todo: { title: string; description: string; assignTo: string; priority: string }, index: number) => {
    if (!employeeId || !reporterId) {
      toastError('Unable to add todo: missing participant information')
      return
    }

    setAddingTodo(index)
    try {
      const assignedToId = todo.assignTo === 'employee' ? employeeId : reporterId

      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: todo.title,
          description: todo.description,
          assignedToId,
          meetingId: recording.meetingId,
          priority: todo.priority,
        }),
      })

      if (response.ok) {
        setAddedTodos(prev => new Set([...prev, index]))
        router.refresh()
      } else {
        const error = await response.json()
        toastError(error.error || 'Failed to add todo')
      }
    } catch (error) {
      toastError('Failed to add todo')
    } finally {
      setAddingTodo(null)
    }
  }

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return 'N/A'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}m ${secs}s`
  }

  const getSentimentColor = (label: string) => {
    switch (label) {
      case 'positive': return 'text-green-500 bg-green-500/10'
      case 'negative': return 'text-red-500 bg-red-500/10'
      default: return 'text-yellow-500 bg-yellow-500/10'
    }
  }

  const getQualityColor = (score: number | null) => {
    if (!score) return 'text-medium-gray'
    if (score >= 80) return 'text-green-500'
    if (score >= 60) return 'text-yellow-500'
    return 'text-red-500'
  }

  return (
    <div className="space-y-6">
      {/* Header with tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-2" role="tablist" aria-label="Recording views">
          <button
            role="tab"
            aria-selected={activeTab === 'summary'}
            onClick={() => setActiveTab('summary')}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${
              activeTab === 'summary'
                ? 'bg-orange text-white'
                : 'text-medium-gray hover:bg-off-white dark:hover:bg-charcoal'
            }`}
          >
            Summary
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'transcript'}
            onClick={() => setActiveTab('transcript')}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${
              activeTab === 'transcript'
                ? 'bg-orange text-white'
                : 'text-medium-gray hover:bg-off-white dark:hover:bg-charcoal'
            }`}
          >
            Transcript
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'analysis'}
            onClick={() => setActiveTab('analysis')}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${
              activeTab === 'analysis'
                ? 'bg-orange text-white'
                : 'text-medium-gray hover:bg-off-white dark:hover:bg-charcoal'
            }`}
          >
            Analysis
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-medium-gray">
            <Globe className="w-4 h-4" />
            {languageName(recording.language || 'en')}
          </div>
          <div className="flex items-center gap-2 text-sm text-medium-gray">
            <Volume2 className="w-4 h-4" />
            {formatDuration(recording.duration)}
          </div>
          {canManage && <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
            title="Delete recording"
            aria-label="Delete recording"
          >
            {isDeleting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
          </button>}
        </div>
      </div>

      {/* Audio Player */}
      {audioUrl && (
        <div className="rounded-xl bg-off-white dark:bg-charcoal p-4">
          <audio
            ref={audioRef}
            controls
            src={audioUrl}
            className="w-full"
            onEnded={handleAudioEnded}
          />
        </div>
      )}

      {/* Summary Tab */}
      {activeTab === 'summary' && (
        <div className="space-y-6">
          {/* Quick Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-4 text-center">
              <Star className={`w-6 h-6 mx-auto mb-2 ${getQualityColor(recording.qualityScore)}`} />
              <p className={`text-2xl font-bold ${getQualityColor(recording.qualityScore)}`}>
                {recording.qualityScore || 'N/A'}
              </p>
              <p className="text-xs text-medium-gray">Quality Score</p>
            </div>
            
            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-4 text-center">
              <TrendingUp className={`w-6 h-6 mx-auto mb-2 ${recording.sentiment ? getSentimentColor(recording.sentiment.label).split(' ')[0] : ''}`} />
              <p className={`text-lg font-bold capitalize ${recording.sentiment ? getSentimentColor(recording.sentiment.label).split(' ')[0] : ''}`}>
                {recording.sentiment?.label || 'N/A'}
              </p>
              <p className="text-xs text-medium-gray">Sentiment</p>
            </div>

            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-4 text-center">
              <Lightbulb className="w-6 h-6 mx-auto mb-2 text-blue-500" />
              <p className="text-2xl font-bold text-blue-500">
                {recording.keyPoints?.length || 0}
              </p>
              <p className="text-xs text-medium-gray">Key Points</p>
            </div>

            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-4 text-center">
              <CheckSquare className="w-6 h-6 mx-auto mb-2 text-green-500" />
              <p className="text-2xl font-bold text-green-500">
                {recording.autoTodos?.length || 0}
              </p>
              <p className="text-xs text-medium-gray">Action Items</p>
            </div>
          </div>

          {/* Summary */}
          {recording.summary && (
            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
              <h4 className="font-semibold text-dark-gray dark:text-white mb-3 flex items-center gap-2">
                <FileText className="w-5 h-5 text-orange" />
                Summary
              </h4>
              <p className="text-charcoal dark:text-light-gray leading-relaxed">
                {recording.summary}
              </p>
            </div>
          )}

          {/* Key Points */}
          {recording.keyPoints && recording.keyPoints.length > 0 && (
            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
              <h4 className="font-semibold text-dark-gray dark:text-white mb-3 flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-blue-500" />
                Key Points
              </h4>
              <ul className="space-y-2">
                {recording.keyPoints.map((point, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-blue-500/10 text-blue-500 text-xs font-medium flex items-center justify-center flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-charcoal dark:text-light-gray">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Auto-generated Todos */}
          {recording.autoTodos && recording.autoTodos.length > 0 && (
            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
              <h4 className="font-semibold text-dark-gray dark:text-white mb-3 flex items-center gap-2">
                <CheckSquare className="w-5 h-5 text-green-500" />
                Suggested Action Items
              </h4>
              <p className="text-sm text-medium-gray mb-4">
                These action items were automatically identified from the transcript. Click &quot;Add&quot; to add them to your to-do list.
              </p>
              <div className="space-y-3">
                {recording.autoTodos.map((todo, i) => (
                  <div key={i} className="p-3 rounded-xl bg-off-white dark:bg-charcoal">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <p className="font-medium text-dark-gray dark:text-white">{todo.title}</p>
                        <p className="text-sm text-medium-gray mt-1">{todo.description}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <TodoPriorityPill priority={todo.priority} />
                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-500/10 text-blue-500 capitalize">
                            → {todo.assignTo}
                          </span>
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        {addedTodos.has(i) ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-green-600 bg-green-500/10 rounded-lg">
                            <Check className="w-4 h-4" />
                            Added
                          </span>
                        ) : canManage ? (
                          <button
                            onClick={() => handleAddTodo(todo, i)}
                            disabled={addingTodo === i}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-orange hover:bg-orange/90 rounded-lg transition-colors disabled:opacity-50"
                          >
                            {addingTodo === i ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Adding...
                              </>
                            ) : (
                              <>
                                <Plus className="w-4 h-4" />
                                Add to To-Do
                              </>
                            )}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Transcript Tab */}
      {activeTab === 'transcript' && (
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
          <h4 className="font-semibold text-dark-gray dark:text-white mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-orange" />
            Full Transcript
          </h4>
          <div className="relative">
            <div className={`text-charcoal dark:text-light-gray leading-relaxed whitespace-pre-wrap ${
              !showFullTranscript && recording.transcript && recording.transcript.length > 1000 
                ? 'max-h-[300px] overflow-hidden' 
                : ''
            }`}>
              {recording.transcript || 'No transcript available'}
            </div>
            
            {recording.transcript && recording.transcript.length > 1000 && !showFullTranscript && (
              <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-white dark:from-dark-gray to-transparent" />
            )}
          </div>
          
          {recording.transcript && recording.transcript.length > 1000 && (
            <button
              onClick={() => setShowFullTranscript(!showFullTranscript)}
              className="mt-4 flex items-center gap-2 text-sm font-medium text-orange hover:text-orange/80 transition-colors"
            >
              {showFullTranscript ? (
                <>
                  <ChevronUp className="w-4 h-4" />
                  Show Less
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4" />
                  Show Full Transcript
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Analysis Tab */}
      {activeTab === 'analysis' && (
        <div className="space-y-6">
          {/* Sentiment Details */}
          {recording.sentiment && (
            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
              <h4 className="font-semibold text-dark-gray dark:text-white mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-500" />
                Sentiment Analysis
              </h4>
              
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-medium-gray uppercase tracking-wide mb-1">Overall Sentiment</p>
                    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${getSentimentColor(recording.sentiment.label)}`}>
                      <span className="font-medium capitalize">{recording.sentiment.label}</span>
                      <span className="text-sm">({(recording.sentiment.score * 100).toFixed(0)}%)</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-medium-gray uppercase tracking-wide mb-1">Overall Tone</p>
                    <p className="text-dark-gray dark:text-white">{recording.sentiment.overallTone}</p>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-medium-gray uppercase tracking-wide mb-1">Employee Mood</p>
                    <p className="text-dark-gray dark:text-white">{recording.sentiment.employeeMood}</p>
                  </div>
                  <div>
                    <p className="text-xs text-medium-gray uppercase tracking-wide mb-1">Reporter Engagement</p>
                    <p className="text-dark-gray dark:text-white">{recording.sentiment.reporterEngagement}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Quality Details */}
          {recording.qualityDetails && (
            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
              <h4 className="font-semibold text-dark-gray dark:text-white mb-4 flex items-center gap-2">
                <Star className="w-5 h-5 text-yellow-500" />
                Meeting Quality Breakdown
              </h4>
              
              <div className="space-y-4">
                {[
                  { label: 'Clarity', value: recording.qualityDetails.clarity },
                  { label: 'Actionability', value: recording.qualityDetails.actionability },
                  { label: 'Engagement', value: recording.qualityDetails.engagement },
                  { label: 'Goal Alignment', value: recording.qualityDetails.goalAlignment },
                  { label: 'Follow-up Items', value: recording.qualityDetails.followUp },
                ].map((item) => (
                  <div key={item.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-medium-gray">{item.label}</span>
                      <span className="text-sm font-medium text-dark-gray dark:text-white">{item.value}/10</span>
                    </div>
                    <div className="h-2 bg-off-white dark:bg-charcoal rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all ${
                          item.value >= 8 ? 'bg-green-500' :
                          item.value >= 6 ? 'bg-yellow-500' :
                          'bg-red-500'
                        }`}
                        style={{ width: `${item.value * 10}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {recording.qualityDetails.overallFeedback && (
                <div className="mt-4 p-4 rounded-xl bg-off-white dark:bg-charcoal">
                  <p className="text-sm font-medium text-dark-gray dark:text-white mb-1">Overall Feedback</p>
                  <p className="text-sm text-charcoal dark:text-light-gray">
                    {recording.qualityDetails.overallFeedback}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
