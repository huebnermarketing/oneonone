'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bell,
  Calendar,
  CheckSquare,
  FileText,
  Mic,
  AlertCircle,
  Clock,
  Trash2,
  CheckCheck,
  Filter,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useConfirm } from '@/components/ui/confirm-modal'
import { useFormat } from '@/components/providers/timezone-provider'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  link?: string
  isRead: boolean
  createdAt: string
}

const NOTIFICATION_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'MEETING_REMINDER', label: 'Meeting Reminders' },
  { value: 'MEETING_SCHEDULED', label: 'Meeting Scheduled' },
  { value: 'MEETING_CANCELLED', label: 'Meeting Cancelled' },
  { value: 'TODO_ASSIGNED', label: 'Task Assigned' },
  { value: 'TODO_DUE_SOON', label: 'Task Due Soon' },
  { value: 'TODO_OVERDUE', label: 'Task Overdue' },
  { value: 'FORM_SUBMITTED', label: 'Form Submitted' },
  { value: 'RECORDING_READY', label: 'Recording Ready' },
  { value: 'SYSTEM', label: 'System' },
]

const READ_FILTERS = [
  { value: '', label: 'All' },
  { value: 'false', label: 'Unread' },
  { value: 'true', label: 'Read' },
]

const notificationIcons: Record<string, any> = {
  MEETING_REMINDER: Clock,
  MEETING_SCHEDULED: Calendar,
  MEETING_CANCELLED: Calendar,
  TODO_ASSIGNED: CheckSquare,
  TODO_DUE_SOON: CheckSquare,
  TODO_OVERDUE: AlertCircle,
  FORM_SUBMITTED: FileText,
  RECORDING_READY: Mic,
  SYSTEM: Bell,
}

const notificationColors: Record<string, string> = {
  MEETING_REMINDER: 'text-blue-500 bg-blue-500/10',
  MEETING_SCHEDULED: 'text-green-500 bg-green-500/10',
  MEETING_CANCELLED: 'text-red-500 bg-red-500/10',
  TODO_ASSIGNED: 'text-purple-500 bg-purple-500/10',
  TODO_DUE_SOON: 'text-amber-500 bg-amber-500/10',
  TODO_OVERDUE: 'text-red-500 bg-red-500/10',
  FORM_SUBMITTED: 'text-teal-500 bg-teal-500/10',
  RECORDING_READY: 'text-pink-500 bg-pink-500/10',
  SYSTEM: 'text-gray-500 bg-gray-500/10',
}

const typeLabels: Record<string, string> = {
  MEETING_REMINDER: 'Reminder',
  MEETING_SCHEDULED: 'Scheduled',
  MEETING_CANCELLED: 'Cancelled',
  TODO_ASSIGNED: 'Task',
  TODO_DUE_SOON: 'Due Soon',
  TODO_OVERDUE: 'Overdue',
  FORM_SUBMITTED: 'Form',
  RECORDING_READY: 'Recording',
  SYSTEM: 'System',
}

export function NotificationsClient() {
  const router = useRouter()
  const confirm = useConfirm()
  const f = useFormat()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  // Filters
  const [typeFilter, setTypeFilter] = useState('')
  const [readFilter, setReadFilter] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // Pagination
  const [page, setPage] = useState(0)
  const pageSize = 20

  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('limit', pageSize.toString())
      params.set('offset', (page * pageSize).toString())
      if (typeFilter) params.set('type', typeFilter)
      if (readFilter) params.set('read', readFilter)

      const res = await fetch(`/api/notifications?${params}`)
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications || [])
        setUnreadCount(data.unreadCount || 0)
        setTotal(data.total || 0)
      }
    } catch (error) {
      // Error handled by toast
    } finally {
      setLoading(false)
    }
  }, [page, typeFilter, readFilter])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  const handleMarkAllRead = async () => {
    setActionLoading(true)
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markAllRead' }),
      })
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
        setUnreadCount(0)
      }
    } catch (error) {
      // Error handled by toast
    } finally {
      setActionLoading(false)
    }
  }

  const handleDeleteAllRead = async () => {
    if (!await confirm('Delete all read notifications?', { variant: 'danger' })) return
    setActionLoading(true)
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteAllRead' }),
      })
      if (res.ok) {
        await fetchNotifications()
      }
    } catch (error) {
      // Error handled by toast
    } finally {
      setActionLoading(false)
    }
  }

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.isRead) {
      try {
        await fetch(`/api/notifications/${notification.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isRead: true }),
        })
        setNotifications((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n))
        )
        setUnreadCount((c) => Math.max(0, c - 1))
      } catch (error) {
        // Error handled by toast
      }
    }
    if (notification.link) {
      router.push(notification.link)
    }
  }

  const handleDelete = async (e: React.MouseEvent, notificationId: string) => {
    e.stopPropagation()
    try {
      const res = await fetch(`/api/notifications/${notificationId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        const removed = notifications.find((n) => n.id === notificationId)
        setNotifications((prev) => prev.filter((n) => n.id !== notificationId))
        setTotal((t) => Math.max(0, t - 1))
        if (removed && !removed.isRead) {
          setUnreadCount((c) => Math.max(0, c - 1))
        }
      }
    } catch (error) {
      // Error handled by toast
    }
  }

  const formatTime = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    if (days < 7) return `${days}d ago`
    const sameYear = f.dateKey(date).slice(0, 4) === f.dateKey(now).slice(0, 4)
    return sameYear ? f.monthDay(date) : f.date(date, 'short')
  }

  const totalPages = Math.ceil(total / pageSize)
  const hasActiveFilters = typeFilter || readFilter

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-dark-gray dark:text-white">
            Notifications
          </h1>
          <p className="text-sm text-medium-gray mt-0.5">
            {unreadCount > 0
              ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`
              : 'You\'re all caught up'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl transition-colors',
              hasActiveFilters
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : 'text-medium-gray hover:bg-off-white dark:hover:bg-dark-gray'
            )}
          >
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Filter</span>
            {hasActiveFilters && (
              <span className="w-2 h-2 rounded-full bg-blue-500" />
            )}
          </button>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-medium-gray hover:text-dark-gray dark:hover:text-white hover:bg-off-white dark:hover:bg-dark-gray rounded-xl transition-colors disabled:opacity-50"
            >
              <CheckCheck className="w-4 h-4" />
              <span className="hidden sm:inline">Mark all read</span>
            </button>
          )}
          <button
            onClick={handleDeleteAllRead}
            disabled={actionLoading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-medium-gray hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-colors disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden sm:inline">Clear read</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 p-4 flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="block text-xs text-medium-gray mb-1">Type</label>
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value)
                setPage(0)
              }}
              className="w-full px-3 py-2 text-sm rounded-xl border border-off-white dark:border-medium-gray/20 bg-off-white/50 dark:bg-dark-gray text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              {NOTIFICATION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs text-medium-gray mb-1">Status</label>
            <select
              value={readFilter}
              onChange={(e) => {
                setReadFilter(e.target.value)
                setPage(0)
              }}
              className="w-full px-3 py-2 text-sm rounded-xl border border-off-white dark:border-medium-gray/20 bg-off-white/50 dark:bg-dark-gray text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              {READ_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          {hasActiveFilters && (
            <div className="flex items-end">
              <button
                onClick={() => {
                  setTypeFilter('')
                  setReadFilter('')
                  setPage(0)
                }}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      {/* Notification List */}
      <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-medium-gray">Loading notifications...</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-12 text-center">
            <Bell className="w-16 h-16 text-light-gray mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-dark-gray dark:text-white mb-1">
              {hasActiveFilters ? 'No matching notifications' : 'No notifications yet'}
            </h3>
            <p className="text-sm text-medium-gray">
              {hasActiveFilters
                ? 'Try adjusting your filters'
                : 'You\'ll be notified about meetings, tasks, and recordings here'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-off-white dark:divide-medium-gray/20">
            {notifications.map((notification) => {
              const Icon = notificationIcons[notification.type] || Bell
              const colorClass =
                notificationColors[notification.type] || 'text-gray-500 bg-gray-500/10'
              const label = typeLabels[notification.type] || notification.type

              return (
                <div
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={cn(
                    'flex gap-3 px-4 sm:px-6 py-3 sm:py-4 cursor-pointer transition-colors group even:bg-off-white/40 dark:even:bg-charcoal/40',
                    notification.isRead
                      ? 'hover:bg-off-white/50 dark:hover:bg-charcoal/50'
                      : 'bg-blue-50/50 dark:bg-blue-500/5 hover:bg-blue-50 dark:hover:bg-blue-500/10'
                  )}
                >
                  {/* Icon */}
                  <div
                    className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
                      colorClass
                    )}
                  >
                    <Icon className="w-5 h-5" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p
                            className={cn(
                              'text-sm font-medium',
                              notification.isRead
                                ? 'text-medium-gray'
                                : 'text-dark-gray dark:text-white'
                            )}
                          >
                            {notification.title}
                          </p>
                          <span
                            className={cn(
                              'px-1.5 py-0.5 text-[10px] font-medium rounded-full',
                              colorClass
                            )}
                          >
                            {label}
                          </span>
                          {!notification.isRead && (
                            <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-sm text-medium-gray line-clamp-2 mt-0.5">
                          {notification.message}
                        </p>
                        <p className="text-xs text-light-gray mt-1">
                          {formatTime(notification.createdAt)}
                        </p>
                      </div>

                      {/* Delete button */}
                      <button
                        onClick={(e) => handleDelete(e, notification.id)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-medium-gray hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all flex-shrink-0"
                        title="Delete notification"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 sm:px-6 py-3 border-t border-off-white dark:border-medium-gray/20 flex items-center justify-between">
            <p className="text-xs text-medium-gray">
              Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)} of {total}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 text-xs font-medium text-medium-gray hover:text-dark-gray dark:hover:text-white hover:bg-off-white dark:hover:bg-dark-gray rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-xs text-medium-gray">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1.5 text-xs font-medium text-medium-gray hover:text-dark-gray dark:hover:text-white hover:bg-off-white dark:hover:bg-dark-gray rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
