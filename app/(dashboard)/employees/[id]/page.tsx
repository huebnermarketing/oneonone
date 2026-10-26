import { getCurrentUser, canAccessEmployeeData } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  Mail,
  Building2,
  Users,
  Calendar,
  CheckCircle2,
  XCircle,
  Mic,
  TrendingUp,
  CheckSquare,
} from 'lucide-react'
import { UserRole } from '@prisma/client'
import { QuarterlySummary } from './quarterly-summary'
import { MeetingHistoryList } from './meeting-history-list'
import { formatDateOnly } from '@/lib/dates'
import { StatCard } from '@/components/ui/stat-card'
import { Avatar } from '@/components/ui/avatar'
import { Pill, TodoPriorityPill, TodoStatusPill } from '@/components/ui/pill'
import { plural } from '@/lib/ui'

export default async function EmployeeDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const user = await getCurrentUser()
  if (!user) return notFound()

  const employee = await prisma.user.findUnique({
    where: { id: params.id },
    include: {
      department: true,
      reportsTo: { select: { name: true, email: true } },
    },
  })

  if (!employee) return notFound()

  const canAccess = canAccessEmployeeData(
    user.role,
    user.id,
    employee.id,
    employee.reportsToId
  )
  if (!canAccess) return notFound()

  // Fetch ALL meetings for this person (not just 10)
  const meetings = await prisma.meeting.findMany({
    where: { employeeId: employee.id },
    include: {
      reporter: { select: { name: true } },
      recording: {
        select: {
          id: true,
          status: true,
          summary: true,
          keyPoints: true,
          sentiment: true,
          qualityScore: true,
          duration: true,
          language: true,
          processedAt: true,
        },
      },
    },
    orderBy: { meetingDate: 'desc' },
  })

  const todos = await prisma.todo.findMany({
    where: { assignedToId: employee.id },
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    take: 10,
  })

  const now = new Date()

  // Calculate stats
  const totalMeetings = meetings.length
  const completedMeetings = meetings.filter((m) => m.status === 'COMPLETED').length
  const missedMeetings = meetings.filter(
    (m) =>
      new Date(m.meetingDate) < now &&
      m.status !== 'COMPLETED'
  ).length
  const upcomingMeetings = meetings.filter(
    (m) => new Date(m.meetingDate) >= now && m.status === 'SCHEDULED'
  ).length
  const recordingsCompleted = meetings.filter(
    (m) => m.recording && m.recording.status === 'COMPLETED'
  ).length
  const completedTodos = todos.filter((t) => t.status === 'DONE').length
  const attendanceRate =
    totalMeetings > 0 ? Math.round((completedMeetings / totalMeetings) * 100) : 0

  // Gather all recording analyses for the combined summary
  const analyzedMeetings = meetings.filter(
    (m) => m.recording?.status === 'COMPLETED' && m.recording.summary
  )

  // Average quality score from all recordings
  const qualityScores = analyzedMeetings
    .map((m) => m.recording!.qualityScore)
    .filter((s): s is number => s !== null)
  const avgQuality =
    qualityScores.length > 0
      ? Math.round(qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length)
      : null

  // Sentiment distribution
  const sentiments = analyzedMeetings
    .map((m) => (m.recording!.sentiment as { label?: string } | null)?.label)
    .filter(Boolean) as string[]
  const positiveSentiments = sentiments.filter((s) => s === 'positive').length
  const neutralSentiments = sentiments.filter((s) => s === 'neutral').length
  const negativeSentiments = sentiments.filter((s) => s === 'negative').length

  // Common key points across all meetings
  const allKeyPoints = analyzedMeetings.flatMap(
    (m) => (m.recording!.keyPoints as string[] | null) ?? []
  )

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Back */}
      <Link
        href="/employees"
        className="inline-flex items-center gap-2 text-sm text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to team
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={employee.name} src={employee.image} size="xl" alt="" className="rounded-2xl" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-bold text-dark-gray dark:text-white">
                {employee.name}
              </h1>
              {employee.role === UserRole.REPORTER && <Pill tone="purple">Reporter</Pill>}
            </div>
            <p className="text-sm text-medium-gray flex items-center gap-1.5 mt-0.5">
              <Mail className="w-3.5 h-3.5" />
              {employee.email}
            </p>
          </div>
        </div>
        <QuarterlySummary userId={employee.id} userName={employee.name} />
      </div>

      {/* Stat Cards Row 1 */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Total Meetings" value={totalMeetings} icon={Calendar} accent="blue" />
        <StatCard label="Attended" value={completedMeetings} icon={CheckCircle2} accent="green" />
        <StatCard label="Missed" value={missedMeetings} icon={XCircle} accent="red" />
        <StatCard label="Recordings" value={recordingsCompleted} icon={Mic} accent="neutral" />
      </div>

      {/* Stat Cards Row 2: Info + Attendance */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Department" value={<span className="text-base sm:text-lg">{employee.department?.name || 'None'}</span>} icon={Building2} accent="neutral" />
        <StatCard label="Reports To" value={<span className="text-base sm:text-lg">{employee.reportsTo?.name || 'None'}</span>} icon={Users} accent="neutral" />
        <StatCard label="Attendance" value={`${attendanceRate}%`} icon={TrendingUp} accent="amber" />
        <StatCard label="Tasks Done" value={`${completedTodos}/${todos.length}`} icon={CheckSquare} accent="orange" />
      </div>

      {/* Overall Analysis (combined from all recordings) */}
      {analyzedMeetings.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-off-white dark:border-medium-gray/20">
            <h2 className="font-semibold text-dark-gray dark:text-white flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-orange" />
              Overall Analysis ({plural(analyzedMeetings.length, 'recording')})
            </h2>
          </div>
          <div className="p-4 sm:p-6 space-y-5">
            {/* Quality + Sentiment Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {avgQuality !== null && (
                <div className="text-center p-3 rounded-xl bg-off-white/50 dark:bg-dark-gray/50">
                  <p className="text-2xl font-bold text-dark-gray dark:text-white">{avgQuality}</p>
                  <p className="text-xs text-medium-gray">Avg Quality</p>
                </div>
              )}
              <div className="text-center p-3 rounded-xl bg-green-500/5">
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{positiveSentiments}</p>
                <p className="text-xs text-medium-gray">Positive</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-gray-500/5">
                <p className="text-2xl font-bold text-gray-600 dark:text-gray-400">{neutralSentiments}</p>
                <p className="text-xs text-medium-gray">Neutral</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-red-500/5">
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">{negativeSentiments}</p>
                <p className="text-xs text-medium-gray">Negative</p>
              </div>
            </div>

            {/* Sentiment bar */}
            {sentiments.length > 0 && (
              <div>
                <p className="text-xs text-medium-gray mb-2">Sentiment Distribution</p>
                <div className="flex h-3 rounded-full overflow-hidden bg-off-white dark:bg-dark-gray">
                  {positiveSentiments > 0 && (
                    <div
                      className="bg-green-500 transition-all"
                      style={{ width: `${(positiveSentiments / sentiments.length) * 100}%` }}
                    />
                  )}
                  {neutralSentiments > 0 && (
                    <div
                      className="bg-gray-400 transition-all"
                      style={{ width: `${(neutralSentiments / sentiments.length) * 100}%` }}
                    />
                  )}
                  {negativeSentiments > 0 && (
                    <div
                      className="bg-red-500 transition-all"
                      style={{ width: `${(negativeSentiments / sentiments.length) * 100}%` }}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Combined key points */}
            {allKeyPoints.length > 0 && (
              <div>
                <p className="text-xs text-medium-gray mb-2">
                  Recurring Topics (from {analyzedMeetings.length} meetings)
                </p>
                <div className="flex flex-wrap gap-2">
                  {/* Show unique points, max 12 */}
                  {[...new Set(allKeyPoints)]
                    .slice(0, 12)
                    .map((point, i) => (
                      <Pill key={i} tone="blue" className="whitespace-normal">
                        {point.length > 60 ? point.slice(0, 60) + '...' : point}
                      </Pill>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Meeting History (ALL meetings) */}
      <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-off-white dark:border-medium-gray/20 flex items-center justify-between">
          <h2 className="font-semibold text-dark-gray dark:text-white flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Meeting History
          </h2>
          <span className="text-xs text-medium-gray">{totalMeetings} total</span>
        </div>
        {meetings.length === 0 ? (
          <div className="p-8 text-center">
            <Calendar className="w-12 h-12 text-light-gray mx-auto mb-3" />
            <p className="text-medium-gray">No meetings yet</p>
          </div>
        ) : (
          <MeetingHistoryList meetings={meetings} />
        )}
      </div>

      {/* Recent Tasks */}
      <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-off-white dark:border-medium-gray/20">
          <h2 className="font-semibold text-dark-gray dark:text-white flex items-center gap-2">
            <CheckSquare className="w-5 h-5" />
            Recent Tasks
          </h2>
        </div>
        {todos.length === 0 ? (
          <div className="p-8 text-center">
            <CheckSquare className="w-12 h-12 text-light-gray mx-auto mb-3" />
            <p className="text-medium-gray">No tasks yet</p>
          </div>
        ) : (
          <div className="divide-y divide-off-white dark:divide-medium-gray/20">
            {todos.map((todo) => (
              <div key={todo.id} className="px-4 sm:px-6 py-3 sm:py-4 even:bg-off-white/40 dark:even:bg-charcoal/40">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        todo.status === 'DONE'
                          ? 'bg-green-500/10'
                          : todo.status === 'IN_PROGRESS'
                            ? 'bg-blue-500/10'
                            : 'bg-gray-500/10'
                      }`}
                    >
                      <CheckSquare
                        className={`w-4 h-4 ${
                          todo.status === 'DONE'
                            ? 'text-green-500'
                            : todo.status === 'IN_PROGRESS'
                              ? 'text-blue-500'
                              : 'text-gray-500'
                        }`}
                      />
                    </div>
                    <div className="min-w-0">
                      <p
                        className={`text-sm font-medium truncate ${
                          todo.status === 'DONE'
                            ? 'text-medium-gray line-through'
                            : 'text-dark-gray dark:text-white'
                        }`}
                      >
                        {todo.title}
                      </p>
                      {todo.dueDate && (
                        <p className="text-xs text-medium-gray">
                          Due: {formatDateOnly(todo.dueDate, 'short')}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <TodoPriorityPill priority={todo.priority} />
                    <TodoStatusPill status={todo.status} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
