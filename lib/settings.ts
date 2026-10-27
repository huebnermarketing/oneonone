import { AiProvider, CancelPolicy } from '@prisma/client'
import { prisma } from './prisma'
import { encrypt, decrypt, isEncrypted, isLegacyCiphertext } from './encryption'

export interface SystemSettings {
  // AI (one key for the selected provider; a model per job)
  aiProvider: AiProvider
  openaiApiKey: string | null
  openaiModel: string
  aiFastModel: string
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
  /** Days meetings can be scheduled on, 0 = Sunday … 6 = Saturday (scheduler's timezone). */
  workingDays: number[]
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
  | 'workingDays'
>

export const DEFAULT_POLICIES: PolicySettings = {
  requireFormBeforeComplete: true,
  cancelPolicy: CancelPolicy.REPORTER_AND_ADMIN,
  employeeCanViewRecording: false,
  employeeCanViewNotes: true,
  enableEmailReminders: true,
  reminderHoursBefore: 24,
  shortReminderHoursBefore: 1,
  workingDays: [1, 2, 3, 4, 5],
}

// In-process cache (5 minutes). Cleared on every updateSettings().
let cachedSettings: SystemSettings | null = null
let cacheTimestamp = 0
const CACHE_TTL = 5 * 60 * 1000

/** Env-only API key for a provider (used when no key is saved in Admin → Settings). */
function envApiKey(provider: AiProvider): string | null {
  return (provider === 'OPENROUTER' ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY) || null
}

function envDefaults(provider?: AiProvider): SystemSettings {
  const envProvider: AiProvider = provider ?? ((process.env.AI_PROVIDER || '').toUpperCase() === 'OPENROUTER' ? 'OPENROUTER' : 'OPENAI')
  return {
    aiProvider: envProvider,
    openaiApiKey: envApiKey(envProvider),
    openaiModel: envProvider === 'OPENROUTER' ? 'openai/gpt-4o' : 'gpt-4o',
    aiFastModel: envProvider === 'OPENROUTER' ? 'openai/gpt-4o-mini' : 'gpt-4o-mini',
    whisperModel: envProvider === 'OPENROUTER' ? 'openai/gpt-4o-transcribe' : 'gpt-4o-transcribe',
    awsRegion: process.env.AWS_REGION || null,
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || null,
    awsSecretKey: process.env.AWS_SECRET_ACCESS_KEY || null,
    awsS3Bucket: process.env.AWS_S3_BUCKET || null,
    maxRecordingMins: 25,
    ...DEFAULT_POLICIES,
  }
}

let warnedLegacy = false

/**
 * Decrypt a stored secret. Plaintext values (stored before the field was encrypted) are passed through
 * so nothing is lost; legacy ciphertext triggers a one-time reminder to run `npm run secrets:reencrypt`.
 */
function safeDecrypt(field: string, value: string | null, fallback: string | null): string | null {
  if (!value) return fallback
  if (!isEncrypted(value)) return value
  if (isLegacyCiphertext(value) && !warnedLegacy) {
    warnedLegacy = true
    console.warn(`[settings] ${field} uses the legacy encryption format. Run: npm run secrets:reencrypt`)
  }
  try {
    return decrypt(value)
  } catch (err) {
    // The encryption secret changed after the value was stored and ENCRYPTION_SECRET_PREVIOUS is not set.
    console.error(`[settings] Cannot decrypt ${field} — set ENCRYPTION_SECRET_PREVIOUS to the old secret and run npm run secrets:reencrypt`, err)
    return fallback
  }
}

export async function getSettings(): Promise<SystemSettings> {
  if (cachedSettings && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedSettings
  }

  const row = await prisma.systemSettings.findUnique({ where: { id: 'system' } })
  // The saved provider decides which env key is the fallback (an OpenRouter key must never go to OpenAI)
  const defaults = envDefaults(row?.aiProvider)

  // Precedence: DB value wins over env, per field.
  const resolved: SystemSettings = row
    ? {
        openaiApiKey: safeDecrypt('openaiApiKey', row.openaiApiKey, defaults.openaiApiKey),
        aiProvider: row.aiProvider,
        openaiModel: row.openaiModel,
        aiFastModel: row.aiFastModel,
        whisperModel: row.whisperModel,
        awsRegion: row.awsRegion || defaults.awsRegion,
        awsAccessKeyId: safeDecrypt('awsAccessKeyId', row.awsAccessKeyId, defaults.awsAccessKeyId),
        awsSecretKey: safeDecrypt('awsSecretKey', row.awsSecretKey, defaults.awsSecretKey),
        awsS3Bucket: row.awsS3Bucket || defaults.awsS3Bucket,
        maxRecordingMins: row.maxRecordingMins,
        requireFormBeforeComplete: row.requireFormBeforeComplete,
        cancelPolicy: row.cancelPolicy,
        employeeCanViewRecording: row.employeeCanViewRecording,
        employeeCanViewNotes: row.employeeCanViewNotes,
        enableEmailReminders: row.enableEmailReminders,
        reminderHoursBefore: row.reminderHoursBefore,
        shortReminderHoursBefore: row.shortReminderHoursBefore,
        workingDays: row.workingDays?.length ? row.workingDays : DEFAULT_POLICIES.workingDays,
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
    workingDays: s.workingDays?.length ? s.workingDays : DEFAULT_POLICIES.workingDays,
  }
}

export const SECRET_FIELDS = new Set<keyof SystemSettings>(['openaiApiKey', 'awsAccessKeyId', 'awsSecretKey'])

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
