import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

export interface KbdProps extends ComponentProps<'kbd'> {
  /** solid = Bootstrap `<kbd>` (dark), outline = bordered key cap. */
  variant?: 'solid' | 'outline'
}

/** Keyboard key hint. */
export function Kbd({ className, variant = 'outline', ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-[1.5em] items-center justify-center rounded-sm px-1.5 py-px font-mono text-[0.8125em] leading-normal font-medium',
        variant === 'solid'
          ? 'bg-fg text-bg'
          : 'border border-border bg-surface text-fg shadow-[inset_0_-1px_0_var(--border)]',
        className,
      )}
      {...props}
    />
  )
}
