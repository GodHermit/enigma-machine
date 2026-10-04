import type { ComponentProps } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { cn } from '../../lib/cn'
import { menuContent } from './styles'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor
export const PopoverClose = PopoverPrimitive.Close

export type PopoverContentProps = ComponentProps<typeof PopoverPrimitive.Content>

/** Floating panel with the dropdown-menu look (Portal, z-50, 4px offset). */
export function PopoverContent({
  className,
  sideOffset = 4,
  align = 'center',
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        collisionPadding={8}
        className={cn(
          menuContent,
          'max-h-[var(--radix-popover-content-available-height)] max-w-[min(20rem,var(--radix-popover-content-available-width))] overflow-y-auto p-3',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
