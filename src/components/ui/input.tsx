import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'
import { controlBase, controlFocus, joinedChildren } from './styles'

export type InputProps = ComponentProps<'input'>

/** Bootstrap `.form-control` text input. */
export function Input({ className, type = 'text', ...props }: InputProps) {
  return <input type={type} className={cn(controlBase, controlFocus, className)} {...props} />
}

export type TextareaProps = ComponentProps<'textarea'>

/** Multi-line `.form-control`. */
export function Textarea({ className, rows = 3, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(controlBase, controlFocus, 'min-h-[5rem] resize-y', className)}
      {...props}
    />
  )
}

export type InputGroupProps = ComponentProps<'div'>

/**
 * Bootstrap `.input-group`: direct children (Input, InputGroupText, Button,
 * SelectTrigger…) are joined with collapsed borders; inputs grow to fill.
 */
export function InputGroup({ className, ...props }: InputGroupProps) {
  return (
    <div
      role="group"
      className={cn(
        'relative flex w-full flex-nowrap items-stretch',
        joinedChildren,
        '[&>input]:flex-1 [&>textarea]:flex-1 [&>button]:h-auto',
        className,
      )}
      {...props}
    />
  )
}

export type InputGroupTextProps = ComponentProps<'span'>

/** The grey `.input-group-text` addon (e.g. the "10" count badge). */
export function InputGroupText({ className, ...props }: InputGroupTextProps) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center whitespace-nowrap rounded-md border border-border bg-surface px-3 py-1.5 text-center text-base leading-6 font-normal text-fg tabular-nums',
        className,
      )}
      {...props}
    />
  )
}
