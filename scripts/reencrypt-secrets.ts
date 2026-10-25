/**
 * Re-encrypt secrets stored in SystemSettings with the current ENCRYPTION_SECRET (v2 format).
 *
 *   npm run secrets:reencrypt            # dry-run report + rewrite
 *   npm run secrets:reencrypt -- --check # report only, exit 1 if anything needs rewriting
 *
 * Handles: legacy scrypt ciphertext (pre-ENCRYPTION_SECRET), plaintext awsAccessKeyId (stored before it was
 * encrypted), and key rotation (set ENCRYPTION_SECRET to the new value and ENCRYPTION_SECRET_PREVIOUS to the old one).
 * Idempotent: values already in v2 format under the current secret are left untouched.
 */
import { PrismaClient } from '@prisma/client'
import { decrypt, encrypt, isEncrypted, isLegacyCiphertext } from '../lib/encryption'

const FIELDS = ['openaiApiKey', 'awsAccessKeyId', 'awsSecretKey'] as const
type Field = (typeof FIELDS)[number]

async function main() {
  const checkOnly = process.argv.includes('--check')
  if (!process.env.ENCRYPTION_SECRET) {
    console.error('ENCRYPTION_SECRET is not set. Add it to .env first (openssl rand -base64 32), restart the app, then run this again.')
    process.exit(2)
  }

  const prisma = new PrismaClient()
  try {
    const row = await prisma.systemSettings.findUnique({ where: { id: 'system' } })
    if (!row) {
      console.log('No SystemSettings row — nothing to re-encrypt.')
      return
    }

    const updates: Partial<Record<Field, string>> = {}
    for (const field of FIELDS) {
      const value = row[field]
      if (!value) {
        console.log(`${field}: empty`)
        continue
      }
      if (!isEncrypted(value)) {
        console.log(`${field}: PLAINTEXT → will encrypt`)
        updates[field] = encrypt(value)
        continue
      }
      let plain: string
      try {
        plain = decrypt(value)
      } catch (e) {
        console.error(`${field}: cannot decrypt with ENCRYPTION_SECRET / ENCRYPTION_SECRET_PREVIOUS / NEXTAUTH_SECRET. Re-enter it in Admin → Settings.`, e)
        process.exitCode = 1
        continue
      }
      if (isLegacyCiphertext(value)) {
        console.log(`${field}: legacy format → will rewrite as v2`)
        updates[field] = encrypt(plain)
        continue
      }
      // v2 — rewrite only if it was decrypted via the previous secret (i.e. current secret fails)
      const underCurrent = (() => {
        const prev = process.env.ENCRYPTION_SECRET_PREVIOUS
        if (!prev) return true
        delete process.env.ENCRYPTION_SECRET_PREVIOUS
        try {
          decrypt(value)
          return true
        } catch {
          return false
        } finally {
          process.env.ENCRYPTION_SECRET_PREVIOUS = prev
        }
      })()
      if (underCurrent) console.log(`${field}: ok (v2, current secret)`)
      else {
        console.log(`${field}: v2 under PREVIOUS secret → will rewrite`)
        updates[field] = encrypt(plain)
      }
    }

    const n = Object.keys(updates).length
    if (n === 0) {
      console.log('Nothing to do.')
      return
    }
    if (checkOnly) {
      console.log(`${n} field(s) need re-encryption (check mode, no changes made).`)
      process.exit(1)
    }
    await prisma.systemSettings.update({ where: { id: 'system' }, data: updates })
    console.log(`Re-encrypted ${n} field(s). Restart the app so the settings cache picks them up (pm2 restart oneonone).`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
