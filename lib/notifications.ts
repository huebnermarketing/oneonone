import { prisma } from './prisma'
import { NotificationType, Prisma } from '@prisma/client'
import { formatDateOnly, formatMeetingShort, resolveTimeZone, timeZoneAbbrev } from './dates'

interface CreateNotificationParams {
  userId: string
  type: NotificationType
  title: string
  message: string
  link?: string
  data?: Prisma.InputJsonValue
}

/** In-app notification text is stored, so dates are rendered once — in the RECIPIENT's timezone. */
async function userTimeZone(userId: string): Promise<string> {
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } })
    return resolveTimeZone(u?.timeZone)
  } catch {
    return resolveTimeZone(null)
  }
}

/** "Wed, Feb 18, 11:30 AM IST" for the recipient. */
async function whenFor(userId: string, date: Date): Promise<string> {
  const tz = await userTimeZone(userId)
  return `${formatMeetingShort(date, tz)} ${timeZoneAbbrev(date, tz)}`
}

export async function createNotification(params: CreateNotificationParams) {
  return prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      message: params.message,
      link: params.link,
      data: params.data,
    },
  })
}

export async function createNotificationForUsers(
  userIds: string[],
  params: Omit<CreateNotificationParams, 'userId'>
) {
  return prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type: params.type,
      title: params.title,
      message: params.message,
      link: params.link,
      data: params.data,
    })),
  })
}

export async function getUnreadNotifications(userId: string) {
  return prisma.notification.findMany({
    where: {
      userId,
      isRead: false,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
}

export async function getAllNotifications(userId: string, limit = 50) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

export async function markNotificationAsRead(notificationId: string, userId: string) {
  return prisma.notification.updateMany({
    where: {
      id: notificationId,
      userId,
    },
    data: { isRead: true },
  })
}

export async function markAllNotificationsAsRead(userId: string) {
  return prisma.notification.updateMany({
    where: {
      userId,
      isRead: false,
    },
    data: { isRead: true },
  })
}

export async function getUnreadCount(userId: string) {
  return prisma.notification.count({
    where: {
      userId,
      isRead: false,
    },
  })
}

export async function getFilteredNotifications(
  userId: string,
  options: {
    type?: string
    isRead?: boolean
    limit?: number
    offset?: number
  } = {}
) {
  const where: Prisma.NotificationWhereInput = { userId }
  if (options.type) where.type = options.type as NotificationType
  if (options.isRead !== undefined) where.isRead = options.isRead

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options.limit || 50,
      skip: options.offset || 0,
    }),
    prisma.notification.count({ where }),
  ])

  return { notifications, total }
}

export async function deleteNotification(notificationId: string, userId: string) {
  return prisma.notification.deleteMany({
    where: {
      id: notificationId,
      userId,
    },
  })
}

export async function deleteAllReadNotifications(userId: string) {
  return prisma.notification.deleteMany({
    where: {
      userId,
      isRead: true,
    },
  })
}

export async function deleteAllNotifications(userId: string) {
  return prisma.notification.deleteMany({
    where: { userId },
  })
}

// Helper functions for common notification types
export async function notifyMeetingReminder(
  userId: string,
  otherPersonName: string,
  meetingDate: Date,
  meetingId: string,
  hoursUntil: number
) {
  return createNotification({
    userId,
    type: 'MEETING_REMINDER',
    title: 'Meeting Reminder',
    message: `Your one-on-one with ${otherPersonName} is in ${hoursUntil} hours`,
    link: `/meetings/${meetingId}`,
  })
}

export async function notifyTodoAssigned(
  userId: string,
  creatorName: string,
  todoTitle: string,
  todoId: string
) {
  return createNotification({
    userId,
    type: 'TODO_ASSIGNED',
    title: 'New Task Assigned',
    message: `${creatorName} assigned you a task: "${todoTitle}"`,
    link: `/todos`,
  })
}

export async function notifyFormSubmitted(
  reporterId: string,
  employeeName: string,
  meetingId: string
) {
  return createNotification({
    userId: reporterId,
    type: 'FORM_SUBMITTED',
    title: 'Form Submitted',
    message: `${employeeName} has submitted their one-on-one form`,
    link: `/meetings/${meetingId}`,
  })
}

export async function notifyRecordingReady(
  userIds: string[],
  meetingId: string
) {
  return createNotificationForUsers(userIds, {
    type: 'RECORDING_READY',
    title: 'Recording Ready',
    message: 'Meeting recording has been processed and is ready to view',
    link: `/meetings/${meetingId}`,
  })
}

export async function notifyMeetingCancelled(
  userId: string,
  cancelledByName: string,
  meetingDate: Date,
  meetingId: string
) {
  return createNotification({
    userId,
    type: 'MEETING_CANCELLED',
    title: 'Meeting Cancelled',
    message: `${cancelledByName} cancelled the one-on-one meeting scheduled for ${await whenFor(userId, meetingDate)}`,
    link: `/meetings/${meetingId}`,
  })
}

export async function notifyMeetingCompleted(
  employeeId: string,
  reporterName: string,
  meetingId: string
) {
  return createNotification({
    userId: employeeId,
    type: 'MEETING_COMPLETED',
    title: 'Meeting Completed',
    message: `${reporterName} has marked your one-on-one meeting as completed`,
    link: `/meetings/${meetingId}`,
  })
}

export async function notifyTodoDueSoon(
  userId: string,
  todoTitle: string,
  dueDate: Date
) {
  return createNotification({
    userId,
    type: 'TODO_DUE_SOON',
    title: 'Task Due Soon',
    message: `Your task "${todoTitle}" is due on ${formatDateOnly(dueDate)}`,
    link: `/todos`,
  })
}

export async function notifyTodoOverdue(
  userId: string,
  todoTitle: string
) {
  return createNotification({
    userId,
    type: 'TODO_OVERDUE',
    title: 'Task Overdue',
    message: `Your task "${todoTitle}" is past its due date`,
    link: `/todos`,
  })
}

export async function notifyFormReminder(
  employeeId: string,
  reporterName: string,
  meetingDate: Date,
  meetingId: string
) {
  return createNotification({
    userId: employeeId,
    type: 'FORM_REMINDER',
    title: 'Form Reminder',
    message: `Your meeting with ${reporterName} is tomorrow. Please submit your check-in form before the meeting.`,
    link: `/meetings/${meetingId}/form`,
  })
}

// ── Proposal-based scheduling notifications ─────────────────────────

export async function notifyMeetingProposed(
  employeeId: string,
  reporterName: string,
  meetingDate: Date,
  meetingId: string
) {
  return createNotification({
    userId: employeeId,
    type: 'MEETING_PROPOSED',
    title: 'Meeting Request',
    message: `${reporterName} proposed a one-on-one for ${await whenFor(employeeId, meetingDate)}. Accept or suggest a new time.`,
    link: `/meetings/${meetingId}`,
  })
}

export async function notifyMeetingAccepted(
  proposerId: string,
  acceptorName: string,
  meetingDate: Date,
  meetingId: string
) {
  return createNotification({
    userId: proposerId,
    type: 'MEETING_ACCEPTED',
    title: 'Meeting Confirmed',
    message: `${acceptorName} accepted the one-on-one for ${await whenFor(proposerId, meetingDate)}.`,
    link: `/meetings/${meetingId}`,
  })
}

export async function notifyMeetingSuggested(
  recipientId: string,
  suggestorName: string,
  newDate: Date,
  meetingId: string
) {
  return createNotification({
    userId: recipientId,
    type: 'MEETING_TIME_SUGGESTED',
    title: 'New Time Suggested',
    message: `${suggestorName} suggested a new time for the one-on-one: ${await whenFor(recipientId, newDate)}. Accept or suggest another time.`,
    link: `/meetings/${meetingId}`,
  })
}

// ── Reschedule of a scheduled meeting ───────────────────────────────

export async function notifyRescheduleRequested(recipientId: string, requesterName: string, newDate: Date, meetingId: string) {
  return createNotification({
    userId: recipientId,
    type: 'RESCHEDULE_REQUESTED',
    title: 'Reschedule Request',
    message: `${requesterName} asked to move your one-on-one to ${await whenFor(recipientId, newDate)}. Accept or decline.`,
    link: `/meetings/${meetingId}`,
  })
}

export async function notifyRescheduleAccepted(recipientId: string, acceptorName: string, newDate: Date, meetingId: string) {
  return createNotification({
    userId: recipientId,
    type: 'RESCHEDULE_ACCEPTED',
    title: 'Meeting Rescheduled',
    message: `${acceptorName} accepted. Your one-on-one is now ${await whenFor(recipientId, newDate)}.`,
    link: `/meetings/${meetingId}`,
  })
}

/** `withdrawn`: the requester took the request back (tell the other side); otherwise it was declined (tell the requester). */
export async function notifyRescheduleDeclined(recipientId: string, actorName: string, keptDate: Date, meetingId: string, withdrawn: boolean) {
  const when = await whenFor(recipientId, keptDate)
  return createNotification({
    userId: recipientId,
    type: 'RESCHEDULE_DECLINED',
    title: withdrawn ? 'Reschedule Withdrawn' : 'Reschedule Declined',
    message: withdrawn
      ? `${actorName} withdrew the reschedule request. The meeting stays at ${when}.`
      : `${actorName} declined the new time. The meeting stays at ${when}.`,
    link: `/meetings/${meetingId}`,
  })
}
