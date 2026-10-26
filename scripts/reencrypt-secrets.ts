/**
 * Re-encrypt secrets stored in SystemSettings and Google OAuth tokens in Account with the current
 * ENCRYPTION_SECRET (v2 format).
 *
 *   npm run secrets:reencrypt            # dry-run report + rewrite
 *   npm run secrets:reencrypt -- --check # report only, exit 1 if anything needs rewriting
 *
 * Handles: legacy scrypt ciphertext (pre-ENCRYPTION_SECRET), plaintext values stored before encryption applied
 * (awsAccessKeyId, every Account token written before fix/pack-2), and key rotation (set ENCRYPTION_SECRET to the new value and ENCRYPTION_SECRET_PREVIOUS to the old one).
 * Idempotent: values already in v2 format under the current secret are left untouched.
 */
import { PrismaClient } from '@prisma/client'
import { decrypt, encrypt, isEncrypted, isLegacyCiphertext } from '../lib/encryption'

const FIELDS = ['openaiApiKey', 'awsAccessKeyId', 'awsSecretKey'] as const
type Field = (typeof FIELDS)[number]

const TOKEN_FIELDS = ['access_token', 'refresh_token', 'id_token'] as const
type TokenField = (typeof TOKEN_FIELDS)[number]

/**
 * What to store for one value: undefined = leave as is, string = new ciphertext.
 * `quiet` suppresses per-value "ok" lines (there can be many accounts). Never prints secret values.
 */
function plan(label: string, value: string | null | undefined, quiet = false): string | undefined {
  if (!value) {
    if (!quiet) console.log(`${label}: empty`)
    return undefined
  }
  if (!isEncrypted(value)) {
    console.log(`${label}: PLAINTEXT → will encrypt`)
    return encrypt(value)
  }
  let plain: string
  try {
    plain = decrypt(value)
  } catch {
    console.error(`${label}: cannot decrypt with ENCRYPTION_SECRET / ENCRYPTION_SECRET_PREVIOUS / NEXTAUTH_SECRET.${quiet ? ' That user must sign in again.' : ' Re-enter it in Admin → Settings.'}`)
    process.exitCode = 1
    return undefined
  }
  if (isLegacyCiphertext(value)) {
    console.log(`${label}: legacy format → will rewrite as v2`)
    return encrypt(plain)
  }
  // v2 — rewrite only if it was decrypted via the previous secret (i.e. current secret fails)
  const prev = process.env.ENCRYPTION_SECRET_PREVIOUS
  if (prev) {
    delete process.env.ENCRYPTION_SECRET_PREVIOUS
    try {
      decrypt(value)
    } catch {
      console.log(`${label}: v2 under PREVIOUS secret → will rewrite`)
      return encrypt(plain)
    } finally {
      process.env.ENCRYPTION_SECRET_PREVIOUS = prev
    }
  }
  if (!quiet) console.log(`${label}: ok (v2, current secret)`)
  return undefined
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  if (!process.env.ENCRYPTION_SECRET) {
    console.error('ENCRYPTION_SECRET is not set. Add it to .env first (openssl rand -base64 32), restart the app, then run this again.')
    process.exit(2)
  }

  const prisma = new PrismaClient()
  try {
    const row = (await prisma.systemSettings.findUnique({ where: { id: 'system' } })) ?? ({} as Partial<Record<Field, string | null>>)

    const updates: Partial<Record<Field, string>> = {}
    for (const field of FIELDS) {
      const value = row[field]
      const next = plan(field, value)
      if (next !== undefined) updates[field] = next
    }

    // ---- Google OAuth tokens (Account) ----
    const accounts = await prisma.account.findMany({
      where: { provider: 'google' },
      select: { id: true, userId: true, access_token: true, refresh_token: true, id_token: true },
    })
    const accountUpdates: { id: string; data: Partial<Record<TokenField, string>> }[] = []
    let tokenFieldsTotal = 0
    for (const a of accounts) {
      const data: Partial<Record<TokenField, string>> = {}
      for (const f of TOKEN_FIELDS) {
        if (!a[f]) continue
        tokenFieldsTotal++
        const next = plan(`account ${a.userId} ${f}`, a[f], true)
        if (next !== undefined) data[f] = next
      }
      if (Object.keys(data).length) accountUpdates.push({ id: a.id, data })
    }
    console.log(`Google tokens: ${accounts.length} account(s), ${tokenFieldsTotal} token field(s), ${accountUpdates.length} account(s) need rewriting`)

    const n = Object.keys(updates).length + accountUpdates.length
    if (n === 0) {
      console.log('Nothing to do.')
      return
    }
    if (checkOnly) {
      console.log(`${Object.keys(updates).length} setting(s) and ${accountUpdates.length} account(s) need re-encryption (check mode, no changes made).`)
      process.exit(1)
    }
    if (Object.keys(updates).length) await prisma.systemSettings.update({ where: { id: 'system' }, data: updates })
    for (const u of accountUpdates) await prisma.account.update({ where: { id: u.id }, data: u.data })
    console.log(`Re-encrypted ${Object.keys(updates).length} setting(s) and ${accountUpdates.length} account(s). Restart the app (pm2 restart oneonone).`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
