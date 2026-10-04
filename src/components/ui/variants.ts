import { cn } from '../../lib/cn'
import { focusRing } from './styles'

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'secondary'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const base =
  'inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-md border font-medium transition-colors disabled:pointer-events-none disabled:opacity-[.65] [&_svg]:shrink-0'

const variants: Record<ButtonVariant, string> = {
  primary:
    'border-primary bg-primary text-primary-fg hover:border-primary-hover hover:bg-primary-hover active:border-primary-hover active:bg-primary-hover',
  outline:
    'border-border bg-bg text-fg hover:border-border-strong hover:bg-surface active:bg-surface-2 data-[state=open]:border-border-strong data-[state=open]:bg-surface',
  ghost: 'border-transparent bg-transparent text-fg hover:bg-surface-2 active:bg-surface-2',
  secondary: 'border-border bg-surface-2 text-muted hover:text-fg active:border-border-strong',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-[33px] px-2 py-1 text-sm leading-5',
  md: 'h-10 px-3 py-1.5 text-base leading-6',
  lg: 'h-12 px-4 py-2 text-xl leading-7',
  icon: 'size-10 p-0 text-base',
  'icon-sm': 'size-[33px] p-0 text-sm',
}

/** Class string for a button look (use on non-button elements, e.g. links or Radix items). */
export function buttonVariants({
  variant = 'outline',
  size = 'md',
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(base, focusRing, variants[variant], buttonSizes[size], className)
}

export type CellSize = 'sm' | 'md' | 'lg'

const cellSizes: Record<CellSize, string> = {
  sm: 'size-11 text-lg', // 44px (lamps / plugboard sockets)
  md: 'size-[58px] text-2xl', // 58px tape cell, fs-4
  lg: 'size-[72px] text-3xl',
}

/** Class string for the tape-cell look (for custom elements). */
export function cellVariants({
  active = false,
  highlighted = false,
  size = 'md',
  round = false,
  className,
}: {
  active?: boolean
  highlighted?: boolean
  size?: CellSize
  round?: boolean
  className?: string
} = {}) {
  return cn(
    'relative inline-flex shrink-0 select-none items-center justify-center border border-border bg-bg leading-none text-fg transition-[border-color,box-shadow,background-color] duration-150 hover:z-[5] hover:border-border-strong',
    round ? 'rounded-full' : 'rounded-md',
    cellSizes[size],
    focusRing,
    highlighted && 'bg-surface-2',
    active && 'z-10 border-fg-emphasis shadow-cell hover:z-10 hover:border-fg-emphasis',
    className,
  )
}

