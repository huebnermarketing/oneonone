import { NextRequest, NextResponse } from 'next/server'
import { parseBody, parseQuery, withApiAuth } from '@/lib/api'
import { createAuditLog } from '@/lib/audit'
import {
  getFilteredNotifications,
  getUnreadCount,
  markAllNotificationsAsRead,
  deleteAllReadNotifications,
  deleteAllNotifications,
} from '@/lib/notifications'
import { notificationActionSchema, notificationsQuery } from '@/lib/validation/misc'

export const dynamic = 'force-dynamic'

/**
 * GET /api/notifications
 * `countOnly=true` returns just the unread count; otherwise a filtered, paginated list for the current user.
 */
export const GET = withApiAuth(async (req: NextRequest, { user }) => {
  const query = parseQuery(req, notificationsQuery)

  if (query.countOnly) {
    const count = await getUnreadCount(user.id)
    return NextResponse.json({ count })
  }

  const [{ notifications, total }, unreadCount] = await Promise.all([
    getFilteredNotifications(user.id, {
      type: query.type,
      isRead: query.read,
      limit: query.limit,
      offset: query.offset,
    }),
    getUnreadCount(user.id),
  ])

  return NextResponse.json({ notifications, unreadCount, total })
})

/** POST /api/notifications — bulk actions on the current user's notifications. */
export const POST = withApiAuth(async (req: NextRequest, { user }) => {
  const { action } = await parseBody(req, notificationActionSchema)

  if (action === 'markAllRead') {
    await markAllNotificationsAsRead(user.id)
    return NextResponse.json({ success: true })
  }

  // Bulk deletes are irreversible, so they are audited (single deletes / mark-read are not — too noisy)
  const result = action === 'deleteAllRead' ? await deleteAllReadNotifications(user.id) : await deleteAllNotifications(user.id)
  if (result.count > 0) {
    await createAuditLog({ userId: user.id, action: 'DELETE', entityType: 'Notification', entityId: user.id, details: { action, deleted: result.count } })
  }
  return NextResponse.json({ success: true, deleted: result.count })
})
