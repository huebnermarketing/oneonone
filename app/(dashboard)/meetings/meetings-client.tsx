'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Calendar,
  Plus,
  Clock,
  CheckCircle2,
  AlertCircle,
  Repeat,
  Trash2,
  Play,
  Pause,
  ChevronRight,
  X,
} from 'lucide-react'
import { useFormat } from '@/components/providers/timezone-provider'
import { UserRole, RecurringFrequency, MeetingStatus } from '@prisma/client'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-modal'
import { MeetingStatusPill, Pill } from '@/components/ui/pill'
import { DAY_NAMES } from '@/lib/ui'
import { Pagination } from '@/components/ui/pagination'

interface Meeting {
  id: string
  meetingDate: Date
  status: MeetingStatus
  formSubmittedAt: Date | string | null
  employeeId: string
  recurringScheduleId?: string | null
  reporter?: { name: string | null; email: string | null } | null
  employee?: { name: string | null; email: string | null } | null
}

interface RecurringSchedule {
  id: string
  frequency: RecurringFrequency
  dayOfWeek: number
  timeOfDay: string
  isActive: boolean
  nextMeetingDate: Date | null
  employee: { id: string; name: string | null; email?: string | null }
  reporter?: { name: string | null } | null
}

interface MeetingsClientProps {
  meetings: Meeting[]
  recurringSchedules: RecurringSchedule[]
  currentUserId: string
  userRole: UserRole
}

export function MeetingsClient({
  meetings,
  recurringSchedules,
  currentUserId,
  userRole,
}: MeetingsClientProps) {
  const router = useRouter()
  const { toastError } = useToast()
  const confirm = useConfirm()
  const f = useFormat()
  const [activeTab, setActiveTab] = useState<'all' | 'one-time' | 'recurring'>('all')
  const [isDeleting, setIsDeleting] = useState<string | null>(null)
  const [isToggling, setIsToggling] = useState<string | null>(null)
  const [deletedScheduleIds, setDeletedScheduleIds] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const ITEMS_PER_PAGE = 15

  const showMessage = useCallback((type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    if (type === 'error') {
      toastError(text)
    }
    setTimeout(() => setMessage(null), 5000)
  }, [toastError])

  const now = new Date()
  const canSchedule =
    userRole === UserRole.REPORTER || userRole === UserRole.SUPER_ADMIN

  const visibleRecurring = recurringSchedules.filter(
    (s) => !deletedScheduleIds.has(s.id)
  )

  const upcomingMeetings = meetings.filter(
    (m) => new Date(m.meetingDate) >= now && (m.status === 'SCHEDULED' || m.status === 'PROPOSED')
  )
  const completedMeetings = meetings.filter((m) => m.status === 'COMPLETED')
  const pendingFormMeetings = meetings.filter(
    (m) =>
      m.status === 'SCHEDULED' &&
      new Date(m.meetingDate) < now &&
      !m.formSubmittedAt
  )

  // Filter meetings by tab
  const tabFilteredMeetings = activeTab === 'one-time'
    ? meetings.filter((m) => !m.recurringScheduleId)
    : activeTab === 'recurring'
      ? meetings.filter((m) => !!m.recurringScheduleId)
      : meetings

  // Sort: upcoming/active meetings first (nearest date first), then past meetings (most recent first)
  const sortedMeetings = [...tabFilteredMeetings].sort((a, b) => {
    const dateA = new Date(a.meetingDate).getTime()
    const dateB = new Date(b.meetingDate).getTime()
    const nowMs = now.getTime()
    const aIsUpcoming = dateA >= nowMs && (a.status === 'SCHEDULED' || a.status === 'PROPOSED')
    const bIsUpcoming = dateB >= nowMs && (b.status === 'SCHEDULED' || b.status === 'PROPOSED')

    if (aIsUpcoming && !bIsUpcoming) return -1
    if (!aIsUpcoming && bIsUpcoming) return 1
    if (aIsUpcoming && bIsUpcoming) return dateA - dateB
    return dateB - dateA
  })

  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = startIndex + ITEMS_PER_PAGE
  const paginatedMeetings = sortedMeetings.slice(startIndex, endIndex)

  const handleDeleteRecurring = async (id: string) => {
    if (!await confirm('Are you sure you want to delete this recurring schedule?', { variant: 'danger' })) {
      return
    }

    setIsDeleting(id)
    setMessage(null)

    try {
      const res = await fetch(`/api/recurring-schedules/${id}`, {
        method: 'DELETE',
      })

      const body = await res.json().catch(() => ({ error: 'Invalid response' }))
      const errorText =
        typeof body?.error === 'string' ? body.error : 'Failed to delete schedule'

      if (!res.ok) {
        showMessage('error', errorText)
        return
      }

      setDeletedScheduleIds((prev) => new Set(prev).add(id))
      showMessage('success', 'Recurring schedule deleted.')
      router.refresh()
    } catch (err) {
      const text =
        err instanceof Error ? err.message : 'Network or server error'
      showMessage('error', `Delete failed: ${text}`)
    } finally {
      setIsDeleting(null)
    }
  }

  const handleToggleRecurring = async (id: string, isActive: boolean) => {
    setIsToggling(id)
    setMessage(null)
    try {
      const res = await fetch(`/api/recurring-schedules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive }),
      })
      if (res.ok) {
        router.refresh()
      } else {
        const body = await res.json().catch(() => ({}))
        const errorText =
          typeof body?.error === 'string'
            ? body.error
            : 'Failed to update schedule'
        showMessage('error', errorText)
      }
    } catch (err) {
      const text =
        err instanceof Error ? err.message : 'Network or server error'
      showMessage('error', `Update failed: ${text}`)
    } finally {
      setIsToggling(null)
    }
  }

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':')
    const h = parseInt(hours, 10)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const hour = h % 12 || 12
    return `${hour}:${minutes} ${ampm}`
  }

  const isEmployeeRole = userRole === UserRole.EMPLOYEE

  const renderRecurringList = (schedules: RecurringSchedule[]) => (
    <div className="divide-y divide-off-white dark:divide-medium-gray/20">
      {schedules.map((schedule) => {
        const displayName = isEmployeeRole
          ? schedule.reporter?.name || 'Your manager'
          : schedule.employee.name

        return (
        <div
          key={schedule.id}
          className="flex items-center gap-3 sm:gap-4 px-4 sm:px-6 py-3 sm:py-4 even:bg-off-white/40 dark:even:bg-charcoal/40"
        >
          <div
            className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
              schedule.isActive ? 'bg-green-500/10' : 'bg-gray-500/10'
            }`}
          >
            <Repeat
              className={`w-5 h-5 sm:w-6 sm:h-6 ${
                schedule.isActive ? 'text-green-500' : 'text-gray-400'
              }`}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-dark-gray dark:text-white text-sm sm:text-base truncate">
              {displayName}
            </p>
            <p className="text-xs sm:text-sm text-medium-gray truncate">
              {schedule.frequency === 'BIWEEKLY'
                ? 'Bi-weekly'
                : schedule.frequency.toLowerCase()}{' '}
              • {DAY_NAMES[schedule.dayOfWeek]} at{' '}
              {formatTime(schedule.timeOfDay)}
            </p>
          </div>
          <Pill tone={schedule.isActive ? 'green' : 'neutral'} className="hidden sm:inline-flex">
            {schedule.isActive ? 'Active' : 'Paused'}
          </Pill>
          {canSchedule && (
            <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={() =>
                  handleToggleRecurring(schedule.id, schedule.isActive)
                }
                disabled={isToggling === schedule.id}
                className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-off-white dark:hover:bg-charcoal transition-colors focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:outline-none"
                title={schedule.isActive ? 'Pause' : 'Resume'}
                aria-label={schedule.isActive ? `Pause schedule for ${displayName ?? 'employee'}` : `Resume schedule for ${displayName ?? 'employee'}`}
              >
                {isToggling === schedule.id ? (
                  <div className="w-4 h-4 border-2 border-medium-gray border-t-transparent rounded-full animate-spin" />
                ) : schedule.isActive ? (
                  <Pause className="w-4 h-4 text-medium-gray" />
                ) : (
                  <Play className="w-4 h-4 text-medium-gray" />
                )}
              </button>
              <button
                type="button"
                onClick={() => handleDeleteRecurring(schedule.id)}
                disabled={isDeleting === schedule.id}
                className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:outline-none"
                title="Delete"
                aria-label={`Delete schedule for ${displayName ?? 'employee'}`}
              >
                {isDeleting === schedule.id ? (
                  <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4 text-red-500" />
                )}
              </button>
            </div>
          )}
        </div>
        )
      })}
    </div>
  )

  const hasNoData = meetings.length === 0 && visibleRecurring.length === 0

  return (
    <div className={hasNoData ? 'space-y-3 sm:space-y-5' : 'space-y-4 sm:space-y-5'}>
      {/* Message banner */}
      {message && (
        <div
          className={`flex items-center justify-between gap-4 rounded-xl px-4 py-3 ${
            message.type === 'success'
              ? 'bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20'
              : 'bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20'
          }`}
        >
          <p className="text-sm font-medium">{message.text}</p>
          <button
            type="button"
            onClick={() => setMessage(null)}
            className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-dark-gray dark:text-white mb-1">
            Meetings
          </h1>
          <p className="text-sm sm:text-base text-medium-gray">Manage your one-on-one sessions</p>
        </div>
        {canSchedule && (
          <Link
            href="/meetings/new"
            className="flex items-center gap-2 px-4 py-2.5 sm:px-5 sm:py-3 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white transition-colors text-sm sm:text-base flex-shrink-0 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:outline-none"
          >
            <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="hidden sm:inline">Schedule Meeting</span>
            <span className="sm:hidden">Schedule</span>
          </Link>
        )}
      </div>

      {/* Stats — hidden when there's absolutely no data to keep page compact */}
      {!hasNoData && (
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-2.5 sm:p-5">
            <div className="flex items-center gap-2 sm:gap-4">
              <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <Clock className="w-4 h-4 sm:w-6 sm:h-6 text-blue-500" />
              </div>
              <div>
                <p className="text-lg sm:text-2xl font-bold text-dark-gray dark:text-white">
                  {upcomingMeetings.length}
                </p>
                <p className="text-xs sm:text-sm text-medium-gray">Upcoming</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-2.5 sm:p-5">
            <div className="flex items-center gap-2 sm:gap-4">
              <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-xl bg-green-500/10 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-4 h-4 sm:w-6 sm:h-6 text-green-500" />
              </div>
              <div>
                <p className="text-lg sm:text-2xl font-bold text-dark-gray dark:text-white">
                  {completedMeetings.length}
                </p>
                <p className="text-xs sm:text-sm text-medium-gray">Completed</p>
              </div>
            </div>
          </div>
          {pendingFormMeetings.length > 0 ? (
            <div className="rounded-2xl bg-amber-500/5 border border-amber-500/20 p-2.5 sm:p-5">
              <div className="flex items-center gap-2 sm:gap-4">
                <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-4 h-4 sm:w-6 sm:h-6 text-amber-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-lg sm:text-2xl font-bold text-amber-600 dark:text-amber-400">
                    {pendingFormMeetings.length}
                  </p>
                  <p className="text-xs sm:text-sm text-medium-gray">Pending Form</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-2.5 sm:p-5">
              <div className="flex items-center gap-2 sm:gap-4">
                <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-off-white dark:bg-dark-gray flex items-center justify-center flex-shrink-0">
                  <Repeat className="w-4 h-4 sm:w-6 sm:h-6 text-dark-gray dark:text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-lg sm:text-2xl font-bold text-dark-gray dark:text-white">
                    {recurringSchedules.length}
                  </p>
                  <p className="text-xs sm:text-sm text-medium-gray">Recurring</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}


      {/* Tabs — visible for all users when there's data */}
      {!hasNoData && (
        <div className="overflow-x-auto">
          <div className="flex gap-1 p-1 bg-off-white dark:bg-charcoal rounded-xl w-fit min-w-0" role="tablist" aria-label="Meeting type">
          {(['all', 'one-time', 'recurring'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => { setActiveTab(tab); setCurrentPage(1) }}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:outline-none ${
                activeTab === tab
                  ? 'bg-white dark:bg-charcoal text-dark-gray dark:text-white shadow-sm'
                  : 'text-medium-gray hover:text-dark-gray dark:hover:text-white'
              }`}
            >
              {tab === 'all' && <Calendar className="w-4 h-4" />}
              {tab === 'one-time' && <Clock className="w-4 h-4" />}
              {tab === 'recurring' && <Repeat className="w-4 h-4" />}
              {tab === 'all' ? 'All' : tab === 'one-time' ? 'One-time' : 'Recurring'}
            </button>
          ))}
          </div>
        </div>
      )}

      {/* Recurring schedules management section (only on 'recurring' tab) */}
      {activeTab === 'recurring' && visibleRecurring.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
          <div className="px-6 py-3 border-b border-off-white dark:border-medium-gray/20 flex items-center justify-between">
            <h3 className="font-semibold text-dark-gray dark:text-white">
              Recurring Schedules
            </h3>
            {canSchedule && (
              <Link
                href="/meetings/recurring"
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-medium-gray hover:text-dark-gray dark:hover:text-white rounded-lg hover:bg-off-white dark:hover:bg-charcoal transition-colors"
              >
                <Plus className="w-4 h-4" />
                Manage
              </Link>
            )}
          </div>
          {renderRecurringList(visibleRecurring)}
        </div>
      )}

      {/* Meetings list */}
      {sortedMeetings.length > 0 ? (
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
          <div className="divide-y divide-off-white dark:divide-medium-gray/20">
            {paginatedMeetings.map((meeting) => {
              const meetingDate = new Date(meeting.meetingDate)
              const isPast = meetingDate < now
              const needsForm =
                isPast &&
                meeting.status === 'SCHEDULED' &&
                !meeting.formSubmittedAt
              const isEmployee = meeting.employeeId === currentUserId
              const otherPerson = isEmployee
                ? meeting.reporter
                : meeting.employee

              return (
                <Link
                  key={meeting.id}
                  href={`/meetings/${meeting.id}`}
                  className="flex items-center gap-3 sm:gap-4 px-4 sm:px-6 py-3 sm:py-4 even:bg-off-white/40 dark:even:bg-charcoal/40 hover:bg-off-white/70 dark:hover:bg-charcoal/60 active:bg-off-white dark:active:bg-charcoal transition-colors"
                >
                  <div
                    className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      meeting.status === 'COMPLETED'
                        ? 'bg-green-500/10'
                        : needsForm
                          ? 'bg-amber-500/10'
                          : 'bg-blue-500/10'
                    }`}
                  >
                    {meeting.recurringScheduleId ? (
                      <Repeat className={`w-5 h-5 sm:w-6 sm:h-6 ${meeting.status === 'COMPLETED' ? 'text-green-500' : needsForm ? 'text-amber-500' : 'text-blue-500'}`} />
                    ) : (
                      <Calendar className={`w-5 h-5 sm:w-6 sm:h-6 ${meeting.status === 'COMPLETED' ? 'text-green-500' : needsForm ? 'text-amber-500' : 'text-blue-500'}`} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-dark-gray dark:text-white text-sm sm:text-base truncate">
                        {otherPerson?.name ?? 'Unknown'}
                      </p>
                      {needsForm && isEmployee && (
                        <Pill tone="amber" className="flex-shrink-0">Form needed</Pill>
                      )}
                    </div>
                    <p className="text-xs sm:text-sm text-medium-gray">
                      {f.meetingShort(meetingDate)}
                    </p>
                  </div>
                  <MeetingStatusPill status={meeting.status} isPast={isPast} className="flex-shrink-0" />
                  <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-light-gray hidden sm:block" />
                </Link>
              )
            })}
          </div>
          <Pagination
            offset={startIndex}
            limit={ITEMS_PER_PAGE}
            total={sortedMeetings.length}
            onChange={(offset) => setCurrentPage(Math.floor(offset / ITEMS_PER_PAGE) + 1)}
            noun="meetings"
            className="px-4 py-3 border-t border-off-white dark:border-medium-gray/20"
          />
        </div>
      ) : !hasNoData ? (
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6 sm:p-8 text-center">
          {activeTab === 'recurring' ? (
            <Repeat className="w-10 h-10 sm:w-12 sm:h-12 text-light-gray mx-auto mb-2 sm:mb-3" />
          ) : (
            <Calendar className="w-10 h-10 sm:w-12 sm:h-12 text-light-gray mx-auto mb-2 sm:mb-3" />
          )}
          <h3 className="text-base sm:text-lg font-semibold text-dark-gray dark:text-white mb-1">
            {activeTab === 'one-time' ? 'No one-time meetings' : activeTab === 'recurring' ? 'No recurring meetings' : 'No meetings yet'}
          </h3>
          <p className="text-sm text-medium-gray max-w-md mx-auto mb-3 sm:mb-4">
            {canSchedule
              ? activeTab === 'recurring'
                ? 'Set up a recurring schedule to automatically create meetings.'
                : 'Get started by scheduling your first one-on-one meeting.'
              : 'Your manager will schedule one-on-one meetings with you.'}
          </p>
          {canSchedule && (
            <Link
              href={activeTab === 'recurring' ? '/meetings/recurring' : '/meetings/new'}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white transition-colors text-sm"
            >
              <Plus className="w-4 h-4" />
              {activeTab === 'recurring' ? 'Create Schedule' : 'Schedule Meeting'}
            </Link>
          )}
        </div>
      ) : hasNoData ? (
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-6 sm:p-8 text-center">
          <Calendar className="w-10 h-10 sm:w-12 sm:h-12 text-light-gray mx-auto mb-2 sm:mb-3" />
          <h3 className="text-base sm:text-lg font-semibold text-dark-gray dark:text-white mb-1">
            No meetings yet
          </h3>
          <p className="text-sm text-medium-gray max-w-md mx-auto mb-3 sm:mb-4">
            {canSchedule
              ? 'Get started by scheduling your first one-on-one meeting or a recurring schedule.'
              : 'Your manager will schedule one-on-one meetings with you.'}
          </p>
          {canSchedule && (
            <Link
              href="/meetings/new"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white transition-colors text-sm"
            >
              <Plus className="w-4 h-4" />
              Schedule Meeting
            </Link>
          )}
        </div>
      ) : null}
    </div>
  )
}
