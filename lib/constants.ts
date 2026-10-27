/**
 * Single home for values that were previously re-declared across routes and components.
 * Server-only (reads process.env); client components must not import this file.
 */

export const APP_NAME = 'AMI One-on-One'

/** Fallback timezone for display and schedule math when a user has none set. */
export const DEFAULT_TIMEZONE = 'Asia/Kolkata'

/** Meeting lengths (15 / 30, default 15) live in lib/meeting-duration.ts — each meeting stores its own. */

/** Email domain users must belong to. Derived from the sign-in restriction so the two never drift. */
export const ALLOWED_EMAIL_DOMAIN = `@${(process.env.GOOGLE_WORKSPACE_DOMAIN || 'whitelabeliq.com').toLowerCase()}`

export function isAllowedEmail(email: string): boolean {
  return email.toLowerCase().endsWith(ALLOWED_EMAIL_DOMAIN)
}
