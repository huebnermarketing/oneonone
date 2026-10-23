import { NextRequest, NextResponse } from 'next/server'
import { notFound, parseBody, withApiAuth } from '@/lib/api'
import { markNotificationAsRead, deleteNotification } from '@/lib/notifications'
import { notificationUpdateSchema } from '@/lib/validation/misc'

export const dynamic = 'force-dynamic'

/** PATCH /api/notifications/[id] — `{ isRead: true }` marks the notification read. 404 if it is not yours. */
export const PATCH = withApiAuth(async (req: NextRequest, { user, params }) => {
  const { isRead } = await parseBody(req, notificationUpdateSchema)

  if (isRead) {
    const { count } = await markNotificationAsRead(params.id, user.id)
    if (count === 0) throw notFound('Notification')
  }

  return NextResponse.json({ success: true })
})

/** DELETE /api/notifications/[id] — scoped to the owner; idempotent (already-gone rows still return success). */
export const DELETE = withApiAuth(async (_req: NextRequest, { user, params }) => {
  await deleteNotification(params.id, user.id)
  return NextResponse.json({ success: true })
})
