import type { ComponentProps, ReactNode } from 'react'
import { Label as LabelPrimitive } from 'radix-ui'
import { cn } from '../../lib/cn'
import { InfoTip } from './info-tip'

export type LabelProps = ComponentProps<typeof LabelPrimitive.Root>

/** Bootstrap `.form-label` ("Alphabet:" style): normal weight, mb-2. */
export function Label({ className, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root
      className={cn('mb-2 inline-block font-normal text-fg select-none', className)}
      {...props}
    />
  )
}

export interface FieldProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Label text, e.g. "Model:". */
  label?: ReactNode
  /** id of the control the label points at. */
  htmlFor?: string
  /** Muted helper text below the control. */
  hint?: ReactNode
  /** Error text below the control (rendered with role="alert"). */
  error?: ReactNode
  /** Explanation shown in a "?" popover right after the label. */
  info?: ReactNode
  /** Accessible name of the "?" button ("About …"); defaults to the label text without its colon. */
  infoLabel?: string
  /** Extra content rendered on the right side of the label row (e.g. a small action). */
  labelAside?: ReactNode
  labelClassName?: string
  children?: ReactNode
}

/** Label + control + optional hint/error, stacked like a Bootstrap form group. */
export function Field({
  className,
  label,
  htmlFor,
  hint,
  error,
  info,
  infoLabel,
  labelAside,
  labelClassName,
  children,
  ...props
}: FieldProps) {
  const labelNode =
    label != null ? (
      <Label htmlFor={htmlFor} className={cn(info != null && 'mb-0', labelClassName)}>
        {label}
      </Label>
    ) : null
  return (
    <div className={cn('flex min-w-0 flex-col', className)} {...props}>
      {(label != null || labelAside != null) && (
        <div className="flex items-baseline justify-between gap-2">
          {info != null && labelNode != null ? (
            <span className="mb-2 inline-flex items-center gap-1">
              {labelNode}
              <InfoTip label={infoLabel ?? labelText(label)}>{info}</InfoTip>
            </span>
          ) : (
            labelNode
          )}
          {labelAside != null && <div className="mb-2 text-sm text-muted">{labelAside}</div>}
        </div>
      )}
      {children}
      {hint != null && error == null && <p className="mt-1 text-sm text-muted">{hint}</p>}
      {error != null && (
        <p role="alert" className="mt-1 text-sm font-medium text-signal-in">
          {error}
        </p>
      )}
    </div>
  )
}

/** "Model:" → "Model"; non-string labels fall back to a generic name. */
function labelText(label: ReactNode): string {
  return typeof label === 'string' ? label.replace(/:\s*$/, '') : 'this field'
}
