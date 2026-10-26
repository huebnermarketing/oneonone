'use client'

import { useState, useEffect, useCallback } from 'react'
import { 
  Search, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle2, 
  Users, 
  Globe, 
  Star,
  BarChart3,
  Loader2,
  Building2,
  Calendar,
  CalendarCheck,
  Clock,
  Lightbulb,
  Target,
  MessageSquare,
  Sparkles,
  Send,
  ThumbsUp,
  ThumbsDown,
  Zap
} from 'lucide-react'
import { useFormat } from '@/components/providers/timezone-provider'

interface Department {
  id: string
  name: string
}

interface InsightsClientProps {
  departments: Department[]
  isSuperAdmin: boolean
}

interface InsightsData {
  period: number
  meetingOverview?: {
    total: number
    upcoming: number
    completed: number
    proposed: number
    cancelled: number
  }
  stats: {
    totalMeetings: number
    totalRecordings: number
    avgQualityScore: number
  }
  departmentStats: Record<string, {
    meetings: number
    avgQuality: number
    sentiments: { date: string; sentiment: string; score?: number }[]
    themes: string[]
  }>
  languageDistribution: Record<string, number>
  sentimentDistribution: {
    positive: number
    neutral: number
    negative: number
  }
  recentMeetings: Array<{
    id: string
    date: string
    employee: string
    department: string
    qualityScore: number
    sentiment: string
  }>
  aiInsights: {
    overallScore: number
    topIssues: string[]
    topStrengths: string[]
    departmentScores: Record<string, number>
    recommendations: string[]
    trendAnalysis: string
  } | null
}

interface AIQueryResult {
  question: string
  meetingsAnalyzed: number
  answer: string
  topFindings: Array<{
    finding: string
    frequency: string
    severity: 'high' | 'medium' | 'low'
  }>
  examples: Array<{
    employee: string
    department: string
    quote: string
  }>
  recommendations: string[]
  summary: string
}

interface SearchResult {
  id: string
  meetingId: string
  relevance: number
  snippet: string
  meeting: {
    id: string
    date: string
    employee: { id: string; name: string; department: string }
    reporter: { id: string; name: string }
  }
}

const suggestedQuestions = [
  "What are the top problems everyone faces?",
  "What support do employees need most?",
  "What are the common professional goals?",
  "Are there any recurring concerns or blockers?",
  "What makes employees happy?",
  "What training or resources are requested?",
]

export function InsightsClient({ departments, isSuperAdmin }: InsightsClientProps) {
  const f = useFormat()
  const [insights, setInsights] = useState<InsightsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedDepartment, setSelectedDepartment] = useState('')
  const [period, setPeriod] = useState('30')
  const [activeTab, setActiveTab] = useState<'ask' | 'overview' | 'search' | 'departments'>('ask')
  
  // AI Query state
  const [aiQuestion, setAiQuestion] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<AIQueryResult | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  const fetchInsights = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ period })
      if (selectedDepartment) params.set('departmentId', selectedDepartment)

      const response = await fetch(`/api/recordings/insights?${params}`)
      if (response.ok) {
        const data = await response.json()
        setInsights(data)
      }
    } catch (error) {
      // Error handled by toast
    } finally {
      setLoading(false)
    }
  }, [selectedDepartment, period])

  useEffect(() => {
    fetchInsights()
  }, [fetchInsights])

  const handleSearch = async () => {
    if (!searchQuery.trim()) return

    setSearching(true)
    try {
      const params = new URLSearchParams({ q: searchQuery })
      if (selectedDepartment) params.set('departmentId', selectedDepartment)

      const response = await fetch(`/api/recordings/search?${params}`)
      if (response.ok) {
        const data = await response.json()
        setSearchResults(data.results)
        setActiveTab('search')
      }
    } catch (error) {
      // Error handled by toast
    } finally {
      setSearching(false)
    }
  }

  const handleAIQuery = async (question?: string) => {
    const queryText = question || aiQuestion
    if (!queryText.trim()) return

    setAiQuestion(queryText)
    setAiLoading(true)
    setAiError(null)
    setAiResult(null)

    try {
      const response = await fetch('/api/recordings/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: queryText,
          departmentId: selectedDepartment || undefined,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to analyze')
      }

      setAiResult(data)
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Something went wrong')
    } finally {
      setAiLoading(false)
    }
  }

  const languageNames: Record<string, string> = {
    en: 'English',
    hi: 'Hindi',
    gu: 'Gujarati',
    mr: 'Marathi',
  }

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'positive': return 'text-green-500 bg-green-500/10'
      case 'negative': return 'text-red-500 bg-red-500/10'
      default: return 'text-yellow-500 bg-yellow-500/10'
    }
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return 'bg-red-500/10 text-red-500 border-red-500/20'
      case 'medium': return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20'
      default: return 'bg-blue-500/10 text-blue-500 border-blue-500/20'
    }
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        {isSuperAdmin && (
          <div className="relative">
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="appearance-none w-full sm:w-48 px-4 py-3.5 pr-10 rounded-xl border border-off-white dark:border-medium-gray/20 bg-off-white dark:bg-charcoal text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20 cursor-pointer"
            >
              <option value="">All Departments</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
                </option>
              ))}
            </select>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
              <svg className="w-4 h-4 text-medium-gray" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        )}

        <div className="relative">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="appearance-none w-full sm:w-44 px-4 py-3.5 pr-10 rounded-xl border border-off-white dark:border-medium-gray/20 bg-off-white dark:bg-charcoal text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20 cursor-pointer"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
          </select>
          <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg className="w-4 h-4 text-medium-gray" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-off-white dark:bg-charcoal rounded-xl w-fit">
        <button
          onClick={() => setActiveTab('ask')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'ask'
              ? 'bg-white dark:bg-charcoal text-dark-gray dark:text-white shadow-sm'
              : 'text-medium-gray hover:text-dark-gray dark:hover:text-white'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          Ask AI
        </button>
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'overview'
              ? 'bg-white dark:bg-charcoal text-dark-gray dark:text-white shadow-sm'
              : 'text-medium-gray hover:text-dark-gray dark:hover:text-white'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('search')}
          className={`px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'search'
              ? 'bg-white dark:bg-charcoal text-dark-gray dark:text-white shadow-sm'
              : 'text-medium-gray hover:text-dark-gray dark:hover:text-white'
          }`}
        >
          Search {searchResults.length > 0 && `(${searchResults.length})`}
        </button>
        {isSuperAdmin && (
          <button
            onClick={() => setActiveTab('departments')}
            className={`px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'departments'
                ? 'bg-white dark:bg-charcoal text-dark-gray dark:text-white shadow-sm'
                : 'text-medium-gray hover:text-dark-gray dark:hover:text-white'
            }`}
          >
            Departments
          </button>
        )}
      </div>

      {/* Ask AI Tab */}
      {activeTab === 'ask' && (
        <div className="space-y-6">
          {/* AI Query Input with Siri Glow */}
          <div className="relative rounded-2xl overflow-hidden">
            {/* Siri Glow Background */}
            <div className="absolute inset-0 siri-glow">
              <div className="absolute inset-0 bg-gradient-to-r from-pink-500/30 via-purple-500/30 to-blue-500/30 blur-2xl animate-siri-glow-1" />
              <div className="absolute inset-0 bg-gradient-to-r from-blue-500/30 via-teal-400/30 to-green-400/30 blur-2xl animate-siri-glow-2" />
              <div className="absolute inset-0 bg-gradient-to-r from-orange/20 via-pink-500/20 to-purple-500/20 blur-2xl animate-siri-glow-3" />
            </div>
            
            {/* Content */}
            <div className="relative bg-white/80 dark:bg-charcoal/80 backdrop-blur-xl rounded-2xl border border-white/50 dark:border-white/10 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-pink-500 via-purple-500 to-blue-500 flex items-center justify-center shadow-lg overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 animate-spin-slow opacity-50" />
                  <Sparkles className="w-6 h-6 text-white relative z-10" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-dark-gray dark:text-white">Ask AI About Your Team</h2>
                  <p className="text-sm text-medium-gray">Analyze all meetings and recordings to find patterns</p>
                </div>
              </div>

              <div className="relative">
                <textarea
                  value={aiQuestion}
                  onChange={(e) => setAiQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleAIQuery()
                    }
                  }}
                  placeholder="Ask anything about your team... e.g., 'What are the top problems everyone faces?'"
                  rows={3}
                  className="w-full px-4 py-4 pr-14 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal text-dark-gray dark:text-white placeholder:text-medium-gray focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                />
                <button
                  onClick={() => handleAIQuery()}
                  disabled={aiLoading || !aiQuestion.trim()}
                  className="absolute right-3 bottom-3 w-10 h-10 rounded-xl bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 text-white flex items-center justify-center hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg"
                >
                  {aiLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </button>
              </div>

              {/* Suggested Questions */}
              <div className="mt-4">
                <p className="text-xs font-medium text-medium-gray mb-2">Try asking:</p>
                <div className="flex flex-wrap gap-2">
                  {suggestedQuestions.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => handleAIQuery(q)}
                      disabled={aiLoading}
                      className="px-3 py-1.5 text-sm bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 rounded-lg text-medium-gray hover:text-blue-500 hover:border-blue-500/50 transition-colors disabled:opacity-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* AI Error */}
          {aiError && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4">
              <p className="text-red-500">{aiError}</p>
            </div>
          )}

          {/* AI Results */}
          {aiResult && (
            <div className="space-y-6">
              {/* Summary Card */}
              <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center flex-shrink-0">
                    <MessageSquare className="w-5 h-5 text-green-500" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-dark-gray dark:text-white">AI Analysis</h3>
                      <span className="px-2 py-0.5 text-xs font-medium bg-blue-500/10 text-blue-500 rounded-full">
                        {aiResult.meetingsAnalyzed} meetings analyzed
                      </span>
                    </div>
                    <p className="text-charcoal dark:text-light-gray leading-relaxed">
                      {aiResult.answer}
                    </p>
                  </div>
                </div>
              </div>

              {/* Executive Summary */}
              {aiResult.summary && (
                <div className="rounded-xl bg-gradient-to-r from-orange/10 to-orange/5 border border-orange/20 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-4 h-4 text-orange" />
                    <span className="text-sm font-semibold text-dark-gray dark:text-white">Executive Summary</span>
                  </div>
                  <p className="text-charcoal dark:text-light-gray">{aiResult.summary}</p>
                </div>
              )}

              {/* Top Findings */}
              {aiResult.topFindings && aiResult.topFindings.length > 0 && (
                <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
                  <h3 className="font-semibold text-dark-gray dark:text-white mb-4 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-orange" />
                    Top Findings
                  </h3>
                  <div className="space-y-3">
                    {aiResult.topFindings.map((finding, i) => (
                      <div
                        key={i}
                        className={`p-4 rounded-xl border ${getSeverityColor(finding.severity)}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-3">
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                              finding.severity === 'high' ? 'bg-red-500 text-white' :
                              finding.severity === 'medium' ? 'bg-yellow-500 text-white' :
                              'bg-blue-500 text-white'
                            }`}>
                              {i + 1}
                            </span>
                            <div>
                              <p className="font-medium text-dark-gray dark:text-white">{finding.finding}</p>
                              <p className="text-sm text-medium-gray mt-1">{finding.frequency}</p>
                            </div>
                          </div>
                          <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize ${getSeverityColor(finding.severity)}`}>
                            {finding.severity}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Examples */}
              {aiResult.examples && aiResult.examples.length > 0 && (
                <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
                  <h3 className="font-semibold text-dark-gray dark:text-white mb-4 flex items-center gap-2">
                    <Users className="w-5 h-5 text-dark-gray dark:text-white" />
                    Examples from Team
                  </h3>
                  <div className="space-y-3">
                    {aiResult.examples.map((example, i) => (
                      <div key={i} className="p-4 rounded-xl bg-off-white dark:bg-charcoal">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-8 h-8 rounded-full bg-dark-gray dark:bg-white flex items-center justify-center text-white dark:text-dark-gray text-xs font-bold">
                            {example.employee.charAt(0)}
                          </div>
                          <div>
                            <p className="font-medium text-dark-gray dark:text-white text-sm">{example.employee}</p>
                            <p className="text-xs text-medium-gray">{example.department}</p>
                          </div>
                        </div>
                        <p className="text-sm text-charcoal dark:text-light-gray italic">&ldquo;{example.quote}&rdquo;</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {aiResult.recommendations && aiResult.recommendations.length > 0 && (
                <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
                  <h3 className="font-semibold text-dark-gray dark:text-white mb-4 flex items-center gap-2">
                    <Lightbulb className="w-5 h-5 text-green-500" />
                    Recommendations
                  </h3>
                  <div className="space-y-3">
                    {aiResult.recommendations.map((rec, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-green-500/5 border border-green-500/20">
                        <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                        <p className="text-charcoal dark:text-light-gray">{rec}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Empty State */}
          {!aiResult && !aiLoading && !aiError && (
            <div className="relative rounded-2xl overflow-hidden">
              {/* Subtle Siri Glow */}
              <div className="absolute inset-0">
                <div className="absolute inset-0 bg-gradient-to-r from-pink-500/10 via-purple-500/10 to-blue-500/10 blur-2xl animate-siri-glow-1" />
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-teal-400/10 to-green-400/10 blur-2xl animate-siri-glow-2" />
              </div>
              
              <div className="relative bg-white/90 dark:bg-charcoal/90 backdrop-blur-xl rounded-2xl border border-white/50 dark:border-white/10 p-12 text-center">
                <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-pink-500/20 via-purple-500/20 to-blue-500/20 flex items-center justify-center mx-auto mb-4 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-r from-pink-500/30 via-purple-500/30 to-blue-500/30 animate-spin-slow" />
                  <Sparkles className="w-8 h-8 text-blue-500 relative z-10" />
                </div>
                <h3 className="text-lg font-semibold text-dark-gray dark:text-white mb-2">
                  Ask anything about your team
                </h3>
                <p className="text-medium-gray max-w-md mx-auto">
                  The AI will analyze all your meeting data, recordings, and form submissions to find patterns and insights.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Overview Tab */}
      {activeTab === 'overview' && !loading && insights && (
        <div className="space-y-6">
          {/* Meeting Overview Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <Users className="w-5 h-5 text-blue-500" />
                </div>
              </div>
              <p className="text-3xl font-bold text-dark-gray dark:text-white">{insights.meetingOverview?.total ?? 0}</p>
              <p className="text-sm text-medium-gray">Total Meetings</p>
            </div>

            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-orange/10 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-orange" />
                </div>
              </div>
              <p className="text-3xl font-bold text-dark-gray dark:text-white">{insights.meetingOverview?.upcoming ?? 0}</p>
              <p className="text-sm text-medium-gray">Upcoming</p>
            </div>

            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
                  <CalendarCheck className="w-5 h-5 text-green-500" />
                </div>
              </div>
              <p className="text-3xl font-bold text-dark-gray dark:text-white">{insights.meetingOverview?.completed ?? 0}</p>
              <p className="text-sm text-medium-gray">Completed</p>
            </div>

            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-yellow-500/10 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-yellow-500" />
                </div>
              </div>
              <p className="text-3xl font-bold text-dark-gray dark:text-white">{insights.meetingOverview?.proposed ?? 0}</p>
              <p className="text-sm text-medium-gray">Pending</p>
            </div>
          </div>

          {/* Recording Analytics Section */}
          {insights.stats.totalRecordings > 0 ? (
            <>
              {/* Recording Stats */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-off-white dark:bg-dark-gray flex items-center justify-center">
                      <BarChart3 className="w-5 h-5 text-dark-gray dark:text-white" />
                    </div>
                  </div>
                  <p className="text-3xl font-bold text-dark-gray dark:text-white">{insights.stats.totalRecordings}</p>
                  <p className="text-sm text-medium-gray">Recordings Analyzed</p>
                </div>

                <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-yellow-500/10 flex items-center justify-center">
                      <Star className="w-5 h-5 text-yellow-500" />
                    </div>
                  </div>
                  <p className="text-3xl font-bold text-dark-gray dark:text-white">{insights.stats.avgQualityScore || 'N/A'}</p>
                  <p className="text-sm text-medium-gray">Avg Quality Score</p>
                </div>

                <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
                      <Target className="w-5 h-5 text-green-500" />
                    </div>
                  </div>
                  <p className="text-3xl font-bold text-dark-gray dark:text-white">
                    {insights.aiInsights?.overallScore || 'N/A'}
                  </p>
                  <p className="text-sm text-medium-gray">Organization Score</p>
                </div>
              </div>

              {/* AI Insights */}
              {insights.aiInsights && (
                <div className="grid lg:grid-cols-2 gap-6">
                  {/* Top Issues */}
                  <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
                    <h3 className="font-semibold text-dark-gray dark:text-white mb-4 flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-red-500" />
                      Top Issues
                    </h3>
                    <ul className="space-y-3">
                      {insights.aiInsights.topIssues.map((issue, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="w-6 h-6 rounded-full bg-red-500/10 text-red-500 text-xs font-medium flex items-center justify-center flex-shrink-0">
                            {i + 1}
                          </span>
                          <span className="text-charcoal dark:text-light-gray">{issue}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Top Strengths */}
                  <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
                    <h3 className="font-semibold text-dark-gray dark:text-white mb-4 flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                      Top Strengths
                    </h3>
                    <ul className="space-y-3">
                      {insights.aiInsights.topStrengths.map((strength, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="w-6 h-6 rounded-full bg-green-500/10 text-green-500 text-xs font-medium flex items-center justify-center flex-shrink-0">
                            {i + 1}
                          </span>
                          <span className="text-charcoal dark:text-light-gray">{strength}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Recommendations */}
                  <div className="lg:col-span-2 rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
                    <h3 className="font-semibold text-dark-gray dark:text-white mb-4 flex items-center gap-2">
                      <Lightbulb className="w-5 h-5 text-orange" />
                      Recommendations
                    </h3>
                    <ul className="space-y-3">
                      {insights.aiInsights.recommendations.map((rec, i) => (
                        <li key={i} className="flex items-start gap-3 p-3 rounded-xl bg-orange/5">
                          <span className="w-6 h-6 rounded-full bg-orange/10 text-orange text-xs font-medium flex items-center justify-center flex-shrink-0">
                            {i + 1}
                          </span>
                          <span className="text-charcoal dark:text-light-gray">{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Trend Analysis */}
                  {insights.aiInsights.trendAnalysis && (
                    <div className="lg:col-span-2 rounded-2xl bg-blue-500/5 border border-blue-500/20 p-6">
                      <h3 className="font-semibold text-dark-gray dark:text-white mb-3 flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-blue-500" />
                        Trend Analysis
                      </h3>
                      <p className="text-charcoal dark:text-light-gray leading-relaxed">
                        {insights.aiInsights.trendAnalysis}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Sentiment & Language Distribution */}
              <div className="grid lg:grid-cols-2 gap-6">
                {/* Sentiment Distribution */}
                <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
                  <h3 className="font-semibold text-dark-gray dark:text-white mb-4 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-dark-gray dark:text-white" />
                    Sentiment Distribution
                  </h3>
                  <div className="space-y-4">
                    {Object.entries(insights.sentimentDistribution).map(([label, count]) => {
                      const total = Object.values(insights.sentimentDistribution).reduce((a, b) => a + b, 0)
                      const percentage = total > 0 ? Math.round((count / total) * 100) : 0
                      return (
                        <div key={label}>
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-sm font-medium capitalize ${getSentimentColor(label).split(' ')[0]}`}>
                              {label}
                            </span>
                            <span className="text-sm text-medium-gray">{count} ({percentage}%)</span>
                          </div>
                          <div className="h-2 bg-off-white dark:bg-charcoal rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full transition-all ${
                                label === 'positive' ? 'bg-green-500' :
                                label === 'negative' ? 'bg-red-500' :
                                'bg-yellow-500'
                              }`}
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Language Distribution */}
                <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
                  <h3 className="font-semibold text-dark-gray dark:text-white mb-4 flex items-center gap-2">
                    <Globe className="w-5 h-5 text-blue-500" />
                    Language Distribution
                  </h3>
                  <div className="space-y-4">
                    {Object.entries(insights.languageDistribution).map(([lang, count]) => {
                      const total = Object.values(insights.languageDistribution).reduce((a, b) => a + b, 0)
                      const percentage = total > 0 ? Math.round((count / total) * 100) : 0
                      return (
                        <div key={lang}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-dark-gray dark:text-white">
                              {languageNames[lang] || lang}
                            </span>
                            <span className="text-sm text-medium-gray">{count} ({percentage}%)</span>
                          </div>
                          <div className="h-2 bg-off-white dark:bg-charcoal rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-blue-500 rounded-full transition-all"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Recent Meetings */}
              {insights.recentMeetings.length > 0 && (
                <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
                  <div className="p-4 border-b border-off-white dark:border-medium-gray/20">
                    <h3 className="font-semibold text-dark-gray dark:text-white flex items-center gap-2">
                      <Calendar className="w-5 h-5" />
                      Recent Analyzed Meetings
                    </h3>
                  </div>
                  <div className="divide-y divide-off-white dark:divide-medium-gray/20">
                    {insights.recentMeetings.map((meeting) => (
                      <a
                        key={meeting.id}
                        href={`/meetings/${meeting.id}`}
                        className="flex items-center justify-between p-4 even:bg-off-white/40 dark:even:bg-charcoal/40 hover:bg-off-white/70 dark:hover:bg-charcoal/60 transition-colors"
                      >
                        <div>
                          <p className="font-medium text-dark-gray dark:text-white">{meeting.employee}</p>
                          <p className="text-sm text-medium-gray">
                            {meeting.department} • {f.date(meeting.date, 'short')}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          {meeting.sentiment && (
                            <span className={`px-2.5 py-1 text-xs font-medium rounded-full capitalize ${getSentimentColor(meeting.sentiment)}`}>
                              {meeting.sentiment}
                            </span>
                          )}
                          {meeting.qualityScore && (
                            <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                              meeting.qualityScore >= 80 ? 'bg-green-500/10 text-green-500' :
                              meeting.qualityScore >= 60 ? 'bg-yellow-500/10 text-yellow-500' :
                              'bg-red-500/10 text-red-500'
                            }`}>
                              {meeting.qualityScore}
                            </span>
                          )}
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-8 text-center">
              <BarChart3 className="w-12 h-12 text-light-gray mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-dark-gray dark:text-white mb-2">No recording insights yet</h3>
              <p className="text-medium-gray max-w-md mx-auto">
                Recording analytics such as sentiment, quality scores, and AI insights will appear here once meetings are recorded and analyzed.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Search Results Tab */}
      {activeTab === 'search' && (
        <div className="space-y-4">
          {/* Search Input */}
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-medium-gray" />
              <input
                type="text"
                placeholder="Search across all transcripts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="w-full pl-12 pr-4 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-orange/50"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={searching || !searchQuery.trim()}
              className="px-6 py-3 bg-orange text-white rounded-xl font-medium hover:bg-orange/90 disabled:opacity-50 transition-colors"
            >
              {searching ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Search'}
            </button>
          </div>

          {searchResults.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-12 text-center">
              <Search className="w-12 h-12 text-light-gray mx-auto mb-4" />
              <p className="text-medium-gray">
                {searchQuery ? 'No results found. Try a different search term.' : 'Enter a search query to find relevant meetings.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {searchResults.map((result) => (
                <a
                  key={result.id}
                  href={`/meetings/${result.meetingId}`}
                  className="block rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-5 hover:border-orange/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                      <p className="font-medium text-dark-gray dark:text-white">
                        {result.meeting?.employee.name || 'Unknown'}
                      </p>
                      <p className="text-sm text-medium-gray">
                        {result.meeting?.employee.department} • {result.meeting?.date && f.date(result.meeting.date, 'short')}
                      </p>
                    </div>
                    <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                      result.relevance >= 80 ? 'bg-green-500/10 text-green-500' :
                      result.relevance >= 60 ? 'bg-yellow-500/10 text-yellow-500' :
                      'bg-blue-500/10 text-blue-500'
                    }`}>
                      {result.relevance}% match
                    </span>
                  </div>
                  <p className="text-sm text-charcoal dark:text-light-gray line-clamp-3">
                    &ldquo;{result.snippet}&rdquo;
                  </p>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Departments Tab */}
      {activeTab === 'departments' && !loading && insights && Object.keys(insights.departmentStats).length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(insights.departmentStats).map(([dept, stats]) => (
            <div
              key={dept}
              className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-5"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-off-white dark:bg-dark-gray flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-dark-gray dark:text-white" />
                </div>
                <div>
                  <p className="font-medium text-dark-gray dark:text-white">{dept}</p>
                  <p className="text-sm text-medium-gray">{stats.meetings} meetings</p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-medium-gray">Avg Quality</span>
                    <span className={`text-sm font-medium ${
                      stats.avgQuality >= 80 ? 'text-green-500' :
                      stats.avgQuality >= 60 ? 'text-yellow-500' :
                      'text-red-500'
                    }`}>
                      {stats.avgQuality || 'N/A'}
                    </span>
                  </div>
                  <div className="h-1.5 bg-off-white dark:bg-charcoal rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${
                        stats.avgQuality >= 80 ? 'bg-green-500' :
                        stats.avgQuality >= 60 ? 'bg-yellow-500' :
                        'bg-red-500'
                      }`}
                      style={{ width: `${stats.avgQuality}%` }}
                    />
                  </div>
                </div>

                {insights.aiInsights?.departmentScores?.[dept] && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-medium-gray">AI Score</span>
                      <span className="text-sm font-medium text-blue-500">
                        {insights.aiInsights.departmentScores[dept]}
                      </span>
                    </div>
                    <div className="h-1.5 bg-off-white dark:bg-charcoal rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-500 rounded-full"
                        style={{ width: `${insights.aiInsights.departmentScores[dept]}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Departments Tab – Empty State */}
      {activeTab === 'departments' && !loading && insights && Object.keys(insights.departmentStats).length === 0 && (
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-12 text-center">
          <Building2 className="w-12 h-12 text-light-gray mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-dark-gray dark:text-white mb-2">No data found</h3>
          <p className="text-medium-gray max-w-md mx-auto">
            No department insights are available for the selected period. Try selecting a longer time range or check back after more meetings have been recorded.
          </p>
        </div>
      )}


      {/* Loading State */}
      {loading && (activeTab === 'overview' || activeTab === 'departments') && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-orange animate-spin" />
        </div>
      )}
    </div>
  )
}
