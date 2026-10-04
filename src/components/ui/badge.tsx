import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

export type BadgeVariant = 'default' | 'primary' | 'outline' | 'muted' | 'signal-in' | 'signal-out'

const variants: Record<BadgeVariant, string> = {
  default: 'border-border bg-surface text-fg',
  primary: 'border-primary bg-primary text-primary-fg',
  outline: 'border-border bg-bg text-fg',
  muted: 'border-transparent bg-surface-2 text-muted',
  'signal-in': 'border-signal-in bg-signal-in text-bg',
  'signal-out': 'border-signal-out bg-signal-out text-bg',
}

export interface BadgeProps extends ComponentProps<'span'> {
  variant?: BadgeVariant
}

/** Small pill/label (Bootstrap `.badge`, 4px radius). */
export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      data-variant={variant}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs leading-4 font-semibold whitespace-nowrap tabular-nums',
        variants[variant],
        className,
      )}
      {...props}
    />
  )
}
