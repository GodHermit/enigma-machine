import type { ComponentProps } from 'react'
import { Slot } from 'radix-ui'
import { buttonVariants } from './variants'
import type { ButtonSize, ButtonVariant } from './variants'

export interface ButtonProps extends ComponentProps<'button'> {
  /** primary = black (Bootstrap btn-dark), outline = white with grey border (default). */
  variant?: ButtonVariant
  size?: ButtonSize
  /** Render the child element instead of a <button> (Radix Slot). */
  asChild?: boolean
}

export function Button({
  className,
  variant = 'outline',
  size = 'md',
  asChild = false,
  type,
  ...props
}: ButtonProps) {
  const classes = buttonVariants({ variant, size, className })
  if (asChild) {
    return <Slot.Root data-variant={variant} className={classes} {...props} />
  }
  return <button type={type ?? 'button'} data-variant={variant} className={classes} {...props} />
}
