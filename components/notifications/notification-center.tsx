'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFormat } from '@/components/providers/timezone-provider'
import { useToast } from '@/components/ui/toast'
import { notificationMeta } from '@/components/notifications/notification-meta'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  link?: string
  isRead: boolean
  createdAt: string
}

const DROPDOWN_WIDTH = 384
const DROPDOWN_MAX_HEIGHT = 500
const VIEWPORT_PADDING = 12
const POLL_MS = 30000

export interface NotificationStore {
  notifications: Notification[]
  unreadCount: number
  loading: boolean
  markAllRead: () => Promise<void>
  markRead: (id: string) => Promise<void>
}

/**
 * Notification list + 30s poller. Call ONCE per page (the sidebar does) and hand the store to every
 * <NotificationCenter> bell so several bells never start several pollers.
 */
export function useNotifications(): NotificationStore {
  const { toastError } = useToast()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const pollFailedRef = useRef(false)
  // Keep the poller's effect deps empty even if the toast fn identity changes
  const toastRef = useRef(toastError)
  useEffect(() => {
    toastRef.current = toastError
  }, [toastError])

  const fetchNotifications = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications')
      if (response.ok) {
        const data = await response.json()
        setNotifications(data.notifications || [])
        setUnreadCount(data.unreadCount || 0)
        pollFailedRef.current = false
      }
    } catch (error) {
      // Polls every 30s: toast once per failure streak, not on every tick
      if (!pollFailedRef.current) {
        pollFailedRef.current = true
        toastRef.current('Failed to load notifications')
      }
    }
  }, [])

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, POLL_MS)
    return () => clearInterval(interval)
  }, [fetchNotifications])

  const markAllRead = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markAllRead' }),
      })
      if (response.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
        setUnreadCount(0)
      }
    } catch (error) {
      toastError('Failed to mark notifications as read')
    } finally {
      setLoading(false)
    }
  }, [toastError])

  const markRead = useCallback(async (id: string) => {
    try {
      await fetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: true }),
      })
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)))
      setUnreadCount((c) => Math.max(0, c - 1))
    } catch (error) {
      toastError('Failed to mark notification as read')
    }
  }, [toastError])

  return { notifications, unreadCount, loading, markAllRead, markRead }
}

/** Bell + dropdown. Presentational: data and polling come from `useNotifications()` via `store`. */
export function NotificationCenter({ store }: { store: NotificationStore }) {
  const { notifications, unreadCount, loading, markAllRead, markRead } = store
  const router = useRouter()
  const f = useFormat()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})

  const computePosition = useCallback(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    // On small screens, use a centered overlay near the bottom
    if (vw < 640) {
      setDropdownStyle({
        position: 'fixed',
        left: VIEWPORT_PADDING,
        right: VIEWPORT_PADDING,
        bottom: 80,
        width: 'auto',
        maxHeight: `${vh - 160}px`,
      })
      return
    }

    // Desktop: try to open above the bell, aligned to the left edge
    let left = rect.left
    let bottom = vh - rect.top + 8

    // If the dropdown would overflow the right edge, shift left
    if (left + DROPDOWN_WIDTH > vw - VIEWPORT_PADDING) {
      left = vw - DROPDOWN_WIDTH - VIEWPORT_PADDING
    }
    // If it would overflow the left edge, shift right
    if (left < VIEWPORT_PADDING) {
      left = VIEWPORT_PADDING
    }

    // If not enough room above, open below the bell instead
    const spaceAbove = rect.top
    const spaceBelow = vh - rect.bottom
    if (spaceAbove < 200 && spaceBelow > spaceAbove) {
      bottom = vh - rect.bottom - 8
      // This means top-positioned; we'll flip to using `top` instead
      setDropdownStyle({
        position: 'fixed',
        left,
        top: rect.bottom + 8,
        width: DROPDOWN_WIDTH,
        maxHeight: `${Math.min(DROPDOWN_MAX_HEIGHT, spaceBelow - VIEWPORT_PADDING)}px`,
      })
      return
    }

    setDropdownStyle({
      position: 'fixed',
      left,
      bottom,
      width: DROPDOWN_WIDTH,
      maxHeight: `${Math.min(DROPDOWN_MAX_HEIGHT, spaceAbove - VIEWPORT_PADDING)}px`,
    })
  }, [])

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Recompute position on open, scroll, resize
  useEffect(() => {
    if (!isOpen) return
    computePosition()
    window.addEventListener('resize', computePosition)
    window.addEventListener('scroll', computePosition, true)
    return () => {
      window.removeEventListener('resize', computePosition)
      window.removeEventListener('scroll', computePosition, true)
    }
  }, [isOpen, computePosition])

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.isRead) await markRead(notification.id)

    if (notification.link) {
      setIsOpen(false)
      router.push(notification.link)
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
    return f.date(date, 'short')
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Bell Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Notifications"
        aria-expanded={isOpen}
        className="relative w-10 h-10 flex items-center justify-center rounded-xl hover:bg-off-white dark:hover:bg-dark-gray transition-colors"
      >
        <Bell className="w-5 h-5 text-medium-gray" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown — always fixed, positioned by JS to stay in viewport */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Notifications"
          style={dropdownStyle}
          className="bg-white dark:bg-charcoal rounded-2xl border border-off-white dark:border-medium-gray/20 shadow-2xl overflow-hidden z-[100] animate-in fade-in-0 zoom-in-95 duration-200 flex flex-col"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-off-white dark:border-medium-gray/20 flex items-center justify-between shrink-0">
            <h3 className="font-semibold text-dark-gray dark:text-white">Notifications</h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                disabled={loading}
                className="text-xs font-medium text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notifications List */}
          <div className="overflow-y-auto flex-1 min-h-0">
            {notifications.length === 0 ? (
              <div className="py-12 text-center">
                <Bell className="w-12 h-12 text-light-gray mx-auto mb-3" />
                <p className="text-medium-gray">No notifications yet</p>
              </div>
            ) : (
              <div className="divide-y divide-off-white dark:divide-medium-gray/20">
                {notifications.map((notification) => {
                  const { icon: Icon, tone: colorClass } = notificationMeta(notification.type)

                  return (
                    <button
                      key={notification.id}
                      type="button"
                      onClick={() => handleNotificationClick(notification)}
                      className={cn(
                        'w-full px-4 py-3 text-left hover:bg-off-white dark:hover:bg-charcoal transition-colors',
                        !notification.isRead && 'bg-blue-50/50 dark:bg-blue-500/5'
                      )}
                    >
                      <div className="flex gap-3">
                        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', colorClass)}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={cn(
                              'text-sm font-medium truncate',
                              notification.isRead 
                                ? 'text-medium-gray' 
                                : 'text-dark-gray dark:text-white'
                            )}>
                              {notification.title}
                            </p>
                            {!notification.isRead && (
                              <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-1.5" />
                            )}
                          </div>
                          <p className="text-sm text-medium-gray line-clamp-2 mt-0.5">
                            {notification.message}
                          </p>
                          <p className="text-xs text-light-gray mt-1">
                            {formatTime(notification.createdAt)}
                          </p>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2 border-t border-off-white dark:border-medium-gray/20 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false)
                  router.push('/notifications')
                }}
                className="text-xs font-medium text-medium-gray hover:text-dark-gray dark:hover:text-white transition-colors"
              >
                View all notifications
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
