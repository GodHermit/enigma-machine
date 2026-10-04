import type { ComponentProps, ReactNode } from 'react'
import { DropdownMenu as MenuPrimitive } from 'radix-ui'
import { CheckIcon, ChevronRightIcon } from 'lucide-react'
import { cn } from '../../lib/cn'
import { menuContent, menuItem, menuLabel, menuSeparator } from './styles'

export const DropdownMenu = MenuPrimitive.Root
export const DropdownMenuTrigger = MenuPrimitive.Trigger
export const DropdownMenuGroup = MenuPrimitive.Group
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup
export const DropdownMenuSub = MenuPrimitive.Sub

export type DropdownMenuContentProps = ComponentProps<typeof MenuPrimitive.Content>

/** Menu panel in a Portal (z-50), 4px from the trigger, scrolls if taller than the viewport. */
export function DropdownMenuContent({
  className,
  sideOffset = 4,
  align = 'end',
  ...props
}: DropdownMenuContentProps) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          menuContent,
          'max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  )
}

export interface DropdownMenuItemProps extends ComponentProps<typeof MenuPrimitive.Item> {
  /** Leading icon (16px). */
  icon?: ReactNode
  /** Trailing shortcut hint, e.g. "⌘C". */
  shortcut?: ReactNode
  /** Indent to align with items that have an icon. */
  inset?: boolean
}

export function DropdownMenuItem({
  className,
  icon,
  shortcut,
  inset,
  children,
  ...props
}: DropdownMenuItemProps) {
  return (
    <MenuPrimitive.Item className={cn(menuItem, inset && 'pl-9', className)} {...props}>
      {icon != null && (
        <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut != null && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
    </MenuPrimitive.Item>
  )
}

export interface DropdownMenuCheckboxItemProps
  extends ComponentProps<typeof MenuPrimitive.CheckboxItem> {
  shortcut?: ReactNode
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  shortcut,
  ...props
}: DropdownMenuCheckboxItemProps) {
  return (
    <MenuPrimitive.CheckboxItem className={cn(menuItem, 'pl-9', className)} {...props}>
      <span className="absolute left-3 flex size-4 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <CheckIcon aria-hidden />
        </MenuPrimitive.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut != null && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
    </MenuPrimitive.CheckboxItem>
  )
}

export type DropdownMenuRadioItemProps = ComponentProps<typeof MenuPrimitive.RadioItem>

export function DropdownMenuRadioItem({ className, children, ...props }: DropdownMenuRadioItemProps) {
  return (
    <MenuPrimitive.RadioItem className={cn(menuItem, 'pl-9', className)} {...props}>
      <span className="absolute left-3 flex size-4 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <span aria-hidden className="block size-2 rounded-full bg-current" />
        </MenuPrimitive.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </MenuPrimitive.RadioItem>
  )
}

export interface DropdownMenuLabelProps extends ComponentProps<typeof MenuPrimitive.Label> {
  inset?: boolean
}

export function DropdownMenuLabel({ className, inset, ...props }: DropdownMenuLabelProps) {
  return <MenuPrimitive.Label className={cn(menuLabel, inset && 'pl-9', className)} {...props} />
}

export type DropdownMenuSeparatorProps = ComponentProps<typeof MenuPrimitive.Separator>

export function DropdownMenuSeparator({ className, ...props }: DropdownMenuSeparatorProps) {
  return <MenuPrimitive.Separator className={cn(menuSeparator, className)} {...props} />
}

export type DropdownMenuShortcutProps = ComponentProps<'span'>

export function DropdownMenuShortcut({ className, ...props }: DropdownMenuShortcutProps) {
  return (
    <span className={cn('ml-auto pl-4 text-xs tracking-widest text-muted', className)} {...props} />
  )
}

export interface DropdownMenuSubTriggerProps extends ComponentProps<typeof MenuPrimitive.SubTrigger> {
  icon?: ReactNode
  inset?: boolean
}

export function DropdownMenuSubTrigger({
  className,
  icon,
  inset,
  children,
  ...props
}: DropdownMenuSubTriggerProps) {
  return (
    <MenuPrimitive.SubTrigger
      className={cn(menuItem, 'data-[state=open]:bg-surface-2', inset && 'pl-9', className)}
      {...props}
    >
      {icon != null && (
        <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ChevronRightIcon aria-hidden className="ml-auto" />
    </MenuPrimitive.SubTrigger>
  )
}

export type DropdownMenuSubContentProps = ComponentProps<typeof MenuPrimitive.SubContent>

export function DropdownMenuSubContent({
  className,
  sideOffset = 6,
  ...props
}: DropdownMenuSubContentProps) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.SubContent
        sideOffset={sideOffset}
        className={cn(
          menuContent,
          'max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  )
}
