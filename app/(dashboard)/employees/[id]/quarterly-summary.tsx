'use client'

import { useState } from 'react'
import { TrendingUp, Smile, Meh, Frown, Calendar, CheckSquare, Target, Award, HelpCircle } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { useFormat } from '@/components/providers/timezone-provider'
import { Modal } from '@/components/ui/modal'
import { StatCard } from '@/components/ui/stat-card'
import { Pill } from '@/components/ui/pill'

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
    } catch {
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
        type="button"
        onClick={loadSummary}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-orange hover:bg-orange/10 rounded-xl transition-colors disabled:opacity-50"
      >
        <TrendingUp className="w-4 h-4" />
        {loading ? 'Loading...' : 'Quarterly Summary'}
      </button>

      <Modal
        open={isOpen && !!summary}
        onClose={() => setIsOpen(false)}
        title={`Quarterly Summary: ${userName}`}
        description={summary?.period.quarter}
        size="xl"
      >
        {summary && (
          <div className="space-y-6">
            {/* Statistics */}
            <div className="grid gap-4 md:grid-cols-4">
              <StatCard label="Meetings" value={`${summary.statistics.completedMeetings}/${summary.statistics.totalMeetings}`} icon={Calendar} accent="blue" />
              <StatCard label="Tasks Done" value={summary.statistics.taskCompletionRate} icon={CheckSquare} accent="green" />
              <StatCard
                label="Sentiment"
                value={<span className="inline-flex items-center gap-2 text-lg">{getSentimentIcon(summary.sentiment.label)}{summary.sentiment.label}</span>}
              />
              <StatCard label="Focus Areas" value={summary.keyThemes.length} icon={Target} accent="orange" />
            </div>

            {/* Key Themes */}
            {summary.keyThemes.length > 0 && (
              <div className="rounded-xl border border-off-white dark:border-medium-gray/20 p-5">
                <h3 className="font-semibold text-dark-gray dark:text-white mb-3">Key Themes</h3>
                <div className="flex flex-wrap gap-2">
                  {summary.keyThemes.map((theme: string, i: number) => (
                    <Pill key={i} tone="orange" className="px-3 py-1.5 text-sm">{theme}</Pill>
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
        )}
      </Modal>
    </>
  )
}
