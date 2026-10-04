import type { ComponentProps } from 'react'
import { Slider as SliderPrimitive } from 'radix-ui'
import { cn } from '../../lib/cn'

export interface SliderProps extends ComponentProps<typeof SliderPrimitive.Root> {
  /** Accessible name for the thumb(s); one per thumb or a single one for all. */
  thumbLabels?: string[]
}

/** Range slider with a grey track, black range and black thumb. */
export function Slider({
  className,
  value,
  defaultValue,
  min = 0,
  max = 100,
  thumbLabels,
  'aria-label': ariaLabel,
  ...props
}: SliderProps) {
  const thumbCount = (value ?? defaultValue ?? [min]).length
  return (
    <SliderPrimitive.Root
      value={value}
      defaultValue={defaultValue}
      min={min}
      max={max}
      className={cn(
        'relative flex h-5 w-full touch-none select-none items-center data-disabled:opacity-[.65] data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-32 data-[orientation=vertical]:w-5 data-[orientation=vertical]:flex-col',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-surface-2 data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-primary data-[orientation=vertical]:w-full" />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbCount }, (_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          aria-label={thumbLabels?.[i] ?? thumbLabels?.[0] ?? ariaLabel}
          className="block size-4 cursor-grab rounded-full border-2 border-bg bg-primary shadow-cell transition-transform outline-none hover:scale-110 focus-visible:scale-125 active:scale-125 active:cursor-grabbing data-disabled:cursor-not-allowed"
        />
      ))}
    </SliderPrimitive.Root>
  )
}
