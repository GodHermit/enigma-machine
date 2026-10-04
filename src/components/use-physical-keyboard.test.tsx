import { fireEvent, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initialData, useEnigmaStore } from '../state'
import { keyEventLetter, usePhysicalKeyboard } from './use-physical-keyboard'

const st = () => useEnigmaStore.getState()

beforeEach(() => {
  useEnigmaStore.setState(initialData())
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('keyEventLetter', () => {
  it('maps Latin letters of any case and physical keys of non-Latin layouts', () => {
    expect(keyEventLetter({ key: 'a', code: 'KeyA' })).toBe(0)
    expect(keyEventLetter({ key: 'Z', code: 'KeyY' })).toBe(25) // German layout: typed letter wins
    expect(keyEventLetter({ key: 'ф', code: 'KeyA' })).toBe(0) // Ukrainian layout
    expect(keyEventLetter({ key: '1', code: 'Digit1' })).toBeNull()
    expect(keyEventLetter({ key: ';', code: 'KeyA' })).toBeNull()
    expect(keyEventLetter({ key: 'Enter', code: 'Enter' })).toBeNull()
  })
})

describe('usePhysicalKeyboard', () => {
  it('presses letters and undoes with Backspace', () => {
    renderHook(() => usePhysicalKeyboard())
    fireEvent.keyDown(window, { key: 'a', code: 'KeyA' })
    fireEvent.keyDown(document.body, { key: 'B', code: 'KeyB', shiftKey: true })
    fireEvent.keyDown(window, { key: 'c', code: 'KeyC', repeat: true })
    expect(st().input).toBe('ABC')
    expect(st().pressId).toBe(3)

    const backspace = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
    window.dispatchEvent(backspace)
    expect(backspace.defaultPrevented).toBe(true)
    expect(st().input).toBe('AB')
  })

  it('ignores modifier shortcuts, other keys and handled events', () => {
    renderHook(() => usePhysicalKeyboard())
    fireEvent.keyDown(window, { key: 'c', code: 'KeyC', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'v', code: 'KeyV', metaKey: true })
    fireEvent.keyDown(window, { key: 'x', code: 'KeyX', altKey: true })
    fireEvent.keyDown(window, { key: '1', code: 'Digit1' })
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    const handled = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    handled.preventDefault()
    window.dispatchEvent(handled)
    expect(st().input).toBe('')
  })

  it('ignores typing in text fields, selects, contenteditable and comboboxes', () => {
    renderHook(() => usePhysicalKeyboard())
    const { container } = render(
      <div>
        <input aria-label="text" />
        <textarea aria-label="area" />
        <select aria-label="sel">
          <option>A</option>
        </select>
        <div contentEditable suppressContentEditableWarning>
          <span data-testid="inner">edit</span>
        </div>
        <button type="button" role="combobox" aria-expanded="false" aria-controls="x">
          Rotor
        </button>
        <button type="button">Plain</button>
      </div>,
    )
    for (const selector of ['input', 'textarea', 'select', '[data-testid="inner"]', '[role="combobox"]']) {
      const el = container.querySelector(selector) as HTMLElement
      fireEvent.keyDown(el, { key: 'q', code: 'KeyQ' })
      fireEvent.keyDown(el, { key: 'Backspace', code: 'Backspace' })
    }
    expect(st().input).toBe('')

    const input = container.querySelector('input') as HTMLInputElement
    input.focus()
    fireEvent.keyDown(window, { key: 'q', code: 'KeyQ' })
    expect(st().input).toBe('')
    input.blur()

    const plain = container.querySelector('button:not([role])') as HTMLButtonElement
    plain.focus()
    fireEvent.keyDown(plain, { key: 'q', code: 'KeyQ' })
    expect(st().input).toBe('Q')
  })

  it('ignores keys inside dialogs / menus and while a Radix overlay is open', () => {
    renderHook(() => usePhysicalKeyboard())
    const { container, rerender } = render(
      <div>
        <div role="dialog">
          <button type="button">In dialog</button>
        </div>
        <div role="menu">
          <div role="menuitem" tabIndex={-1}>
            Item
          </div>
        </div>
        <div role="listbox">
          <div role="option" aria-selected="false">
            Option
          </div>
        </div>
      </div>,
    )
    for (const selector of ['[role="dialog"] button', '[role="menuitem"]', '[role="option"]']) {
      fireEvent.keyDown(container.querySelector(selector) as HTMLElement, { key: 'w', code: 'KeyW' })
    }
    expect(st().input).toBe('')

    rerender(<div data-radix-popper-content-wrapper="">tooltip-like overlay</div>)
    fireEvent.keyDown(window, { key: 'w', code: 'KeyW' })
    expect(st().input).toBe('')

    rerender(<div>closed</div>)
    fireEvent.keyDown(window, { key: 'w', code: 'KeyW' })
    expect(st().input).toBe('W')
  })

  it('stops listening when disabled or unmounted', () => {
    const { rerender, unmount } = renderHook(({ enabled }) => usePhysicalKeyboard({ enabled }), {
      initialProps: { enabled: false },
    })
    fireEvent.keyDown(window, { key: 'e', code: 'KeyE' })
    expect(st().input).toBe('')
    rerender({ enabled: true })
    fireEvent.keyDown(window, { key: 'e', code: 'KeyE' })
    expect(st().input).toBe('E')
    unmount()
    fireEvent.keyDown(window, { key: 'e', code: 'KeyE' })
    expect(st().input).toBe('E')
  })
})
