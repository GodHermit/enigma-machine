import { createContext, useContext } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { Tooltip as TooltipPrimitive } from 'radix-ui'
import { cn } from '../../lib/cn'

const InsideProvider = createContext(false)

export type TooltipProviderProps = ComponentProps<typeof TooltipPrimitive.Provider>

/** Put once at the app root; tooltips also work without it (they self-provide). */
export function TooltipProvider({
  delayDuration = 300,
  skipDelayDuration = 300,
  ...props
}: TooltipProviderProps) {
  return (
    <InsideProvider value={true}>
      <TooltipPrimitive.Provider
        delayDuration={delayDuration}
        skipDelayDuration={skipDelayDuration}
        {...props}
      />
    </InsideProvider>
  )
}

export type TooltipProps = ComponentProps<typeof TooltipPrimitive.Root>

/** Radix Tooltip root. Wraps itself in a provider when none is present. */
export function Tooltip(props: TooltipProps) {
  const hasProvider = useContext(InsideProvider)
  const root = <TooltipPrimitive.Root {...props} />
  return hasProvider ? root : <TooltipProvider>{root}</TooltipProvider>
}

export const TooltipTrigger = TooltipPrimitive.Trigger

export interface TooltipContentProps extends ComponentProps<typeof TooltipPrimitive.Content> {
  /** Show the little arrow (default true). */
  arrow?: boolean
}

/** Dark bubble (Bootstrap tooltip): small text, 4px radius, Portal + z-50. */
export function TooltipContent({
  className,
  sideOffset = 4,
  arrow = true,
  children,
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          'z-50 max-w-[16rem] rounded-sm bg-fg-emphasis px-2 py-1 text-center text-sm leading-5 font-normal text-bg shadow-cell select-none',
          className,
        )}
        {...props}
      >
        {children}
        {arrow && <TooltipPrimitive.Arrow className="fill-fg-emphasis" width={10} height={5} />}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export interface HintProps {
  /** Tooltip text; when null/undefined/'' the child is rendered without a tooltip. */
  content: ReactNode
  /** A single element that can hold a ref (button, span, Cell…). */
  children: ReactNode
  side?: TooltipContentProps['side']
  align?: TooltipContentProps['align']
  delayDuration?: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}

/** Convenience tooltip: `<Hint content="Step rotor"><Button>…</Button></Hint>`. */
export function Hint({
  content,
  children,
  side = 'top',
  align = 'center',
  delayDuration,
  open,
  onOpenChange,
  className,
}: HintProps) {
  if (content == null || content === '' || content === false) return <>{children}</>
  return (
    <Tooltip delayDuration={delayDuration} open={open} onOpenChange={onOpenChange}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align} className={className}>
        {content}
      </TooltipContent>
    </Tooltip>
  )
}
