import { CancelPolicy } from '@prisma/client'
import { prisma } from './prisma'
import { encrypt, decrypt } from './encryption'

export interface SystemSettings {
  // AI
  openaiApiKey: string | null
  openaiModel: string
  whisperModel: string
  // Storage
  awsRegion: string | null
  awsAccessKeyId: string | null
  awsSecretKey: string | null
  awsS3Bucket: string | null
  maxRecordingMins: number
  // Policies (Admin -> Settings -> Policies)
  /** Meeting cannot be marked Completed until the employee submitted the check-in form. */
  requireFormBeforeComplete: boolean
  /** Who may cancel a single PROPOSED/SCHEDULED meeting. SUPER_ADMIN always can. */
  cancelPolicy: CancelPolicy
  /** Employee can open their own meeting's recording, transcript and AI analysis. */
  employeeCanViewRecording: boolean
  /** Employee can read the reporter's free-text meeting notes. */
  employeeCanViewNotes: boolean
  /** Master switch for reminder emails (in-app reminders are always created). */
  enableEmailReminders: boolean
  /** First reminder, hours before the meeting (email + in-app). */
  reminderHoursBefore: number
  /** Second, short-notice reminder (in-app only). 0 disables it. */
  shortReminderHoursBefore: number
}

export type PolicySettings = Pick<
  SystemSettings,
  | 'requireFormBeforeComplete'
  | 'cancelPolicy'
  | 'employeeCanViewRecording'
  | 'employeeCanViewNotes'
  | 'enableEmailReminders'
  | 'reminderHoursBefore'
  | 'shortReminderHoursBefore'
>

export const DEFAULT_POLICIES: PolicySettings = {
  requireFormBeforeComplete: true,
  cancelPolicy: CancelPolicy.REPORTER_AND_ADMIN,
  employeeCanViewRecording: false,
  employeeCanViewNotes: true,
  enableEmailReminders: true,
  reminderHoursBefore: 24,
  shortReminderHoursBefore: 1,
}

// In-process cache (5 minutes). Cleared on every updateSettings().
let cachedSettings: SystemSettings | null = null
let cacheTimestamp = 0
const CACHE_TTL = 5 * 60 * 1000

function envDefaults(): SystemSettings {
  return {
    openaiApiKey: process.env.OPENAI_API_KEY || null,
    openaiModel: 'gpt-4o',
    whisperModel: 'whisper-1',
    awsRegion: process.env.AWS_REGION || null,
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || null,
    awsSecretKey: process.env.AWS_SECRET_ACCESS_KEY || null,
    awsS3Bucket: process.env.AWS_S3_BUCKET || null,
    maxRecordingMins: 25,
    ...DEFAULT_POLICIES,
  }
}

function safeDecrypt(value: string | null, fallback: string | null): string | null {
  if (!value) return fallback
  try {
    return decrypt(value)
  } catch (err) {
    // Happens when NEXTAUTH_SECRET/ENCRYPTION_SECRET changed after the value was stored.
    console.error('[settings] Failed to decrypt a stored secret — was the encryption secret rotated?', err)
    return fallback
  }
}

export async function getSettings(): Promise<SystemSettings> {
  if (cachedSettings && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedSettings
  }

  const row = await prisma.systemSettings.findUnique({ where: { id: 'system' } })
  const defaults = envDefaults()

  // Precedence: DB value wins over env, per field.
  const resolved: SystemSettings = row
    ? {
        openaiApiKey: safeDecrypt(row.openaiApiKey, defaults.openaiApiKey),
        openaiModel: row.openaiModel,
        whisperModel: row.whisperModel,
        awsRegion: row.awsRegion || defaults.awsRegion,
        awsAccessKeyId: row.awsAccessKeyId || defaults.awsAccessKeyId,
        awsSecretKey: safeDecrypt(row.awsSecretKey, defaults.awsSecretKey),
        awsS3Bucket: row.awsS3Bucket || defaults.awsS3Bucket,
        maxRecordingMins: row.maxRecordingMins,
        requireFormBeforeComplete: row.requireFormBeforeComplete,
        cancelPolicy: row.cancelPolicy,
        employeeCanViewRecording: row.employeeCanViewRecording,
        employeeCanViewNotes: row.employeeCanViewNotes,
        enableEmailReminders: row.enableEmailReminders,
        reminderHoursBefore: row.reminderHoursBefore,
        shortReminderHoursBefore: row.shortReminderHoursBefore,
      }
    : defaults

  cachedSettings = resolved
  cacheTimestamp = Date.now()
  return resolved
}

/** Convenience for the many call sites that only care about policies. */
export async function getPolicies(): Promise<PolicySettings> {
  const s = await getSettings()
  return {
    requireFormBeforeComplete: s.requireFormBeforeComplete,
    cancelPolicy: s.cancelPolicy,
    employeeCanViewRecording: s.employeeCanViewRecording,
    employeeCanViewNotes: s.employeeCanViewNotes,
    enableEmailReminders: s.enableEmailReminders,
    reminderHoursBefore: s.reminderHoursBefore,
    shortReminderHoursBefore: s.shortReminderHoursBefore,
  }
}

const SECRET_FIELDS = new Set<keyof SystemSettings>(['openaiApiKey', 'awsSecretKey'])

export async function updateSettings(updates: Partial<SystemSettings>): Promise<SystemSettings> {
  const data: Record<string, string | number | boolean | null> = {}

  for (const [key, value] of Object.entries(updates) as [keyof SystemSettings, SystemSettings[keyof SystemSettings]][]) {
    if (value === undefined) continue
    if (SECRET_FIELDS.has(key)) {
      data[key] = value ? encrypt(String(value)) : null
    } else {
      data[key] = value as string | number | boolean | null
    }
  }

  await prisma.systemSettings.upsert({
    where: { id: 'system' },
    create: { id: 'system', ...data },
    update: data,
  })

  clearSettingsCache()
  return getSettings()
}

export function clearSettingsCache(): void {
  cachedSettings = null
  cacheTimestamp = 0
}
