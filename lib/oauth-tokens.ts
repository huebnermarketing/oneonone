/**
 * Google OAuth tokens at rest. `Account.access_token` / `refresh_token` / `id_token` are stored
 * AES-GCM encrypted (lib/encryption.ts, same key as the other secrets). Rows written before this
 * existed are plaintext; reads accept both, and `npm run secrets:reencrypt` converts them.
 */
import type { Account } from '@prisma/client'
import { prisma } from './prisma'
import { decrypt, encrypt, isEncrypted } from './encryption'

const TOKEN_FIELDS = ['access_token', 'refresh_token', 'id_token'] as const
type TokenField = (typeof TOKEN_FIELDS)[number]

/** Encrypt a token for storage (null/empty pass through). Already-encrypted values are left alone. */
export function sealToken(value: string | null | undefined): string | null {
  if (!value) return null
  return isEncrypted(value) ? value : encrypt(value)
}

/** Plaintext token from a stored value; legacy plaintext rows are returned as-is. Throws if a ciphertext can't be decrypted. */
export function openToken(value: string | null | undefined): string | null {
  if (!value) return null
  return isEncrypted(value) ? decrypt(value) : value
}

/** Copy of an adapter account object with its token fields encrypted (used by linkAccount). */
export function sealAccountTokens<T extends Partial<Record<TokenField, string | null | undefined>>>(account: T): T {
  const out = { ...account }
  for (const f of TOKEN_FIELDS) if (out[f]) (out as Record<TokenField, string | null>)[f] = sealToken(out[f])
  return out
}

export interface GoogleTokens {
  accessToken: string
  refreshToken: string | null
  /** epoch ms */
  expiryDate: number | null
}

/**
 * Decrypted Google tokens for a user, or null when none are linked or they can't be decrypted
 * (e.g. ENCRYPTION_SECRET rotated without ENCRYPTION_SECRET_PREVIOUS) — the user then just
 * signs in again to store fresh ones.
 */
export async function getGoogleTokens(userId: string): Promise<GoogleTokens | null> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: 'google' },
    select: { access_token: true, refresh_token: true, expires_at: true },
  })
  if (!account?.access_token) return null
  try {
    return {
      accessToken: openToken(account.access_token)!,
      refreshToken: openToken(account.refresh_token),
      expiryDate: account.expires_at ? account.expires_at * 1000 : null,
    }
  } catch (err) {
    console.error(`[oauth] cannot decrypt Google tokens for user ${userId}; they must sign in again:`, err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Persist new Google tokens (encrypted). A refresh token is only replaced when Google sent one —
 * Google omits it on most refreshes, and dropping the stored one would disconnect the calendar.
 */
export async function saveGoogleTokens(
  userId: string,
  tokens: { access_token?: string | null; refresh_token?: string | null; id_token?: string | null; expires_at?: number | null }
): Promise<void> {
  if (!tokens.access_token) return
  const data: Partial<Pick<Account, 'access_token' | 'refresh_token' | 'id_token' | 'expires_at'>> = {
    access_token: sealToken(tokens.access_token),
    expires_at: tokens.expires_at ?? null,
  }
  if (tokens.refresh_token) data.refresh_token = sealToken(tokens.refresh_token)
  if (tokens.id_token) data.id_token = sealToken(tokens.id_token)
  await prisma.account.updateMany({ where: { userId, provider: 'google' }, data })
}
