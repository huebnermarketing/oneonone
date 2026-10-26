/** Small display helpers shared by client components. No React here — keep it importable from server code too. */

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
export const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** ISO-639-1 → display name for the languages the transcription UI offers / detects. */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', hi: 'Hindi', gu: 'Gujarati', mr: 'Marathi', ta: 'Tamil', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam',
  bn: 'Bengali', pa: 'Punjabi', ur: 'Urdu', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', it: 'Italian',
  nl: 'Dutch', ru: 'Russian', ja: 'Japanese', zh: 'Chinese', ko: 'Korean', ar: 'Arabic', tr: 'Turkish', id: 'Indonesian',
}
export const languageName = (code: string | null | undefined) => (code ? LANGUAGE_NAMES[code.toLowerCase()] ?? code.toUpperCase() : 'Unknown')

/** 1536 → "1.5 KB" */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

/** Time-of-day greeting from an hour (0–23) in the viewer's zone. */
export function greeting(hour: number): string {
  if (hour < 5) return 'Good night'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  if (hour < 21) return 'Good evening'
  return 'Good night'
}

/** "3 items" / "1 item" */
export const plural = (n: number, noun: string, pluralNoun = `${noun}s`) => `${n} ${n === 1 ? noun : pluralNoun}`
