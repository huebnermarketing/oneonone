'use client'

import { useState } from 'react'
import { Download, TrendingUp, Smile, Meh, Frown, Calendar, CheckSquare, Target, Award, HelpCircle } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { useFormat } from '@/components/providers/timezone-provider'

interface QuarterlyGoal {
  date: string
  professional?: string
  agency?: string
  progress?: string
}

interface QuarterlyItem {
  text: string
  date: string
}

interface QuarterlySummaryData {
  period: { quarter: string }
  statistics: {
    totalMeetings: number
    completedMeetings: number
    taskCompletionRate: string
    completedTasks: number
    pendingTasks: number
    highPriorityTasks: number
  }
  sentiment: { label: string }
  keyThemes: string[]
  goals: QuarterlyGoal[]
  recentAchievements: QuarterlyItem[]
  supportRequests: QuarterlyItem[]
}

interface QuarterlySummaryProps {
  userId: string
  userName: string
}

export function QuarterlySummary({ userId, userName }: QuarterlySummaryProps) {
  const { toastError } = useToast()
  const f = useFormat()
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<QuarterlySummaryData | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  const loadSummary = async () => {
    if (summary) {
      setIsOpen(true)
      return
    }

    setLoading(true)
    try {
      const response = await fetch(`/api/reports/quarterly/${userId}`)
      if (!response.ok) throw new Error('Failed to load summary')
      const data = await response.json()
      setSummary(data)
      setIsOpen(true)
    } catch (error) {
      toastError('Failed to load quarterly summary')
    } finally {
      setLoading(false)
    }
  }

  const getSentimentIcon = (label: string) => {
    switch (label.toLowerCase()) {
      case 'positive': return <Smile className="w-5 h-5 text-green-500" />
      case 'needs attention': return <Frown className="w-5 h-5 text-red-500" />
      default: return <Meh className="w-5 h-5 text-yellow-500" />
    }
  }

  return (
    <>
      <button
        onClick={loadSummary}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-orange hover:bg-orange/10 rounded-xl transition-colors disabled:opacity-50"
      >
        <TrendingUp className="w-4 h-4" />
        {loading ? 'Loading...' : 'Quarterly Summary'}
      </button>

      {/* Modal */}
      {isOpen && summary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setIsOpen(false)} />
          <div className="relative w-full max-w-4xl max-w-[95vw] max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 shadow-2xl">
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal">
              <div>
                <h2 className="text-lg font-semibold text-dark-gray dark:text-white">
                  Quarterly Summary: {userName}
                </h2>
                <p className="text-sm text-medium-gray">{summary.period.quarter}</p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 text-sm font-medium text-medium-gray hover:text-dark-gray dark:hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Statistics */}
              <div className="grid gap-4 md:grid-cols-4">
                <div className="rounded-xl bg-off-white dark:bg-charcoal p-4">
                  <div className="flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-blue-500" />
                    <div>
                      <p className="text-2xl font-bold text-dark-gray dark:text-white">
                        {summary.statistics.completedMeetings}/{summary.statistics.totalMeetings}
                      </p>
                      <p className="text-sm text-medium-gray">Meetings</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl bg-off-white dark:bg-charcoal p-4">
                  <div className="flex items-center gap-3">
                    <CheckSquare className="w-5 h-5 text-green-500" />
                    <div>
                      <p className="text-2xl font-bold text-dark-gray dark:text-white">
                        {summary.statistics.taskCompletionRate}
                      </p>
                      <p className="text-sm text-medium-gray">Tasks Done</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl bg-off-white dark:bg-charcoal p-4">
                  <div className="flex items-center gap-3">
                    {getSentimentIcon(summary.sentiment.label)}
                    <div>
                      <p className="text-lg font-bold text-dark-gray dark:text-white">
                        {summary.sentiment.label}
                      </p>
                      <p className="text-sm text-medium-gray">Sentiment</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl bg-off-white dark:bg-charcoal p-4">
                  <div className="flex items-center gap-3">
                    <Target className="w-5 h-5 text-orange" />
                    <div>
                      <p className="text-2xl font-bold text-dark-gray dark:text-white">
                        {summary.keyThemes.length}
                      </p>
                      <p className="text-sm text-medium-gray">Focus Areas</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Key Themes */}
              {summary.keyThemes.length > 0 && (
                <div className="rounded-xl border border-off-white dark:border-medium-gray/20 p-5">
                  <h3 className="font-semibold text-dark-gray dark:text-white mb-3">Key Themes</h3>
                  <div className="flex flex-wrap gap-2">
                    {summary.keyThemes.map((theme: string, i: number) => (
                      <span
                        key={i}
                        className="px-3 py-1.5 text-sm font-medium bg-orange/10 text-orange rounded-full"
                      >
                        {theme}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Goals */}
              {summary.goals.length > 0 && (
                <div className="rounded-xl border border-off-white dark:border-medium-gray/20 p-5">
                  <h3 className="font-semibold text-dark-gray dark:text-white mb-3 flex items-center gap-2">
                    <Target className="w-5 h-5" />
                    Goals & Progress
                  </h3>
                  <div className="space-y-4">
                    {summary.goals.map((goal, i) => (
                      <div key={i} className="p-4 rounded-lg bg-off-white dark:bg-charcoal">
                        <p className="text-xs text-medium-gray mb-2">
                          {f.date(goal.date, 'short')}
                        </p>
                        {goal.professional && (
                          <div className="mb-2">
                            <p className="text-xs font-medium text-blue-500 mb-1">Professional Growth</p>
                            <p className="text-sm text-dark-gray dark:text-white">{goal.professional}</p>
                          </div>
                        )}
                        {goal.agency && (
                          <div className="mb-2">
                            <p className="text-xs font-medium text-green-500 mb-1">Agency Growth</p>
                            <p className="text-sm text-dark-gray dark:text-white">{goal.agency}</p>
                          </div>
                        )}
                        {goal.progress && (
                          <div>
                            <p className="text-xs font-medium text-orange mb-1">Progress</p>
                            <p className="text-sm text-medium-gray">{goal.progress}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Achievements */}
              {summary.recentAchievements.length > 0 && (
                <div className="rounded-xl border border-off-white dark:border-medium-gray/20 p-5">
                  <h3 className="font-semibold text-dark-gray dark:text-white mb-3 flex items-center gap-2">
                    <Award className="w-5 h-5 text-green-500" />
                    Achievements & Good News
                  </h3>
                  <div className="space-y-3">
                    {summary.recentAchievements.map((item, i) => (
                      <div key={i} className="flex gap-3 p-3 rounded-lg bg-green-500/5">
                        <Smile className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm text-dark-gray dark:text-white">{item.text}</p>
                          <p className="text-xs text-medium-gray mt-1">
                            {f.date(item.date, 'short')}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Support Requests */}
              {summary.supportRequests.length > 0 && (
                <div className="rounded-xl border border-off-white dark:border-medium-gray/20 p-5">
                  <h3 className="font-semibold text-dark-gray dark:text-white mb-3 flex items-center gap-2">
                    <HelpCircle className="w-5 h-5 text-orange" />
                    Support Requests
                  </h3>
                  <div className="space-y-3">
                    {summary.supportRequests.map((item, i) => (
                      <div key={i} className="flex gap-3 p-3 rounded-lg bg-orange/5">
                        <HelpCircle className="w-5 h-5 text-orange flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm text-dark-gray dark:text-white">{item.text}</p>
                          <p className="text-xs text-medium-gray mt-1">
                            {f.date(item.date, 'short')}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tasks Overview */}
              <div className="rounded-xl border border-off-white dark:border-medium-gray/20 p-5">
                <h3 className="font-semibold text-dark-gray dark:text-white mb-3">Tasks Overview</h3>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="text-center p-4 rounded-lg bg-green-500/10">
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {summary.statistics.completedTasks}
                    </p>
                    <p className="text-sm text-medium-gray">Completed</p>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-blue-500/10">
                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                      {summary.statistics.pendingTasks}
                    </p>
                    <p className="text-sm text-medium-gray">In Progress</p>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-red-500/10">
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                      {summary.statistics.highPriorityTasks}
                    </p>
                    <p className="text-sm text-medium-gray">High Priority</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
