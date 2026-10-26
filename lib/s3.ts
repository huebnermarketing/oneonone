import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getSettings } from './settings'
import fs from 'fs/promises'
import path from 'path'

// Local storage directory (kept for admin stats display)
const LOCAL_STORAGE_DIR = path.join(process.cwd(), 'uploads', 'recordings')

// ---------------------------------------------------------------------------
// S3 Configuration
// ---------------------------------------------------------------------------

export async function isS3Configured(): Promise<boolean> {
  const settings = await getSettings()
  const accessKeyId = settings.awsAccessKeyId || process.env.AWS_ACCESS_KEY_ID || ''
  const secretAccessKey = settings.awsSecretKey || process.env.AWS_SECRET_ACCESS_KEY || ''
  const bucket = settings.awsS3Bucket || process.env.AWS_S3_BUCKET || ''
  const region = settings.awsRegion || process.env.AWS_REGION || ''

  const isConfigured = !!(
    accessKeyId &&
    accessKeyId.length > 10 &&
    secretAccessKey &&
    secretAccessKey.length > 10 &&
    bucket &&
    bucket.length > 3 &&
    region
  )

  return isConfigured
}

async function getS3Client(): Promise<{ client: S3Client; bucket: string; region: string }> {
  const settings = await getSettings()

  const region = settings.awsRegion || process.env.AWS_REGION || 'us-east-1'
  const accessKeyId = settings.awsAccessKeyId || process.env.AWS_ACCESS_KEY_ID || ''
  const secretAccessKey = settings.awsSecretKey || process.env.AWS_SECRET_ACCESS_KEY || ''
  const bucket = settings.awsS3Bucket || process.env.AWS_S3_BUCKET || 'ami-one-on-one-recordings'

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS credentials not configured')
  }

  const client = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  })

  return { client, bucket, region }
}

// ---------------------------------------------------------------------------
// S3 Operations
// ---------------------------------------------------------------------------

export async function uploadToS3(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<{ url: string; key: string }> {
  const { client, bucket, region } = await getS3Client()

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  )

  const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`
  return { url, key }
}

export async function getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
  const { client, bucket } = await getS3Client()
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn })
}

export async function getSignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 3600
): Promise<{ uploadUrl: string; key: string }> {
  const { client, bucket } = await getS3Client()
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType })
  const uploadUrl = await getSignedUrl(client, command, { expiresIn })
  return { uploadUrl, key }
}

export async function deleteFromS3(key: string): Promise<void> {
  const { client, bucket } = await getS3Client()
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}

/** Delete all S3 objects under a given prefix (e.g. a recording session folder). */
export async function deleteS3Prefix(prefix: string): Promise<number> {
  const { client, bucket } = await getS3Client()

  let deleted = 0
  let continuationToken: string | undefined

  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    )

    if (list.Contents) {
      for (const obj of list.Contents) {
        if (obj.Key) {
          await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }))
          deleted++
        }
      }
    }

    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined
  } while (continuationToken)

  return deleted
}

/** Download an S3 object and return its bytes as a Buffer. */
export async function downloadFromS3(key: string): Promise<Buffer> {
  const { client, bucket } = await getS3Client()

  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))

  if (!response.Body) {
    throw new Error(`S3 object is empty: ${key}`)
  }

  // response.Body is a Readable stream in Node.js
  const chunks: Uint8Array[] = []
  const stream = response.Body as AsyncIterable<Uint8Array>
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  return Buffer.concat(chunks)
}

// ---------------------------------------------------------------------------
// Recording key helpers
// ---------------------------------------------------------------------------

/** Generate a session prefix for chunked recording uploads. */
export function generateSessionKey(meetingId: string): string {
  const timestamp = Date.now()
  return `recordings/${meetingId}/${timestamp}`
}

/** Build the S3 key for a specific chunk within a session. */
export function chunkKey(sessionPrefix: string, sequence: number): string {
  return `${sessionPrefix}/chunk_${String(sequence).padStart(4, '0')}.webm`
}

/** Build the S3 key for the final combined recording. */
export function finalRecordingKey(sessionPrefix: string): string {
  return `${sessionPrefix}/final.webm`
}

// Kept for backward compatibility with generateRecordingKey calls
export function generateRecordingKey(meetingId: string): string {
  return generateSessionKey(meetingId)
}

// ---------------------------------------------------------------------------
// Local storage helpers (kept for admin storage stats)
// ---------------------------------------------------------------------------

async function ensureLocalStorageDir(): Promise<void> {
  try {
    await fs.mkdir(LOCAL_STORAGE_DIR, { recursive: true })
  } catch {
    // already exists
  }
}

export async function saveToLocalStorage(buffer: Buffer, key: string): Promise<string> {
  await ensureLocalStorageDir()
  const filePath = path.join(LOCAL_STORAGE_DIR, key.replace(/\//g, '_'))
  await fs.writeFile(filePath, buffer)
  return filePath
}

export async function readFromLocalStorage(key: string): Promise<Buffer> {
  const filePath = path.join(LOCAL_STORAGE_DIR, key.replace(/\//g, '_'))
  return fs.readFile(filePath)
}

export async function deleteFromLocalStorage(key: string): Promise<void> {
  try {
    const filePath = path.join(LOCAL_STORAGE_DIR, key.replace(/\//g, '_'))
    await fs.unlink(filePath)
  } catch {
    // File might not exist
  }
}

export function getLocalStorageDir(): string {
  return LOCAL_STORAGE_DIR
}

export async function getLocalStorageStats(): Promise<{ fileCount: number; totalBytes: number }> {
  try {
    await ensureLocalStorageDir()
    const names = await fs.readdir(LOCAL_STORAGE_DIR)
    let totalBytes = 0
    for (const name of names) {
      const filePath = path.join(LOCAL_STORAGE_DIR, name)
      const stat = await fs.stat(filePath)
      if (stat.isFile()) totalBytes += stat.size
    }
    return { fileCount: names.length, totalBytes }
  } catch {
    return { fileCount: 0, totalBytes: 0 }
  }
}
