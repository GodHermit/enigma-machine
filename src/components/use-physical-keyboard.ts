import { useEffect } from 'react'
import { toLetter } from '../lib/enigma'
import type { Letter } from '../lib/enigma'
import { useEnigmaStore } from '../state'

/** Elements (or ancestors) that own their own key handling: typing there must not press Enigma keys. */
const OWN_KEYS_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]',
  '[role="spinbutton"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="menubar"]',
].join(',')

/** Open overlays (Radix poppers: select / menu / popover / tooltip-like content, open modals). */
const OPEN_OVERLAY_SELECTOR =
  '[data-radix-popper-content-wrapper],[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]'

function ownsKeys(node: EventTarget | Element | null): boolean {
  if (!(node instanceof Element)) return false
  if (node instanceof HTMLElement && node.isContentEditable) return true
  return node.closest(OWN_KEYS_SELECTOR) !== null
}

/**
 * True when a key event must be left alone: modifier shortcuts, IME composition, an already
 * handled event, focus in a text field / select / dialog / menu, or an open Radix overlay.
 */
export function shouldIgnoreKeyEvent(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) return true
  if (event.ctrlKey || event.metaKey || event.altKey) return true
  if (ownsKeys(event.target)) return true
  if (typeof document !== 'undefined') {
    if (ownsKeys(document.activeElement)) return true
    if (document.querySelector(OPEN_OVERLAY_SELECTOR) !== null) return true
  }
  return false
}

/**
 * The Enigma letter of a key event: the typed Latin letter (any case), or — for non-Latin
 * layouts such as Cyrillic — the physical key position (`KeyA`…`KeyZ`). null otherwise.
 */
export function keyEventLetter(event: Pick<KeyboardEvent, 'key' | 'code'>): Letter | null {
  if (event.key.length === 1 && /^[a-z]$/i.test(event.key)) return toLetter(event.key)
  if (event.key.length === 1 && !/^[\x20-\x7e]$/.test(event.key)) {
    const match = /^Key([A-Z])$/.exec(event.code)
    if (match) return toLetter(match[1])
  }
  return null
}

export interface UsePhysicalKeyboardOptions {
  /** Listen for key presses (default true). */
  enabled?: boolean
}

/**
 * Lets the computer keyboard drive the Enigma keyboard: letters A–Z press keys, Backspace
 * undoes the last key. Mount once (App does). Ignores modifier shortcuts and keys
 * typed into text fields, selects, dialogs, menus or while a Radix overlay is open.
 */
export function usePhysicalKeyboard({ enabled = true }: UsePhysicalKeyboardOptions = {}): void {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreKeyEvent(event)) return
      if (event.key === 'Backspace') {
        event.preventDefault()
        useEnigmaStore.getState().backspace()
        return
      }
      const letter = keyEventLetter(event)
      if (letter === null) return
      event.preventDefault()
      useEnigmaStore.getState().pressKey(letter)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
