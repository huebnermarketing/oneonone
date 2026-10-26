'use client'

import { useState } from 'react'
import { Download, TrendingUp, AlertTriangle, Smile, Meh, Frown, Calendar, Users, CheckSquare, FileText, Building2, Loader2, Sparkles, BarChart3 } from 'lucide-react'
import { DatePicker } from '@/components/ui/date-picker'
import { useToast } from '@/components/ui/toast'
import { useFormat } from '@/components/providers/timezone-provider'
import { Select } from '@/components/ui/select'
import { StatCard } from '@/components/ui/stat-card'
import { MeetingStatusPill, Pill } from '@/components/ui/pill'
import { plural } from '@/lib/ui'

interface Department {
  id: string
  name: string
}

interface ReportMeeting {
  id: string
  date: string
  employee: string
  department: string
  reporter: string
  status: string
  hasFormData: boolean
}

interface ReportIssue {
  text: string
  count: number
}

interface ReportSentiment {
  positive: number
  neutral: number
  negative: number
  averageScore: number
}

interface ReportData {
  summary: {
    totalMeetings: number
    completedTasks: number
    pendingTasks: number
    totalEmployees: number
  }
  sentiment?: ReportSentiment
  commonIssues?: ReportIssue[]
  trends?: Record<string, string | number>
  meetings: ReportMeeting[]
}

interface ReportsClientProps {
  departments: Department[]
}

export function ReportsClient({ departments }: ReportsClientProps) {
  const { toastError } = useToast()
  const f = useFormat()
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [selectedPreset, setSelectedPreset] = useState<string>('')

  const buildQueryParams = () => {
    const params = new URLSearchParams()
    if (selectedDepartment !== 'all') {
      params.append('departmentId', selectedDepartment)
    }
    if (startDate) params.append('startDate', startDate)
    if (endDate) params.append('endDate', endDate)
    return params.toString()
  }

  const generateReport = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/reports?${buildQueryParams()}`)
      if (!response.ok) throw new Error('Failed to generate report')
      const data = await response.json()
      setReportData(data)
    } catch {
      toastError('Failed to generate report. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const exportCSV = async () => {
    try {
      // Refresh the report data in parallel so the UI stays in sync with the CSV
      const [csvResponse] = await Promise.all([
        fetch(`/api/reports?${buildQueryParams()}&format=csv`),
        fetch(`/api/reports?${buildQueryParams()}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => { if (data) setReportData(data) })
          .catch(() => {}),
      ])
      if (!csvResponse.ok) throw new Error('Failed to export')
      
      const blob = await csvResponse.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `report-${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch {
      toastError('Failed to export report.')
    }
  }

  const getSentimentIcon = (label: string) => {
    switch (label) {
      case 'positive': return <Smile className="w-5 h-5 text-green-500" />
      case 'negative': return <Frown className="w-5 h-5 text-red-500" />
      default: return <Meh className="w-5 h-5 text-yellow-500" />
    }
  }

  // Quick date presets
  const setDatePreset = (preset: string) => {
    setSelectedPreset(preset)
    const today = new Date()
    let start = new Date()
    
    switch (preset) {
      case 'week':
        start.setDate(today.getDate() - 7)
        break
      case 'month':
        start.setMonth(today.getMonth() - 1)
        break
      case 'quarter':
        start.setMonth(today.getMonth() - 3)
        break
      case 'year':
        start.setFullYear(today.getFullYear() - 1)
        break
      default:
        return
    }
    
    setStartDate(f.dateKey(start))
    setEndDate(f.dateKey(today))
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-dark-gray dark:text-white mb-1">Reports</h1>
          <p className="text-sm sm:text-base text-medium-gray">Generate insights and summaries from your one-on-ones</p>
        </div>
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange to-orange/70 flex items-center justify-center shadow-lg shadow-orange/25">
          <BarChart3 className="w-6 h-6 text-white" />
        </div>
      </div>

      {/* Filters Card */}
      <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-visible">
        {/* Card Header */}
        <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20 bg-gradient-to-r from-off-white/50 to-transparent dark:from-charcoal/50 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h2 className="font-semibold text-dark-gray dark:text-white">Generate Report</h2>
              <p className="text-sm text-medium-gray">Select filters to customize your report</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6 overflow-visible">
          {/* Quick Date Presets */}
          <div>
            <p id="report-quick-select" className="block text-sm font-medium text-dark-gray dark:text-white mb-3">
              Quick Select
            </p>
            <div className="flex flex-wrap gap-2" role="group" aria-labelledby="report-quick-select">
              {[
                { id: 'week', label: 'Last 7 Days' },
                { id: 'month', label: 'Last 30 Days' },
                { id: 'quarter', label: 'Last Quarter' },
                { id: 'year', label: 'Last Year' },
              ].map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={selectedPreset === preset.id}
                  onClick={() => setDatePreset(preset.id)}
                  className={`px-4 py-2 text-sm font-medium rounded-xl transition-all ${
                    selectedPreset === preset.id
                      ? 'bg-dark-gray dark:bg-white text-white dark:text-dark-gray shadow-lg shadow-dark-gray/25'
                      : 'bg-off-white dark:bg-charcoal text-medium-gray hover:text-dark-gray dark:hover:text-white hover:bg-dark-gray/10 dark:hover:bg-white/10'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Filter Inputs */}
          <div className="grid gap-6 md:grid-cols-3 pb-2">
            {/* Department */}
            <div>
              <label htmlFor="report-department" className="flex items-center gap-2 text-sm font-medium text-dark-gray dark:text-white mb-2">
                <Building2 className="w-4 h-4 text-medium-gray" />
                Department
              </label>
              <Select
                id="report-department"
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="bg-off-white py-3.5 text-base focus:border-orange focus:ring-orange/20 cursor-pointer"
              >
                <option value="all">All Departments</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>{dept.name}</option>
                ))}
              </Select>
            </div>

            {/* Start Date */}
            <DatePicker
              label="Start Date"
              value={startDate}
              onChange={(value) => {
                setStartDate(value)
                setSelectedPreset('')
              }}
              max={endDate || undefined}
              placeholder="Select start date"
            />

            {/* End Date */}
            <DatePicker
              label="End Date"
              value={endDate}
              onChange={(value) => {
                setEndDate(value)
                setSelectedPreset('')
              }}
              min={startDate || undefined}
              placeholder="Select end date"
            />
          </div>

          {/* Generate Button */}
          <div className="flex items-center justify-between pt-2">
            <p className="text-sm text-medium-gray">
              {startDate && endDate ? (
                <>Showing data from <span className="font-medium text-dark-gray dark:text-white">{f.dateOnly(startDate, 'short')}</span> to <span className="font-medium text-dark-gray dark:text-white">{f.dateOnly(endDate, 'short')}</span></>
              ) : (
                'Select a date range to generate report'
              )}
            </p>
            <button
              type="button"
              onClick={generateReport}
              disabled={loading}
              className="flex items-center gap-2 px-8 py-3.5 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 transition-all"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Generate Report
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Report Results */}
      {reportData && (
        <div className="space-y-6">
          {/* Export Button */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={exportCSV}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-dark-gray dark:text-white hover:bg-off-white dark:hover:bg-charcoal rounded-xl transition-colors"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          </div>

          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard label="Total Meetings" value={reportData.summary.totalMeetings} icon={Calendar} accent="blue" />
            <StatCard label="Tasks Completed" value={reportData.summary.completedTasks} icon={CheckSquare} accent="green" />
            <StatCard label="Pending Tasks" value={reportData.summary.pendingTasks} icon={FileText} accent="amber" />
            <StatCard label="Employees" value={reportData.summary.totalEmployees} icon={Users} accent="neutral" />
          </div>

          {/* Sentiment Analysis */}
          {reportData.sentiment && (
            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
              <h3 className="font-semibold text-dark-gray dark:text-white mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Team Sentiment Analysis
              </h3>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="flex items-center gap-3 p-4 rounded-xl bg-green-500/5 border border-green-500/20">
                  <Smile className="w-8 h-8 text-green-500" />
                  <div>
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {reportData.sentiment.positive}
                    </p>
                    <p className="text-sm text-medium-gray">Positive</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-4 rounded-xl bg-yellow-500/5 border border-yellow-500/20">
                  <Meh className="w-8 h-8 text-yellow-500" />
                  <div>
                    <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                      {reportData.sentiment.neutral}
                    </p>
                    <p className="text-sm text-medium-gray">Neutral</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/5 border border-red-500/20">
                  <Frown className="w-8 h-8 text-red-500" />
                  <div>
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                      {reportData.sentiment.negative}
                    </p>
                    <p className="text-sm text-medium-gray">Needs Attention</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-4 rounded-xl bg-off-white dark:bg-charcoal">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm">
                    {reportData.sentiment.averageScore > 0 ? '+' : ''}{reportData.sentiment.averageScore}
                  </div>
                  <div>
                    <p className="font-medium text-dark-gray dark:text-white">Overall Score</p>
                    <p className="text-sm text-medium-gray">
                      {reportData.sentiment.averageScore > 0.2 ? 'Positive' : 
                       reportData.sentiment.averageScore < -0.2 ? 'Needs attention' : 'Neutral'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Common Issues */}
          {reportData.commonIssues && reportData.commonIssues.length > 0 && (
            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
              <h3 className="font-semibold text-dark-gray dark:text-white mb-4 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                Common Issues Identified
              </h3>
              <div className="space-y-3">
                {reportData.commonIssues.map((issue, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-4 rounded-xl bg-off-white dark:bg-charcoal"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${
                        issue.count >= 5 ? 'bg-red-500' : 
                        issue.count >= 3 ? 'bg-amber-500' : 'bg-yellow-500'
                      }`} />
                      <span className="font-medium text-dark-gray dark:text-white">{issue.text}</span>
                    </div>
                    <span className="text-sm text-medium-gray">
                      {plural(issue.count, 'team member')} mentioned
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trends */}
          {reportData.trends && (
            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6">
              <h3 className="font-semibold text-dark-gray dark:text-white mb-4">Key Metrics</h3>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {Object.entries(reportData.trends).map(([key, value]) => (
                  <div key={key} className="p-4 rounded-xl bg-off-white dark:bg-charcoal">
                    <p className="text-sm text-medium-gray mb-1">{key}</p>
                    <p className="text-xl font-bold text-dark-gray dark:text-white">{String(value)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Meetings List */}
          <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
            <div className="px-6 py-4 border-b border-off-white dark:border-medium-gray/20">
              <h3 className="font-semibold text-dark-gray dark:text-white">
                Meeting Details ({reportData.meetings.length})
              </h3>
            </div>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-off-white dark:border-medium-gray/20 bg-off-white/50 dark:bg-charcoal/50">
                    <th className="text-left py-3 px-6 text-sm font-medium text-medium-gray">Date</th>
                    <th className="text-left py-3 px-6 text-sm font-medium text-medium-gray">Employee</th>
                    <th className="text-left py-3 px-6 text-sm font-medium text-medium-gray">Department</th>
                    <th className="text-left py-3 px-6 text-sm font-medium text-medium-gray">Reporter</th>
                    <th className="text-left py-3 px-6 text-sm font-medium text-medium-gray">Status</th>
                    <th className="text-left py-3 px-6 text-sm font-medium text-medium-gray">Form</th>
                  </tr>
                </thead>
                <tbody>
                  {reportData.meetings.map((meeting) => (
                    <tr
                      key={meeting.id}
                      className="border-b border-off-white/50 dark:border-medium-gray/10 even:bg-off-white/40 dark:even:bg-charcoal/40 hover:bg-off-white/70 dark:hover:bg-charcoal/60 transition-colors"
                    >
                      <td className="py-3 px-6 text-sm text-dark-gray dark:text-white">
                        {f.date(meeting.date, 'short')}
                      </td>
                      <td className="py-3 px-6 text-sm text-dark-gray dark:text-white">{meeting.employee}</td>
                      <td className="py-3 px-6 text-sm text-medium-gray">{meeting.department}</td>
                      <td className="py-3 px-6 text-sm text-medium-gray">{meeting.reporter}</td>
                      <td className="py-3 px-6">
                        <MeetingStatusPill status={meeting.status} />
                      </td>
                      <td className="py-3 px-6">
                        <Pill tone={meeting.hasFormData ? 'green' : 'neutral'}>{meeting.hasFormData ? 'Submitted' : 'Pending'}</Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-off-white dark:divide-medium-gray/20">
              {reportData.meetings.map((meeting) => (
                <div key={meeting.id} className="p-4 space-y-2 even:bg-off-white/40 dark:even:bg-charcoal/40">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-dark-gray dark:text-white">{meeting.employee}</span>
                    <span className="text-sm text-medium-gray">
                      {f.date(meeting.date, 'short')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <MeetingStatusPill status={meeting.status} />
                    <Pill tone={meeting.hasFormData ? 'green' : 'neutral'}>Form: {meeting.hasFormData ? 'Submitted' : 'Pending'}</Pill>
                  </div>
                  <p className="text-xs text-medium-gray">{meeting.department} · {meeting.reporter}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
