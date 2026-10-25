/**
 * At-rest encryption for secrets stored in SystemSettings (OpenAI key, AWS keys).
 *
 * Key material
 *   ENCRYPTION_SECRET            primary (dedicated to this purpose — set it in every environment)
 *   NEXTAUTH_SECRET              fallback for installs that predate ENCRYPTION_SECRET (logged once)
 *   ENCRYPTION_SECRET_PREVIOUS   optional; lets `decrypt` read values written under the old secret
 *                                while `npm run secrets:reencrypt` rewrites them
 *
 * Ciphertext formats
 *   v2:<iv>:<tag>:<data>   current — AES-256-GCM, key = HKDF-SHA256(secret, salt="ami-one-on-one", info="settings-v2")
 *   <iv>:<tag>:<data>      legacy  — AES-256-GCM, key = scrypt(secret, "salt") — read-only, rewritten by the script
 */
import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const V2_PREFIX = 'v2'
const HKDF_SALT = 'ami-one-on-one'
const HKDF_INFO = 'settings-v2'

let warnedFallback = false

function currentSecret(): string {
  const secret = process.env.ENCRYPTION_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('ENCRYPTION_SECRET (or NEXTAUTH_SECRET) must be set for encryption')
  if (!process.env.ENCRYPTION_SECRET && !warnedFallback) {
    warnedFallback = true
    console.warn('[encryption] ENCRYPTION_SECRET is not set; falling back to NEXTAUTH_SECRET. Set a dedicated ENCRYPTION_SECRET — see docs/ENV_VARIABLES.md.')
  }
  return secret
}

function v2Key(secret: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', secret, HKDF_SALT, HKDF_INFO, 32))
}

function legacyKey(secret: string): Buffer {
  return crypto.scryptSync(secret, 'salt', 32)
}

/** True when the value is one of our ciphertext formats (as opposed to a plaintext value stored before encryption applied). */
export function isEncrypted(value: string | null | undefined): boolean {
  if (!value) return false
  const parts = value.split(':')
  if (parts.length === 4 && parts[0] === V2_PREFIX) return parts.slice(1).every(isHex)
  if (parts.length === 3) return parts.every(isHex) && parts[0].length === IV_LENGTH * 2
  return false
}

/** True for the pre-v2 format, i.e. values that `npm run secrets:reencrypt` should rewrite. */
export function isLegacyCiphertext(value: string | null | undefined): boolean {
  return isEncrypted(value) && !value!.startsWith(`${V2_PREFIX}:`)
}

const isHex = (s: string) => s.length > 0 && /^[0-9a-f]+$/i.test(s)

export function encrypt(text: string): string {
  const key = v2Key(currentSecret())
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return [V2_PREFIX, iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(':')
}

function decryptWith(key: Buffer, ivHex: string, tagHex: string, dataHex: string): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
}

/**
 * Decrypt either format. For v2 the current secret is tried first, then ENCRYPTION_SECRET_PREVIOUS.
 * For legacy the current secret is tried, then NEXTAUTH_SECRET / ENCRYPTION_SECRET_PREVIOUS (whatever it was derived from).
 * Throws when nothing works — callers that can degrade should catch (see lib/settings.ts safeDecrypt).
 */
export function decrypt(encryptedText: string): string {
  if (!isEncrypted(encryptedText)) throw new Error('Invalid encrypted text format')
  const parts = encryptedText.split(':')
  const previous = process.env.ENCRYPTION_SECRET_PREVIOUS

  if (parts[0] === V2_PREFIX) {
    const [, iv, tag, data] = parts
    const candidates = [currentSecret(), previous].filter((s): s is string => !!s)
    return tryKeys(candidates.map(v2Key), iv, tag, data)
  }

  const [iv, tag, data] = parts
  // Legacy values were keyed from NEXTAUTH_SECRET first, ENCRYPTION_SECRET second (the old precedence).
  const candidates = [process.env.NEXTAUTH_SECRET, process.env.ENCRYPTION_SECRET, previous].filter((s): s is string => !!s)
  return tryKeys([...new Set(candidates)].map(legacyKey), iv, tag, data)
}

function tryKeys(keys: Buffer[], iv: string, tag: string, data: string): string {
  let lastError: unknown
  for (const key of keys) {
    try {
      return decryptWith(key, iv, tag, data)
    } catch (e) {
      lastError = e
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Unable to decrypt value')
}

export function maskApiKey(key: string | null | undefined): string {
  if (!key) return ''
  if (key.length <= 8) return '****'
  return key.substring(0, 4) + '****' + key.substring(key.length - 4)
}
