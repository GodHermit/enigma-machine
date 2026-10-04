import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { formatPlugboard, parsePlugboard, toLetter } from '../lib/enigma'
import type { Letter } from '../lib/enigma'
import { initialData, selectActiveTrace, useEnigmaStore } from '../state'
import { Plugboard } from './plugboard'

const L = (ch: string): Letter => {
  const l = toLetter(ch)
  if (l === null) throw new Error(`not a letter: ${ch}`)
  return l
}

const st = () => useEnigmaStore.getState()
const plugText = () => formatPlugboard(st().settings.plugboard)
const socket = (letter: string) =>
  screen.getByRole('button', { name: new RegExp(`^Socket ${letter},`) })
const textbox = () => screen.getByLabelText('Plugboard:')
const cable = (container: HTMLElement, pair: string) =>
  container.querySelector(`[data-cable="${pair}"]`)

beforeEach(() => {
  useEnigmaStore.setState(initialData())
})

describe('Plugboard text control', () => {
  it('renders the label, empty count, 26 sockets and the helper text', () => {
    render(<Plugboard />)
    expect(textbox()).toHaveAttribute('placeholder', 'e.g. AB CD EF')
    expect(screen.getByText('0/13')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Socket [A-Z],/ })).toHaveLength(26)
    expect(
      screen.getByText('Click two letters to connect them with a cable. Historically 10 cables were used.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear plugboard' })).toBeDisabled()
  })

  it('updates the store live while typing and normalises on blur', async () => {
    const user = userEvent.setup()
    render(<Plugboard />)
    await user.type(textbox(), 'ab-cd,e')
    expect(plugText()).toBe('AB CD')
    expect(textbox()).toHaveValue('ab-cd,e')
    expect(screen.getByText('2/13')).toBeInTheDocument()
    // The unfinished trailing letter is not reported while typing.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.type(textbox(), 'f')
    expect(plugText()).toBe('AB CD EF')
    expect(socket('E')).toHaveAccessibleName('Socket E, connected to F')

    await user.tab()
    expect(textbox()).toHaveValue('AB CD EF')
  })

  it('shows parse errors and keeps the valid pairs', async () => {
    const user = userEvent.setup()
    render(<Plugboard />)
    await user.type(textbox(), 'AB AC Q1')
    expect(plugText()).toBe('AB')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('AC: letter A is already plugged.')
    expect(alert).toHaveTextContent('"Q1" contains characters other than A–Z.')
    expect(textbox()).toHaveAttribute('aria-invalid', 'true')

    await user.tab()
    expect(textbox()).toHaveValue('AB')
    // Errors stay visible after blur so the user knows what was dropped…
    expect(screen.getByRole('alert')).toHaveTextContent('AC: letter A is already plugged.')
    // …until the plugboard changes from elsewhere.
    act(() => st().togglePlug(L('X'), L('Y')))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports an unfinished pair once the field loses focus', async () => {
    const user = userEvent.setup()
    render(<Plugboard />)
    await user.type(textbox(), 'AB C')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.tab()
    expect(screen.getByRole('alert')).toHaveTextContent('"C" is not a pair of letters.')
  })

  it('stays in sync with store changes from elsewhere', () => {
    render(<Plugboard />)
    act(() => st().setPlugboard(parsePlugboard('QW ER TY').pairs))
    expect(textbox()).toHaveValue('QW ER TY')
    expect(screen.getByText('3/13')).toBeInTheDocument()
    act(() => st().randomize())
    expect(textbox()).toHaveValue(plugText())
    expect(screen.getByText(`${st().settings.plugboard.length}/13`)).toBeInTheDocument()
  })

  it('replaces the draft when the store changes while the field is focused', async () => {
    const user = userEvent.setup()
    render(<Plugboard />)
    await user.type(textbox(), 'ab')
    expect(textbox()).toHaveFocus()
    act(() => st().setPlugboard(parsePlugboard('MN').pairs))
    expect(textbox()).toHaveValue('MN')
  })

  it('clears every cable with the clear button', async () => {
    const user = userEvent.setup()
    act(() => st().setPlugboard(parsePlugboard('AB CD').pairs))
    render(<Plugboard />)
    await user.click(screen.getByRole('button', { name: 'Clear plugboard' }))
    expect(st().settings.plugboard).toEqual([])
    expect(textbox()).toHaveValue('')
    expect(textbox()).toHaveFocus()
    expect(screen.getByText('0/13')).toBeInTheDocument()
  })
})

describe('Plugboard sockets', () => {
  it('connects two clicked sockets and draws a cable', async () => {
    const user = userEvent.setup()
    const { container } = render(<Plugboard />)
    await user.click(socket('A'))
    expect(socket('A')).toHaveAttribute('data-pending')
    expect(socket('A')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/A selected/)).toBeInTheDocument()

    await user.click(socket('Q'))
    expect(plugText()).toBe('AQ')
    expect(socket('A')).toHaveAccessibleName('Socket A, connected to Q')
    expect(socket('Q')).toHaveAccessibleName('Socket Q, connected to A')
    expect(socket('A')).not.toHaveAttribute('data-pending')
    expect(textbox()).toHaveValue('AQ')
    expect(cable(container, 'AQ')).not.toBeNull()
    expect(screen.getByText('Connected A and Q.')).toBeInTheDocument()
  })

  it('unplugs a connected socket when nothing is pending', async () => {
    const user = userEvent.setup()
    act(() => st().setPlugboard(parsePlugboard('AQ ZX').pairs))
    const { container } = render(<Plugboard />)
    await user.click(socket('Q'))
    expect(plugText()).toBe('ZX')
    expect(socket('A')).toHaveAccessibleName('Socket A, not connected')
    expect(socket('A')).toHaveAttribute('aria-pressed', 'false')
    expect(cable(container, 'AQ')).toBeNull()
    expect(screen.getByText('Unplugged Q–A.')).toBeInTheDocument()
  })

  it('re-plugs a pending socket onto an already connected one', async () => {
    const user = userEvent.setup()
    act(() => st().setPlugboard(parsePlugboard('BC').pairs))
    render(<Plugboard />)
    await user.click(socket('A'))
    await user.click(socket('B'))
    expect(plugText()).toBe('AB')
  })

  it('cancels a pending socket with a second click or Escape', async () => {
    const user = userEvent.setup()
    render(<Plugboard />)
    await user.click(socket('A'))
    await user.click(socket('A'))
    expect(socket('A')).not.toHaveAttribute('data-pending')
    expect(st().settings.plugboard).toEqual([])

    await user.click(socket('S'))
    expect(socket('S')).toHaveAttribute('data-pending')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(socket('S')).not.toHaveAttribute('data-pending')
    await user.click(socket('D'))
    expect(socket('D')).toHaveAttribute('data-pending')
    expect(st().settings.plugboard).toEqual([])
  })

  it('is keyboard operable', async () => {
    const user = userEvent.setup()
    render(<Plugboard />)
    socket('P').focus()
    await user.keyboard('{Enter}')
    socket('L').focus()
    await user.keyboard(' ')
    expect(plugText()).toBe('PL')
  })

  it('shows the full-board hint with all 13 cables plugged', async () => {
    const user = userEvent.setup()
    act(() => st().setPlugboard(parsePlugboard('AB CD EF GH IJ KL MN OP QR ST UV WX YZ').pairs))
    render(<Plugboard />)
    expect(screen.getByText('13/13')).toBeInTheDocument()
    expect(screen.getByText(/All 13 cables are in use/)).toBeInTheDocument()
    await user.click(socket('A'))
    expect(plugText()).toBe('CD EF GH IJ KL MN OP QR ST UV WX YZ')
    expect(screen.queryByText(/All 13 cables are in use/)).not.toBeInTheDocument()
  })

  it('highlights the sockets and cables used by the active trace', () => {
    act(() => {
      st().setOption('animate', false)
      st().setPlugboard(parsePlugboard('AC').pairs)
      st().pressKey(L('A'))
    })
    const { container } = render(<Plugboard />)
    const trace = selectActiveTrace(st())
    if (trace === null) throw new Error('expected a trace')
    const back = trace.stages.find((s) => s.kind === 'plugboard' && s.direction === 'backward')
    if (back === undefined) throw new Error('expected a return plugboard stage')
    const ch = (l: number) => String.fromCharCode(65 + l)
    const ret = new Set([ch(back.input), ch(back.output)])
    const expected = (letter: string, fwd: boolean) =>
      fwd && ret.has(letter) ? 'both' : fwd ? 'in' : 'out'

    expect(socket('A')).toHaveAttribute('data-signal', expected('A', true))
    expect(socket('C')).toHaveAttribute('data-signal', expected('C', true))
    expect(cable(container, 'AC')).toHaveAttribute('data-signal', ret.has('A') && ret.has('C') ? 'both' : 'in')
    for (const letter of ret) {
      if (letter !== 'A' && letter !== 'C') expect(socket(letter)).toHaveAttribute('data-signal', 'out')
    }
    expect(container.querySelectorAll('button[data-signal]').length).toBe(new Set(['A', 'C', ...ret]).size)
  })

  it('marks a cable used on the way in and out', () => {
    // Enigma I defaults encipher the first A as B, so with A–B plugged the same cable
    // carries the signal in (A → B) and out (A → B lamp).
    act(() => {
      st().setOption('animate', false)
      st().setPlugboard(parsePlugboard('AB').pairs)
      st().pressKey(L('A'))
    })
    const { container } = render(<Plugboard />)
    expect(selectActiveTrace(st())?.output).toBe(L('B'))
    expect(socket('A')).toHaveAttribute('data-signal', 'both')
    expect(socket('B')).toHaveAttribute('data-signal', 'both')
    expect(cable(container, 'AB')).toHaveAttribute('data-signal', 'both')
  })

  it('only highlights stages already revealed by playback', () => {
    act(() => {
      st().setPlugboard(parsePlugboard('AC').pairs)
      st().pressKey(L('A'))
      st().pause()
      st().setStageCursor(1)
    })
    const { container } = render(<Plugboard />)
    expect(socket('A')).not.toHaveAttribute('data-signal')
    expect(cable(container, 'AC')).not.toHaveAttribute('data-signal')
    act(() => st().setStageCursor(2))
    expect(socket('A')).toHaveAttribute('data-signal')
    expect(cable(container, 'AC')).toHaveAttribute('data-signal')
  })
})
