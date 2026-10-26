'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

const SIZES = { xs: 'w-6 h-6 text-[10px]', sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-14 h-14 text-lg', xl: 'w-20 h-20 text-2xl' } as const

/** "Nishant Rana" → "NR"; single word → first two letters; empty → "?" */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Initials avatar; shows the image when `src` loads, initials otherwise (missing, 403, offline).
 * Decorative when a visible name sits next to it — pass `alt=""` then.
 */
export function Avatar({ name, src, size = 'md', className, alt }: { name: string | null | undefined; src?: string | null; size?: keyof typeof SIZES; className?: string; alt?: string }) {
  const label = alt ?? name ?? ''
  // Remember which src failed, so a new src automatically gets a fresh attempt
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (src && src !== failedSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={label}
        // Google profile photos (lh3.googleusercontent.com) frequently 403 when a Referer is sent
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(src)}
        className={cn('rounded-full object-cover flex-shrink-0', SIZES[size], className)}
      />
    )
  }
  return (
    <div
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className={cn('rounded-full bg-dark-gray dark:bg-white text-white dark:text-dark-gray flex items-center justify-center font-semibold flex-shrink-0 select-none', SIZES[size], className)}
    >
      {initials(name)}
    </div>
  )
}
