import type { ComponentProps } from 'react'
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'
import { cn } from '../../lib/cn'
import { focusRing, joinedChildren } from './styles'

export type ToggleGroupProps = ComponentProps<typeof ToggleGroupPrimitive.Root>

/**
 * Segmented control: outline buttons joined like a Bootstrap `.btn-group`;
 * the active item is black. Pass `type="single"` or `type="multiple"`.
 */
export function ToggleGroup({ className, ...props }: ToggleGroupProps) {
  return (
    <ToggleGroupPrimitive.Root
      className={cn('inline-flex w-fit items-stretch', joinedChildren, className)}
      {...props}
    />
  )
}

export interface ToggleGroupItemProps extends ComponentProps<typeof ToggleGroupPrimitive.Item> {
  size?: 'sm' | 'md'
}

export function ToggleGroupItem({ className, size = 'md', ...props }: ToggleGroupItemProps) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        'inline-flex cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-md border border-border bg-bg font-medium text-fg transition-colors hover:border-border-strong hover:bg-surface disabled:pointer-events-none disabled:opacity-[.65] [&_svg]:shrink-0',
        'data-[state=on]:z-10 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-fg data-[state=on]:hover:bg-primary-hover',
        focusRing,
        size === 'sm' ? 'h-[33px] px-2 text-sm leading-5' : 'h-10 px-3 text-base leading-6',
        className,
      )}
      {...props}
    />
  )
}
