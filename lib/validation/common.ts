import '@/lib/zod-messages'
import { z } from 'zod'
import { MeetingType, RecurringFrequency, TodoPriority, TodoStatus, UserRole } from '@prisma/client'

export const uuid = z.string().uuid()

/** Accepts ISO strings (and anything `new Date()` parses) and yields a valid Date. */
export const isoDate = z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), 'Invalid date')

/** Calendar date without time, e.g. 2026-10-23 */
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

/** 24h clock, e.g. 09:30 */
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm')

export const dayOfWeek = z.coerce.number().int().min(0).max(6)

export const trimmedString = (max = 500) => z.string().trim().min(1).max(max)
export const optionalText = (max = 10000) => z.string().trim().max(max).nullish()

export const userRole = z.nativeEnum(UserRole)
export const meetingType = z.nativeEnum(MeetingType)
export const todoStatus = z.nativeEnum(TodoStatus)
export const todoPriority = z.nativeEnum(TodoPriority)
export const recurringFrequency = z.nativeEnum(RecurringFrequency)

/** Standard limit/offset query params with sane bounds. */
export const pagination = (defaultLimit = 50, maxLimit = 200) =>
  z.object({
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
    offset: z.coerce.number().int().min(0).default(0),
  })

/** "true"/"false"/"1"/"0" query flags */
export const boolString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')

/** Zoom link must be a URL. Kept permissive on host so other video links are not rejected outright. */
export const meetingLink = z.string().trim().url().max(2000)
