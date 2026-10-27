'use client'

import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const SIZES = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const
const FIELDS = 'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),select:not([disabled]),textarea:not([disabled])'
const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  /** Sticky bottom row, usually buttons */
  footer?: React.ReactNode
  size?: keyof typeof SIZES
  /** Block overlay-click / Esc while a submit is in flight */
  busy?: boolean
  className?: string
}

/**
 * Accessible dialog: role=dialog + aria-modal, labelled by the title, Esc + overlay click to close,
 * focus moved in on open and returned on close, Tab trapped inside, page scroll locked.
 */
export function Modal({ open, onClose, title, description, children, footer, size = 'md', busy, className }: ModalProps) {
  const titleId = useId()
  const descId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  // Latest onClose/busy without re-running the open effect: callers pass inline closures, and re-running
  // it on every parent render (i.e. every keystroke in a form) moved focus back to the first control.
  const onCloseRef = useRef(onClose)
  const busyRef = useRef(busy)
  useEffect(() => {
    onCloseRef.current = onClose
    busyRef.current = busy
  })

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    // Prefer the first form field so a form dialog is ready to type in; else the first control (e.g. Close)
    const field = panel?.querySelector<HTMLElement>(FIELDS)
    const first = field ?? panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel)?.focus()

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null)
      if (nodes.length === 0) return
      const firstNode = nodes[0]
      const lastNode = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === firstNode) {
        e.preventDefault()
        lastNode.focus()
      } else if (!e.shiftKey && document.activeElement === lastNode) {
        e.preventDefault()
        firstNode.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      restoreRef.current?.focus?.()
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !busy && onClose()} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'relative w-full rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 shadow-2xl flex flex-col max-h-[calc(100vh-2rem)] outline-none',
          SIZES[size],
          className
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-off-white dark:border-medium-gray/20 shrink-0">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-dark-gray dark:text-white">{title}</h2>
            {description && <p id={descId} className="mt-0.5 text-sm text-medium-gray">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="p-2 -m-2 rounded-lg text-medium-gray hover:text-dark-gray dark:hover:text-white hover:bg-off-white dark:hover:bg-dark-gray transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
        {footer && <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-off-white dark:border-medium-gray/20 shrink-0">{footer}</div>}
      </div>
    </div>
  )
}
