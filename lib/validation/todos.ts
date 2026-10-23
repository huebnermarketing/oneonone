import { z } from 'zod'
import { isoDate, optionalText, todoPriority, todoStatus, trimmedString, uuid } from './common'

export const createTodoSchema = z.object({
  title: trimmedString(200),
  description: optionalText(5000),
  assignedToId: uuid,
  meetingId: uuid.nullish(),
  dueDate: isoDate.nullish(),
  priority: todoPriority.default('MEDIUM'),
})

export const updateTodoSchema = z.object({
  title: trimmedString(200).optional(),
  description: optionalText(5000),
  status: todoStatus.optional(),
  priority: todoPriority.optional(),
  dueDate: isoDate.nullish(),
})
