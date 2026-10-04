import { useEffect, useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { cn } from '../../lib/cn'
import { PopoverContent } from './popover'
import { focusRing } from './styles'

/** Hover delay before opening, and grace period for moving the mouse onto the popover. */
const OPEN_DELAY = 200
const CLOSE_DELAY = 150

/** "?" in a circle, drawn on a 14px grid so at 14px every line is exactly 1.5px wide. */
function QuestionIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7" cy="7" r="6.25" />
      <path d="M5.43 5.43a1.58 1.58 0 1 1 2.36 1.37c-.48.28-.79.63-.79 1.17v.35" />
      <path d="M7 10.6h.01" />
    </svg>
  )
}

export interface InfoTipProps {
  /** What the tip explains, e.g. "Model" → trigger is announced as "About Model". */
  label: string
  /** Explanation shown in the popover. */
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  /** Styles the trigger button. */
  className?: string
  /** Styles the popover panel (e.g. a wider `w-96` for long explanations). */
  contentClassName?: string
}

/**
 * Small "?" button next to a control explaining it. Mouse hover opens it (and it stays open
 * while the pointer is over the button or the popover); click / tap / Enter pins it open
 * until clicked again, Esc or an outside click — so it also works on touch screens.
 */
export function InfoTip({
  label,
  children,
  side = 'top',
  align = 'center',
  className,
  contentClassName,
}: InfoTipProps) {
  const [open, setOpen] = useState(false)
  /** Opened by click/keyboard (stays open) rather than by hover. */
  const [pinned, setPinned] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => clearTimer, [])

  const schedule = (next: boolean, delay: number) => {
    clearTimer()
    timer.current = setTimeout(() => setOpen(next), delay)
  }

  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    if (open) clearTimer()
    else schedule(true, OPEN_DELAY)
  }

  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || pinned) return
    schedule(false, CLOSE_DELAY)
  }

  const onOpenChange = (next: boolean) => {
    clearTimer()
    setOpen(next)
    if (!next) setPinned(false)
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger
        type="button"
        aria-label={`About ${label}`}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onClick={(event) => {
          // Replaces Radix' toggle: a click on a hover-opened tip pins it instead of closing it.
          event.preventDefault()
          clearTimer()
          if (open && pinned) {
            onOpenChange(false)
          } else {
            setOpen(true)
            setPinned(true)
          }
        }}
        className={cn(
          'inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full align-middle text-muted opacity-60 transition-[color,opacity] hover:text-fg hover:opacity-100 focus-visible:text-fg focus-visible:opacity-100 data-[state=open]:text-fg data-[state=open]:opacity-100 [&_svg]:size-3.5',
          focusRing,
          className,
        )}
      >
        <QuestionIcon />
      </PopoverPrimitive.Trigger>
      <PopoverContent
        side={side}
        align={align}
        aria-label={label}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        // Hover-opened tips must not steal focus from what the user is doing.
        onOpenAutoFocus={(event) => {
          if (!pinned) event.preventDefault()
        }}
        className={cn(
          'w-72 text-left text-sm leading-5 font-normal [&_dd]:text-muted [&_dd+dt]:mt-2 [&_dt]:font-semibold [&_p+dl]:mt-2 [&_p+p]:mt-2',
          contentClassName,
        )}
      >
        {children}
      </PopoverContent>
    </PopoverPrimitive.Root>
  )
}
