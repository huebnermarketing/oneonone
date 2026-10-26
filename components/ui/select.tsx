import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Wrapper class (the chevron is positioned inside it) */
  wrapperClassName?: string
}

/** Native <select> with the app's chevron. Always pass an accessible name via `aria-label` or a `<label htmlFor>`. */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, wrapperClassName, children, ...props }, ref) => (
  <div className={cn('relative', wrapperClassName)}>
    <select
      ref={ref}
      className={cn(
        'w-full appearance-none rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal px-4 py-2.5 pr-10 text-sm text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-dark-gray/20 dark:focus:ring-white/20 disabled:opacity-50',
        className
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-medium-gray" aria-hidden="true" />
  </div>
))
Select.displayName = 'Select'
