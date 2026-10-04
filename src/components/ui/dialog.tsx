import type { ComponentProps, ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { XIcon } from 'lucide-react'
import { cn } from '../../lib/cn'
import { focusRing } from './styles'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export interface DialogContentProps
  extends Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title'> {
  /** Renders a Bootstrap `.modal-header` with this title and a close button. */
  title?: ReactNode
  /** Muted text under the header (also used as aria-describedby). */
  description?: ReactNode
  /** Hide the × close button in the header. */
  hideClose?: boolean
}

/**
 * Modal like Bootstrap `.modal`: white, 8px radius, border, shadow, dimmed
 * backdrop. Children usually are `<DialogBody>` + `<DialogFooter>`.
 * Without `title`, include a `<DialogTitle>` yourself for accessibility.
 */
export function DialogContent({
  className,
  title,
  description,
  hideClose,
  children,
  ...props
}: DialogContentProps) {
  const describedBy = description == null ? { 'aria-describedby': undefined } : {}
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <DialogPrimitive.Content
        {...describedBy}
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-md border border-border bg-bg text-fg shadow-menu outline-none',
          className,
        )}
        {...props}
      >
        {title != null && (
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {!hideClose && <DialogCloseButton />}
          </DialogHeader>
        )}
        {description != null && (
          <DialogDescription className="px-4 pt-4">{description}</DialogDescription>
        )}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export type DialogHeaderProps = ComponentProps<'div'>

export function DialogHeader({ className, ...props }: DialogHeaderProps) {
  return (
    <div
      className={cn('flex shrink-0 items-center justify-between gap-4 border-b border-border p-4', className)}
      {...props}
    />
  )
}

export type DialogBodyProps = ComponentProps<'div'>

export function DialogBody({ className, ...props }: DialogBodyProps) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto p-4', className)} {...props} />
}

export type DialogFooterProps = ComponentProps<'div'>

export function DialogFooter({ className, ...props }: DialogFooterProps) {
  return (
    <div
      className={cn('flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border p-3', className)}
      {...props}
    />
  )
}

export type DialogTitleProps = ComponentProps<typeof DialogPrimitive.Title>

/** `.modal-title`: 1.25rem, medium weight. */
export function DialogTitle({ className, ...props }: DialogTitleProps) {
  return (
    <DialogPrimitive.Title className={cn('m-0 text-xl leading-normal font-medium', className)} {...props} />
  )
}

export type DialogDescriptionProps = ComponentProps<typeof DialogPrimitive.Description>

export function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return <DialogPrimitive.Description className={cn('text-sm text-muted', className)} {...props} />
}

export type DialogCloseButtonProps = ComponentProps<typeof DialogPrimitive.Close>

/** The × button (Bootstrap `.btn-close`). */
export function DialogCloseButton({ className, ...props }: DialogCloseButtonProps) {
  return (
    <DialogPrimitive.Close
      aria-label="Close"
      className={cn(
        'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg-emphasis focus-visible:bg-surface-2 focus-visible:text-fg-emphasis',
        focusRing,
        className,
      )}
      {...props}
    >
      <XIcon aria-hidden className="size-4" />
    </DialogPrimitive.Close>
  )
}
