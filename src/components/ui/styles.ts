/**
 * Shared class strings for the UI kit (Bootstrap 5 look of the reference site).
 */

/**
 * Keyboard focus indicator for buttons, cells, triggers: no outline or glow —
 * the element's own border turns black (like the reference's active tape cell).
 */
export const focusRing = 'outline-none focus-visible:border-fg-emphasis'

/** Focus style for text controls (`.form-control`): like the reference, no outline, no glow, border unchanged. */
export const controlFocus = 'outline-none'

/** `.form-control` base (40px tall at 16px font with 2px borders). */
export const controlBase =
  'block w-full min-w-0 rounded-md border border-border bg-bg px-3 py-1.5 text-base leading-6 font-medium text-fg placeholder:text-muted placeholder:font-normal transition-[border-color,box-shadow] hover:border-border-strong disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-[.65]'

/** Bootstrap `.dropdown-menu` look shared by Select / DropdownMenu / Popover content. */
export const menuContent =
  'z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-bg p-2 text-base text-fg shadow-menu outline-none'

/** Bootstrap `.dropdown-item` with 4px rounded items, 4px apart (not next to separators/labels). */
export const menuItem =
  'relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm [[role^=menuitem]+&]:mt-1 px-3 py-1.5 leading-6 outline-none data-highlighted:bg-surface-2 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0'

export const menuLabel = 'px-3 py-1 text-sm font-normal text-muted'

/** 2px dashed divider, inset from the menu edges (aligned with the item highlight). */
export const menuSeparator = 'mx-2 my-2 h-0 border-t-2 border-dashed border-border'

/**
 * Joins direct children like a Bootstrap `.input-group`: borders collapse
 * (-2px, the border width), only the outer corners are rounded, hovered/focused child on top.
 */
export const joinedChildren =
  '[&>*]:relative [&>*]:rounded-none [&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md [&>*:not(:first-child)]:-ml-0.5 [&>*:hover]:z-[5] [&>*:focus-visible]:z-20 [&>*:focus-within]:z-20'
