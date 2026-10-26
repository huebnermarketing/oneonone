import { z } from 'zod'
import { AiProvider, AuditAction, BackupType, CancelPolicy } from '@prisma/client'
import { isoDate, pagination, uuid } from './common'

export const auditLogsQuery = pagination(50, 200).extend({
  userId: uuid.optional(),
  action: z.nativeEnum(AuditAction).optional(),
  entityType: z.string().trim().max(50).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
})

export const createBackupSchema = z.object({
  type: z.nativeEnum(BackupType).default('FULL'),
})

export const restoreSchema = z.object({
  data: z.object({
    version: z.string(),
    data: z.object({
      departments: z.array(z.record(z.string(), z.unknown())).optional().default([]),
      users: z.array(z.record(z.string(), z.unknown())).optional().default([]),
      meetings: z.array(z.record(z.string(), z.unknown())).optional().default([]),
    }),
  }),
  options: z
    .object({
      clearExisting: z.boolean().default(false),
      restoreUsers: z.boolean().default(true),
      restoreMeetings: z.boolean().default(true),
    })
    // v4: .default() returns the value as-is (inner defaults would be skipped); .prefault() parses it
    .prefault({}),
})

export const clearDataSchema = z.object({
  clearType: z.enum(['all', 'recordings', 'todos', 'meetings', 'users', 'departments']),
  keepCurrentUser: z.boolean().default(true),
  /** Must equal the clearType to prove intent (UI asks the admin to type it). */
  confirm: z.string(),
}).refine((v) => v.confirm === v.clearType, { path: ['confirm'], message: 'Type the data set name to confirm' })

const nullableString = (max: number) => z.string().trim().max(max).nullish()

export const updateSettingsSchema = z.object({
  // AI
  aiProvider: z.nativeEnum(AiProvider).optional(),
  openaiApiKey: nullableString(300),
  openaiModel: z.string().trim().min(1).max(100).optional(),
  aiFastModel: z.string().trim().min(1).max(100).optional(),
  whisperModel: z.string().trim().min(1).max(100).optional(),
  // Storage
  awsRegion: nullableString(40),
  awsAccessKeyId: nullableString(128),
  awsSecretKey: nullableString(128),
  awsS3Bucket: nullableString(63),
  maxRecordingMins: z.coerce.number().int().min(1).max(180).optional(),
  // Policies
  requireFormBeforeComplete: z.boolean().optional(),
  cancelPolicy: z.nativeEnum(CancelPolicy).optional(),
  employeeCanViewRecording: z.boolean().optional(),
  employeeCanViewNotes: z.boolean().optional(),
  enableEmailReminders: z.boolean().optional(),
  reminderHoursBefore: z.coerce.number().int().min(1).max(168).optional(),
  shortReminderHoursBefore: z.coerce.number().int().min(0).max(48).optional(),
})

export const settingsActionSchema = z.object({
  action: z.enum(['test-openai', 'test-s3']),
})
