import { NextRequest, NextResponse } from 'next/server'
import { ADMIN, badRequest, parseBody, withApiAuth } from '@/lib/api'
import { getSettings, updateSettings, SystemSettings } from '@/lib/settings'
import { maskApiKey } from '@/lib/encryption'
import { logSettingsChanged } from '@/lib/audit'
import { buildClient, PROVIDERS } from '@/lib/ai'
import { settingsActionSchema, updateSettingsSchema } from '@/lib/validation/admin'

export const dynamic = 'force-dynamic'

const SECRET_KEYS: (keyof SystemSettings)[] = ['openaiApiKey', 'awsAccessKeyId', 'awsSecretKey']

function maskedView(s: SystemSettings) {
  return {
    // AI
    aiProvider: s.aiProvider,
    openaiApiKey: maskApiKey(s.openaiApiKey),
    openaiApiKeySet: !!s.openaiApiKey,
    openaiModel: s.openaiModel,
    aiFastModel: s.aiFastModel,
    whisperModel: s.whisperModel,
    // Storage
    awsRegion: s.awsRegion,
    awsAccessKeyId: maskApiKey(s.awsAccessKeyId),
    awsAccessKeyIdSet: !!s.awsAccessKeyId,
    awsSecretKey: maskApiKey(s.awsSecretKey),
    awsSecretKeySet: !!s.awsSecretKey,
    awsS3Bucket: s.awsS3Bucket,
    maxRecordingMins: s.maxRecordingMins,
    // Policies
    requireFormBeforeComplete: s.requireFormBeforeComplete,
    cancelPolicy: s.cancelPolicy,
    employeeCanViewRecording: s.employeeCanViewRecording,
    employeeCanViewNotes: s.employeeCanViewNotes,
    enableEmailReminders: s.enableEmailReminders,
    reminderHoursBefore: s.reminderHoursBefore,
    shortReminderHoursBefore: s.shortReminderHoursBefore,
    workingDays: s.workingDays,
  }
}

// GET - settings with secrets masked
export const GET = withApiAuth(ADMIN, async () => {
  return NextResponse.json(maskedView(await getSettings()))
})

// PUT - partial update. Empty string on a secret/optional field clears it; omitted fields are untouched.
export const PUT = withApiAuth(ADMIN, async (req: NextRequest, { user }) => {
  const body = await parseBody(req, updateSettingsSchema)

  const updates: Partial<SystemSettings> = {}
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue
    // nullable string fields: '' -> null
    ;(updates as Record<string, unknown>)[key] = value === '' ? null : value
  }
  if (Object.keys(updates).length === 0) throw badRequest('No settings provided')

  const settings = await updateSettings(updates)

  const safeChanges = Object.fromEntries(
    Object.entries(updates).map(([k, v]) => [k, SECRET_KEYS.includes(k as keyof SystemSettings) ? '***updated***' : v])
  )
  await logSettingsChanged(user.id, safeChanges)

  return NextResponse.json({ ...maskedView(settings), message: 'Settings updated successfully' })
})

// POST - connectivity tests
export const POST = withApiAuth(ADMIN, async (req: NextRequest) => {
  const { action } = await parseBody(req, settingsActionSchema)
  const settings = await getSettings()

  if (action === 'test-openai') {
    const label = PROVIDERS[settings.aiProvider].label
    if (!settings.openaiApiKey) throw badRequest(`${label} API key not configured`)
    const client = buildClient(settings.aiProvider, settings.openaiApiKey)
    try {
      // Cheapest authenticated call on both providers; also proves the chat model id resolves
      const res = await client.chat.completions.create({
        model: settings.aiProvider === 'OPENROUTER' && !settings.openaiModel.includes('/') ? `openai/${settings.openaiModel}` : settings.openaiModel,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        max_tokens: 5,
        temperature: 0,
      })
      const reply = res.choices[0]?.message?.content?.trim() || ''
      return NextResponse.json({ success: true, message: `${label} connection successful (${res.model || settings.openaiModel} replied "${reply.slice(0, 20)}")` })
    } catch (err: unknown) {
      throw badRequest(`${label} connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  // test-s3
  const { awsRegion: region, awsAccessKeyId: accessKeyId, awsSecretKey: secretAccessKey, awsS3Bucket: bucket } = settings
  if (!region || !accessKeyId || !secretAccessKey || !bucket) {
    throw badRequest('AWS S3 not fully configured. Please provide Region, Access Key, Secret Key, and Bucket Name.')
  }

  try {
    const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3')
    const s3Client = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } })
    await s3Client.send(new HeadBucketCommand({ Bucket: bucket }))
    return NextResponse.json({ success: true, message: `S3 connection successful! Bucket "${bucket}" is accessible.` })
  } catch (err: unknown) {
    const s3Error = err as { message?: string; name?: string; Code?: string; $metadata?: { httpStatusCode?: number } }
    let errorMessage = s3Error.message || 'Unknown error'
    if (s3Error.name === 'NotFound' || s3Error.$metadata?.httpStatusCode === 404) {
      errorMessage = `Bucket "${bucket}" not found. Please check the bucket name.`
    } else if (s3Error.name === 'InvalidAccessKeyId' || s3Error.Code === 'InvalidAccessKeyId') {
      errorMessage = 'Invalid Access Key ID. Please check your credentials.'
    } else if (s3Error.name === 'SignatureDoesNotMatch') {
      errorMessage = 'Invalid Secret Access Key. Please check your credentials.'
    } else if (s3Error.name === 'AccessDenied' || s3Error.$metadata?.httpStatusCode === 403) {
      errorMessage = `Access denied to bucket "${bucket}". Please check IAM permissions.`
    }
    throw badRequest(`S3 connection failed: ${errorMessage}`)
  }
})
