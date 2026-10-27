'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MenuItem {
  label: string
  icon?: LucideIcon
  /** Either an action… */
  onSelect?: () => void
  /** …or a link (e.g. a CSV download) */
  href?: string
  download?: boolean
  danger?: boolean
  disabled?: boolean
}

/**
 * Small dropdown menu (role=menu). Positioned `fixed` from the trigger so table scroll containers
 * don't clip it; flips upward near the bottom of the viewport. Esc / outside click / scroll close it;
 * ArrowUp/ArrowDown move between items.
 */
export function Menu({
  items,
  label,
  trigger,
  triggerClassName,
  align = 'end',
}: {
  items: MenuItem[]
  /** Accessible name of the trigger button */
  label: string
  trigger: React.ReactNode
  triggerClassName?: string
  align?: 'start' | 'end'
}) {
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number; up: boolean } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const open = pos !== null

  const close = useCallback((refocus = false) => {
    setPos(null)
    if (refocus) btnRef.current?.focus()
  }, [])

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (open) return close()
    const r = btnRef.current!.getBoundingClientRect()
    const up = window.innerHeight - r.bottom < 48 * items.length + 16
    setPos({
      top: up ? r.top - 4 : r.bottom + 4,
      up,
      ...(align === 'end' ? { right: window.innerWidth - r.right } : { left: r.left }),
    })
  }

  useEffect(() => {
    if (!open) return
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
    first?.focus()
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return close(true)
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const els = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])
      const i = els.indexOf(document.activeElement as HTMLElement)
      els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus()
    }
    const onScroll = () => close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, close])

  const itemClass = (it: MenuItem) =>
    cn(
      'flex w-full items-center gap-2.5 px-3 py-2 text-sm text-left rounded-lg outline-none transition-colors',
      it.disabled
        ? 'opacity-40 cursor-not-allowed'
        : it.danger
          ? 'text-red-600 dark:text-red-400 hover:bg-red-500/10 focus:bg-red-500/10'
          : 'text-dark-gray dark:text-white hover:bg-off-white dark:hover:bg-dark-gray focus:bg-off-white dark:focus:bg-dark-gray'
    )

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={toggle}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {pos && (
        <div
          ref={menuRef}
          id={id}
          role="menu"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            right: pos.right,
            transform: pos.up ? 'translateY(-100%)' : undefined,
          }}
          className="z-50 min-w-[11rem] rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal p-1 shadow-lg"
        >
          {items.map((it) => {
            const Icon = it.icon
            const content = (
              <>
                {Icon && <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />}
                {it.label}
              </>
            )
            return it.href && !it.disabled ? (
              <a key={it.label} role="menuitem" href={it.href} download={it.download} onClick={() => close()} className={itemClass(it)}>
                {content}
              </a>
            ) : (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                aria-disabled={it.disabled || undefined}
                onClick={() => {
                  if (it.disabled) return
                  close()
                  it.onSelect?.()
                }}
                className={itemClass(it)}
              >
                {content}
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}
