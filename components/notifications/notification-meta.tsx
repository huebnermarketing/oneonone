import type { NotificationType } from '@prisma/client'
import { AlertCircle, Bell, Calendar, CheckSquare, Clock, FileText, Mic, type LucideIcon } from 'lucide-react'

export interface NotificationMeta {
  icon: LucideIcon
  /** Text + background colour classes for the icon tile / type chip */
  tone: string
  /** Short chip label */
  label: string
  /** Longer label for filter dropdowns */
  filterLabel: string
}

/** Icon, colour and label for every NotificationType. Shared by the bell dropdown and the /notifications page. */
export const NOTIFICATION_META: Record<NotificationType, NotificationMeta> = {
  MEETING_REMINDER: { icon: Clock, tone: 'text-blue-500 bg-blue-500/10', label: 'Reminder', filterLabel: 'Meeting Reminders' },
  MEETING_SCHEDULED: { icon: Calendar, tone: 'text-green-500 bg-green-500/10', label: 'Scheduled', filterLabel: 'Meeting Scheduled' },
  MEETING_CANCELLED: { icon: Calendar, tone: 'text-red-500 bg-red-500/10', label: 'Cancelled', filterLabel: 'Meeting Cancelled' },
  TODO_ASSIGNED: { icon: CheckSquare, tone: 'text-purple-500 bg-purple-500/10', label: 'Task', filterLabel: 'Task Assigned' },
  TODO_DUE_SOON: { icon: CheckSquare, tone: 'text-amber-500 bg-amber-500/10', label: 'Due Soon', filterLabel: 'Task Due Soon' },
  TODO_OVERDUE: { icon: AlertCircle, tone: 'text-red-500 bg-red-500/10', label: 'Overdue', filterLabel: 'Task Overdue' },
  FORM_SUBMITTED: { icon: FileText, tone: 'text-teal-500 bg-teal-500/10', label: 'Form', filterLabel: 'Form Submitted' },
  FORM_REMINDER: { icon: FileText, tone: 'text-amber-500 bg-amber-500/10', label: 'Form Reminder', filterLabel: 'Form Reminders' },
  RECORDING_READY: { icon: Mic, tone: 'text-pink-500 bg-pink-500/10', label: 'Recording', filterLabel: 'Recording Ready' },
  SYSTEM: { icon: Bell, tone: 'text-gray-500 bg-gray-500/10', label: 'System', filterLabel: 'System' },
}

const FALLBACK: NotificationMeta = { icon: Bell, tone: 'text-gray-500 bg-gray-500/10', label: 'Notification', filterLabel: 'Other' }

/** Meta for a type string coming off the wire; unknown types fall back to a neutral bell. */
export function notificationMeta(type: string): NotificationMeta {
  return NOTIFICATION_META[type as NotificationType] ?? { ...FALLBACK, label: type || FALLBACK.label }
}

/** Ordered list for filter dropdowns */
export const NOTIFICATION_TYPE_OPTIONS = (Object.keys(NOTIFICATION_META) as NotificationType[]).map((value) => ({
  value,
  label: NOTIFICATION_META[value].filterLabel,
}))
