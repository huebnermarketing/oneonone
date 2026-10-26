/** Log-safe forms of personal data. Logs go to PM2 files on the server; keep addresses out of them. */

/** "tarang.c@whitelabeliq.com" → "t***@whitelabeliq.com" (domain kept: useful for delivery debugging, not personal). */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '(none)'
  const at = email.lastIndexOf('@')
  if (at <= 0) return '***'
  return `${email[0]}***${email.slice(at)}`
}

/** "2 recipients: t***@whitelabeliq.com, n***@whitelabeliq.com" */
export function maskRecipients(recipients: string[]): string {
  return `${recipients.length} recipient${recipients.length === 1 ? '' : 's'}: ${recipients.map(maskEmail).join(', ')}`
}
