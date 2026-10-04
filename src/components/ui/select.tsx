import { Fragment } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { Select as SelectPrimitive } from 'radix-ui'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import { cn } from '../../lib/cn'
import { focusRing, menuContent, menuLabel, menuSeparator } from './styles'

/* ------------------------------------------------------------------ */
/* Compound API                                                        */
/* ------------------------------------------------------------------ */

/** Radix Select root (value / defaultValue / onValueChange / disabled / name). */
export const Select = SelectPrimitive.Root
export const SelectGroup = SelectPrimitive.Group
export const SelectValue = SelectPrimitive.Value

export type SelectSize = 'sm' | 'md'

export interface SelectTriggerProps extends ComponentProps<typeof SelectPrimitive.Trigger> {
  size?: SelectSize
}

/** `.form-select`: bordered 40px control with a chevron on the right. */
export function SelectTrigger({ className, size = 'md', children, ...props }: SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      data-size={size}
      className={cn(
        'flex w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-bg text-left font-medium text-fg transition-[border-color,box-shadow] hover:border-border-strong data-placeholder:font-normal data-placeholder:text-muted data-[state=open]:border-border-strong disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-[.65] [&>span]:min-w-0 [&>span]:truncate',
        focusRing,
        size === 'sm' ? 'h-[33px] py-1 pr-1.5 pl-2 text-sm leading-5' : 'h-10 py-1.5 pr-2.5 pl-3 text-base leading-6',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-fg opacity-80" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

export type SelectContentProps = ComponentProps<typeof SelectPrimitive.Content>

/**
 * Dropdown list in a Portal (z-50), popper positioned 4px below the trigger,
 * at least as wide as the trigger, scrolls when taller than 20rem / viewport.
 */
export function SelectContent({
  className,
  children,
  position = 'popper',
  sideOffset = 4,
  ...props
}: SelectContentProps) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={position === 'popper' ? sideOffset : undefined}
        className={cn(
          menuContent,
          'relative p-0',
          position === 'popper' &&
            'max-h-[min(24rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] max-w-[var(--radix-select-content-available-width)]',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-6 cursor-default items-center justify-center bg-bg text-muted">
          <ChevronUpIcon aria-hidden />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="p-2">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-6 cursor-default items-center justify-center bg-bg text-muted">
          <ChevronDownIcon aria-hidden />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

export interface SelectItemProps extends ComponentProps<typeof SelectPrimitive.Item> {
  /** Secondary muted line under the label (not shown in the trigger). */
  description?: ReactNode
}

/** Rounded 4px item; hover = grey, selected = black with white text. */
export function SelectItem({ className, children, description, ...props }: SelectItemProps) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'group relative flex w-full cursor-pointer select-none flex-col items-start rounded-sm [[role=option]+&]:mt-1 py-1.5 pr-8 pl-3 leading-6 outline-none',
        '[&[data-highlighted]:not([data-state=checked])]:bg-surface-2',
        'data-[state=checked]:bg-primary data-[state=checked]:text-primary-fg',
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      {description != null && (
        <span className="text-sm leading-5 text-muted group-data-[state=checked]:text-primary-fg/75">
          {description}
        </span>
      )}
      <SelectPrimitive.ItemIndicator className="absolute top-2 right-2 flex size-4 items-center justify-center">
        <CheckIcon aria-hidden className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

export type SelectLabelProps = ComponentProps<typeof SelectPrimitive.Label>

export function SelectLabel({ className, ...props }: SelectLabelProps) {
  return <SelectPrimitive.Label className={cn(menuLabel, className)} {...props} />
}

export type SelectSeparatorProps = ComponentProps<typeof SelectPrimitive.Separator>

export function SelectSeparator({ className, ...props }: SelectSeparatorProps) {
  return <SelectPrimitive.Separator className={cn(menuSeparator, className)} {...props} />
}

/* ------------------------------------------------------------------ */
/* Convenience API                                                     */
/* ------------------------------------------------------------------ */

export interface SimpleSelectOption {
  /** Non-empty string (Radix Select does not allow ''). */
  value: string
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
  /** Typeahead text when `label` is not a plain string. */
  textValue?: string
}

export interface SimpleSelectGroup {
  label: ReactNode
  options: SimpleSelectOption[]
}

export interface SimpleSelectProps
  extends Omit<SelectTriggerProps, 'children' | 'value' | 'defaultValue' | 'dir' | 'onChange'> {
  /** Flat list of options (rendered before `groups`). */
  options?: SimpleSelectOption[]
  /** Labelled option groups (separated from each other). */
  groups?: SimpleSelectGroup[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  placeholder?: ReactNode
  /** Override what the trigger shows (defaults to the selected option's label). */
  valueLabel?: ReactNode
  required?: boolean
  contentClassName?: string
  /** Extra props for the dropdown content (side, align, …). */
  contentProps?: Omit<SelectContentProps, 'children'>
}

/**
 * One-liner select:
 * `<SimpleSelect aria-label="Model" value={v} onValueChange={setV} options={[{ value: 'I', label: 'Enigma I' }]} />`.
 * `className`, `id`, `aria-*` and other rest props go to the trigger button.
 */
export function SimpleSelect({
  options,
  groups,
  value,
  defaultValue,
  onValueChange,
  open,
  onOpenChange,
  placeholder,
  valueLabel,
  name,
  required,
  disabled,
  contentClassName,
  contentProps,
  ...triggerProps
}: SimpleSelectProps) {
  const renderOption = (o: SimpleSelectOption) => (
    <SelectItem
      key={o.value}
      value={o.value}
      disabled={o.disabled}
      description={o.description}
      textValue={o.textValue}
    >
      {o.label}
    </SelectItem>
  )
  const flat = options ?? []
  const grouped = groups ?? []
  return (
    <Select
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      open={open}
      onOpenChange={onOpenChange}
      name={name}
      required={required}
      disabled={disabled}
    >
      <SelectTrigger {...triggerProps}>
        <SelectValue placeholder={placeholder}>{valueLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent className={contentClassName} {...contentProps}>
        {flat.map(renderOption)}
        {grouped.map((g, i) => (
          <Fragment key={i}>
            {(i > 0 || flat.length > 0) && <SelectSeparator />}
            <SelectGroup>
              <SelectLabel>{g.label}</SelectLabel>
              {g.options.map(renderOption)}
            </SelectGroup>
          </Fragment>
        ))}
      </SelectContent>
    </Select>
  )
}
