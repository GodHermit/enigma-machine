import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { encryptLetters, toLetter } from '../lib/enigma'
import type { Letter } from '../lib/enigma'
import { initialData, useEnigmaStore } from '../state'
import { TextIO } from './text-io'

const st = () => useEnigmaStore.getState()

const L = (ch: string): Letter => {
  const l = toLetter(ch)
  if (l === null) throw new Error(`not a letter: ${ch}`)
  return l
}

function outputBox() {
  return screen.getByRole('textbox', { name: 'Output:' })
}

function tape() {
  return screen.getByRole('listbox', { name: 'Keystrokes:' })
}

beforeAll(() => {
  // Radix tooltips measure their arrow with ResizeObserver, which jsdom lacks.
  if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

beforeEach(() => {
  useEnigmaStore.setState(initialData())
})

describe('TextIO', () => {
  it('shows the empty state', () => {
    render(<TextIO />)
    expect(screen.getByLabelText('Input:')).toHaveValue('')
    expect(screen.getByText('No keys pressed yet.')).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy output' })).toBeDisabled()
  })

  it('typing in the textarea drives store.input and enciphers AAAAA → BDZGO', async () => {
    const user = userEvent.setup()
    render(<TextIO />)
    const input = screen.getByLabelText('Input:')
    await user.type(input, 'aaaaa')
    expect(st().input).toBe('aaaaa')
    expect(st().pressId).toBe(0)
    expect(outputBox()).toHaveTextContent('BDZGO')
    expect(input).toHaveAccessibleDescription('5 enciphered letters')
    expect(outputBox()).toHaveAccessibleDescription('5 enciphered letters')
  })

  it('reflects store input changes from key presses', () => {
    render(<TextIO />)
    act(() => {
      for (const ch of 'HELLO') st().pressKey(L(ch))
    })
    expect(screen.getByLabelText('Input:')).toHaveValue('HELLO')
    expect(outputBox()).toHaveTextContent(encryptLetters(st().settings, 'HELLO'))
    expect(within(tape()).getAllByRole('option')).toHaveLength(5)
  })

  it('toggles "Keep spaces & punctuation"', async () => {
    const user = userEvent.setup()
    act(() => st().setInput('AA AAA'))
    render(<TextIO />)
    expect(outputBox().textContent).toBe('BD ZGO')
    const keep = screen.getByRole('switch', { name: 'Keep spaces & punctuation' })
    expect(keep).toBeChecked()
    await user.click(keep)
    expect(st().options.nonLetters).toBe('remove')
    expect(outputBox().textContent).toBe('BDZGO')
  })

  it('groups the output in fives (display only)', async () => {
    const user = userEvent.setup()
    const text = 'HELLO WORLD, THIS IS\nENIGMA'
    act(() => st().setInput(text))
    render(<TextIO />)
    const letters = encryptLetters(st().settings, text)
    await user.click(screen.getByRole('switch', { name: 'Group output in fives' }))
    expect(st().options.groupOutput).toBe(true)
    const expected = `${letters.slice(0, 5)} ${letters.slice(5, 10)}, ${letters.slice(10, 15)} ${letters.slice(15, 16)}\n${letters.slice(16, 21)} ${letters.slice(21)}`
    expect(outputBox().textContent).toBe(expected)
    // The underlying input is untouched.
    expect(st().input).toBe(text)
  })

  it('clicking an output letter selects its trace and highlights it on the tape', async () => {
    const user = userEvent.setup()
    act(() => st().setInput('AB CDE'))
    render(<TextIO />)
    const box = outputBox()
    const spans = box.querySelectorAll<HTMLElement>('[data-trace]')
    expect(spans).toHaveLength(5)
    // Latest key is active by default.
    expect(spans[4]).toHaveAttribute('data-active')
    await user.click(spans[2])
    expect(st().selectedTrace).toBe(2)
    expect(box.querySelector('[data-trace="2"]')).toHaveAttribute('data-active')
    expect(box.querySelector('[data-trace="4"]')).not.toHaveAttribute('data-active')
    const options = within(tape()).getAllByRole('option')
    expect(options[2]).toHaveAttribute('aria-selected', 'true')
    expect(options[4]).toHaveAttribute('aria-selected', 'false')
  })

  it('clicking a tape column selects the trace and the keyboard moves the selection', async () => {
    const user = userEvent.setup()
    act(() => st().setInput('AAAAA'))
    render(<TextIO />)
    const options = within(tape()).getAllByRole('option')
    expect(options[0]).toHaveAccessibleName('Keystroke 1: A enciphered to B')
    expect(options[4]).toHaveAttribute('tabindex', '0')
    expect(options[0]).toHaveAttribute('tabindex', '-1')

    await user.click(options[1])
    expect(st().selectedTrace).toBe(1)
    expect(outputBox().querySelector('[data-trace="1"]')).toHaveAttribute('data-active')
    expect(within(tape()).getAllByRole('option')[1]).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(st().selectedTrace).toBe(2)
    expect(within(tape()).getAllByRole('option')[2]).toHaveFocus()
    await user.keyboard('{Home}')
    expect(st().selectedTrace).toBe(0)
    await user.keyboard('{ArrowLeft}')
    expect(st().selectedTrace).toBe(0)
    await user.keyboard('{End}')
    expect(st().selectedTrace).toBe(4)
  })

  it('copies the displayed output and shows feedback', async () => {
    const user = userEvent.setup()
    act(() => {
      st().setInput('AAAAAAA')
      st().setOption('groupOutput', true)
    })
    render(<TextIO />)
    await user.click(screen.getByRole('button', { name: 'Copy output' }))
    const letters = encryptLetters(st().settings, 'AAAAAAA')
    await expect(navigator.clipboard.readText()).resolves.toBe(
      `${letters.slice(0, 5)} ${letters.slice(5)}`,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Copied!')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Copied!')
  })

  it('caps the tape to the last 500 keystrokes', () => {
    act(() => st().setInput('A'.repeat(600)))
    render(<TextIO />)
    const options = within(tape()).getAllByRole('option')
    expect(options).toHaveLength(500)
    expect(options[0]).toHaveAccessibleName(/^Keystroke 101:/)
    expect(screen.getByText('Showing the last 500 of 600')).toBeInTheDocument()
  })

  it('shifts the tape window to an older selected keystroke', () => {
    act(() => {
      st().setInput('A'.repeat(1200))
      st().selectTrace(10)
    })
    render(<TextIO />)
    const options = within(tape()).getAllByRole('option')
    expect(options).toHaveLength(500)
    expect(options[0]).toHaveAccessibleName(/^Keystroke 1:/)
    expect(options[10]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Showing 1–500 of 1200')).toBeInTheDocument()
  })

  it('renders long output as plain text', () => {
    act(() => st().setInput('A'.repeat(2500)))
    render(<TextIO />)
    const box = outputBox()
    expect(box.querySelector('[data-trace]')).toBeNull()
    expect(box.textContent).toHaveLength(2500)
  })
})
