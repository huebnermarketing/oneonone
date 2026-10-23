import { z } from 'zod'
import { boolString, dayOfWeek, hhmm, meetingLink, meetingType, recurringFrequency, uuid } from './common'

export const createRecurringScheduleSchema = z
  .object({
    employeeId: uuid,
    frequency: recurringFrequency.default('BIWEEKLY'),
    dayOfWeek,
    timeOfDay: hhmm,
    meetingType: meetingType.default('IN_PERSON'),
    meetingLink: meetingLink.nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.meetingType === 'ZOOM' && !v.meetingLink) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['meetingLink'], message: 'Zoom meeting invite link is required when scheduling over Zoom.' })
    }
  })

export const updateRecurringScheduleSchema = z.object({
  frequency: recurringFrequency.optional(),
  dayOfWeek: dayOfWeek.optional(),
  timeOfDay: hhmm.optional(),
  isActive: z.boolean().optional(),
  cancelFutureMeetings: z.boolean().optional(),
  meetingType: meetingType.optional(),
  meetingLink: meetingLink.nullish(),
})

export const deleteRecurringQuery = z.object({
  cancelFutureMeetings: boolString.optional().default('true'),
})
