import type { ComponentProps } from 'react'
import { Slot } from 'radix-ui'
import { cn } from '../../lib/cn'
import { joinedChildren } from './styles'
import { cellVariants } from './variants'
import type { CellSize } from './variants'

export interface CellProps extends ComponentProps<'div'> {
  /** Active cell: black border + shadow, raised above neighbours. */
  active?: boolean
  /** Grey background (like the active table cell, bg surface-2). */
  highlighted?: boolean
  size?: CellSize
  /** Fully round (lamps). Inside a joined CellRow the row rounding wins. */
  round?: boolean
  /** Render the child element (e.g. a <button>) with the cell look. */
  asChild?: boolean
}

/** The Turing-machine tape cell: 58×58, grey border, big centred letter. */
export function Cell({
  className,
  active = false,
  highlighted = false,
  size = 'md',
  round = false,
  asChild = false,
  ...props
}: CellProps) {
  const Comp = asChild ? Slot.Root : 'div'
  return (
    <Comp
      data-active={active ? '' : undefined}
      data-highlighted={highlighted ? '' : undefined}
      className={cellVariants({ active, highlighted, size, round, className })}
      {...props}
    />
  )
}

export interface CellRowProps extends ComponentProps<'div'> {
  /** Collapse borders like an input-group (default). false = separate cells with a gap. */
  joined?: boolean
}

/** A row of Cells; joined rows only round the outer corners. Children should be the cells themselves. */
export function CellRow({ className, joined = true, ...props }: CellRowProps) {
  return (
    <div
      className={cn('flex items-stretch', joined ? joinedChildren : 'gap-2', className)}
      {...props}
    />
  )
}
