import { z } from 'zod'
import { NotificationType } from '@prisma/client'
import { boolString, dateOnly, pagination, uuid } from './common'

export const notificationsQuery = pagination(50, 200).extend({
  type: z.nativeEnum(NotificationType).optional(),
  read: boolString.optional(),
  countOnly: boolString.optional(),
})

export const notificationActionSchema = z.object({
  action: z.enum(['markAllRead', 'deleteAllRead', 'deleteAll']),
})

export const notificationUpdateSchema = z.object({
  isRead: z.boolean(),
})

export const reportsQuery = z.object({
  departmentId: uuid.optional(),
  startDate: dateOnly.optional(),
  endDate: dateOnly.optional(),
  format: z.enum(['json', 'csv']).optional(),
})

export const recordingsSearchQuery = z.object({
  q: z.string().trim().min(1).max(500),
  departmentId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const recordingsAnalyzeSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  departmentId: uuid.nullish(),
})

export const recordingsInsightsQuery = z.object({
  departmentId: uuid.optional(),
  period: z.coerce.number().int().min(1).max(365).default(30),
})

export const testLoginSchema = z.object({
  role: z.enum(['EMPLOYEE', 'REPORTER', 'SUPER_ADMIN']),
})
