import { z } from 'zod'
import { dateOnly, isoDate, meetingLink, meetingType, optionalText, recurringFrequency, dayOfWeek, hhmm, uuid } from './common'

const zoomLinkRule = <T extends { meetingType?: 'IN_PERSON' | 'ZOOM' | null; meetingLink?: string | null }>(v: T, ctx: z.RefinementCtx) => {
  if (v.meetingType === 'ZOOM' && !v.meetingLink) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['meetingLink'], message: 'Zoom meeting invite link is required when scheduling over Zoom.' })
  }
}

export const listMeetingsQuery = z.object({
  start: isoDate.optional(),
  end: isoDate.optional(),
})

export const createMeetingSchema = z
  .object({
    employeeId: uuid,
    meetingDate: isoDate,
    meetingType: meetingType.default('IN_PERSON'),
    meetingLink: meetingLink.nullish(),
  })
  .superRefine(zoomLinkRule)

export const updateMeetingSchema = z
  .object({
    meetingDate: isoDate.optional(),
    status: z.enum(['SCHEDULED', 'COMPLETED']).optional(),
    meetingType: meetingType.optional(),
    meetingLink: meetingLink.nullish(),
  })
  .superRefine(zoomLinkRule)

export const suggestMeetingSchema = z.object({
  meetingDate: isoDate,
})

export const cancelMeetingSchema = z.object({
  reason: z.string().trim().max(500).optional(),
})

export const meetingNotesSchema = z.object({
  notes: z.string().max(50000).nullable(),
})

export const meetingFormSchema = z.object({
  draft: z.boolean().optional().default(false),
  checkInPersonal: optionalText(),
  checkInProfessional: optionalText(),
  priorityGoalProfessional: optionalText(),
  priorityGoalAgency: optionalText(),
  progressReport: optionalText(),
  goodNews: optionalText(),
  supportNeeded: optionalText(),
  priorityDiscussions: optionalText(),
  headsUp: optionalText(),
  anythingElse: optionalText(),
})

export const attachmentQuery = z.object({ attachmentId: uuid.optional() })
export const attachmentDeleteQuery = z.object({ attachmentId: uuid })

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const createAttachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileType: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive().max(MAX_ATTACHMENT_BYTES, 'File must be 10 MB or smaller'),
})

export const availabilityDateQuery = z.object({ date: dateOnly })

export const availabilityQuery = z.object({
  employeeId: uuid,
  date: dateOnly.optional(),
})

export const recurringAvailabilityQuery = z.object({
  employeeId: uuid,
  dayOfWeek,
  timeOfDay: hhmm,
  frequency: recurringFrequency.default('BIWEEKLY'),
})

export const processRecordingSchema = z.object({
  totalChunks: z.number().int().min(1).max(10000),
  duration: z.number().int().min(0).max(24 * 60 * 60).optional().default(0),
  language: z.string().trim().min(2).max(10).optional(),
})
