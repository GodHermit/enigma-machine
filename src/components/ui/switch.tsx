import { useId } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { Switch as SwitchPrimitive } from 'radix-ui'
import { cn } from '../../lib/cn'
import { focusRing } from './styles'
import { Label } from './field'
import { InfoTip } from './info-tip'

export interface SwitchProps extends ComponentProps<typeof SwitchPrimitive.Root> {
  /** Text next to the switch (clickable). */
  label?: ReactNode
  /** Muted text under the label. */
  description?: ReactNode
  /** Explanation shown in a "?" popover after the label (needs a string `label` or `infoLabel`). */
  info?: ReactNode
  infoLabel?: string
  /**
   * With a label, `className` styles the wrapper and `switchClassName`
   * the switch itself; without a label `className` goes to the switch.
   */
  switchClassName?: string
  labelClassName?: string
}

/** Bootstrap `.form-switch`: pill track with an evenly inset thumb, black when checked. */
export function Switch({
  className,
  switchClassName,
  labelClassName,
  label,
  description,
  info,
  infoLabel,
  id,
  ...props
}: SwitchProps) {
  const autoId = useId()
  const switchId = id ?? autoId
  const descId = `${switchId}-desc`
  const control = (
    <SwitchPrimitive.Root
      id={switchId}
      aria-describedby={description != null ? descId : undefined}
      className={cn(
        // 36×20 track, 2px border → 32×16 inside; 12px thumb with a 2px inset on every side.
        'group inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border bg-bg transition-colors duration-150 hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-[.65] data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:hover:border-primary-hover data-[state=checked]:hover:bg-primary-hover',
        focusRing,
        label == null && className,
        switchClassName,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-3 translate-x-0.5 rounded-full bg-border-strong transition-[translate,background-color,width] duration-150 group-hover:bg-muted group-active:w-3.5 data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-primary-fg data-[state=checked]:group-hover:bg-primary-fg data-[state=checked]:group-active:translate-x-4" />
    </SwitchPrimitive.Root>
  )
  if (label == null) return control
  return (
    <div className={cn('inline-flex items-start gap-2', className)}>
      <span className="flex h-6 items-center">{control}</span>
      <span className="flex flex-col">
        <span className="inline-flex items-center gap-1">
          <Label
            htmlFor={switchId}
            className={cn(
              'mb-0 cursor-pointer leading-6',
              props.disabled && 'cursor-not-allowed opacity-[.65]',
              labelClassName,
            )}
          >
            {label}
          </Label>
          {info != null && (
            <InfoTip label={infoLabel ?? (typeof label === 'string' ? label : 'this option')}>
              {info}
            </InfoTip>
          )}
        </span>
        {description != null && (
          <span id={descId} className="text-sm text-muted">
            {description}
          </span>
        )}
      </span>
    </div>
  )
}
