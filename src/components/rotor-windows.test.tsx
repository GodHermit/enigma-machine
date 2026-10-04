import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toLetter } from '../lib/enigma'
import type { Letter } from '../lib/enigma'
import { initialData, selectCurrentPositions, useEnigmaStore } from '../state'
import { TooltipProvider } from './ui'
import { RotorWindows, STEP_FLASH_MS } from './rotor-windows'

const st = () => useEnigmaStore.getState()

const L = (ch: string): Letter => {
  const l = toLetter(ch)
  if (l === null) throw new Error(`not a letter: ${ch}`)
  return l
}

function renderStrip() {
  return render(
    <TooltipProvider>
      <RotorWindows />
    </TooltipProvider>,
  )
}

const windowOf = (name: RegExp) => screen.getByRole('spinbutton', { name })

beforeEach(() => {
  useEnigmaStore.setState(initialData())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('RotorWindows', () => {
  it('renders the reflector and the three rotor windows of Enigma I', () => {
    renderStrip()
    expect(screen.getByRole('img', { name: 'Reflector UKW-B' })).toBeInTheDocument()
    const windows = screen.getAllByRole('spinbutton')
    expect(windows).toHaveLength(3)
    const right = windowOf(/Right rotor \(III\) window/)
    expect(right).toHaveAttribute('aria-valuenow', '1')
    expect(right).toHaveAttribute('aria-valuetext', 'A')
    expect(right).toHaveTextContent('A')
    expect(screen.getByText('III · 01')).toBeInTheDocument()
    expect(screen.getByText('Left')).toBeInTheDocument()
    expect(screen.queryByText(/Start position/)).not.toBeInTheDocument()
  })

  it('chevrons and neighbour letters nudge the start position', async () => {
    const user = userEvent.setup()
    renderStrip()
    await user.click(screen.getByRole('button', { name: 'Right rotor (III): next letter' }))
    expect(st().settings.right.position).toBe(1)
    expect(windowOf(/Right rotor/)).toHaveAttribute('aria-valuetext', 'B')

    await user.click(screen.getByRole('button', { name: 'Right rotor (III): next letter C' }))
    expect(st().settings.right.position).toBe(2)

    await user.click(screen.getByRole('button', { name: 'Middle rotor (II): previous letter' }))
    expect(st().settings.middle.position).toBe(25)
    expect(windowOf(/Middle rotor/)).toHaveTextContent('Z')

    await user.click(screen.getByRole('button', { name: 'Middle rotor (II): previous letter Y' }))
    expect(st().settings.middle.position).toBe(24)
  })

  it('arrow keys on a focused window and the mouse wheel turn the rotor', async () => {
    const user = userEvent.setup()
    renderStrip()
    const left = windowOf(/Left rotor \(I\) window/)
    left.focus()
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowDown}')
    expect(st().settings.left.position).toBe(1)
    await user.keyboard('{PageDown}')
    expect(st().settings.left.position).toBe(22)

    const drum = left.parentElement
    if (!drum) throw new Error('drum missing')
    fireEvent.wheel(drum, { deltaY: 120 })
    expect(st().settings.left.position).toBe(24)
    fireEvent.wheel(drum, { deltaY: -60 })
    expect(st().settings.left.position).toBe(23)
  })

  it('shows the current positions while typing and keeps the start position', () => {
    renderStrip()
    act(() => {
      for (const ch of 'HELLO') st().pressKey(L(ch))
    })
    expect(windowOf(/Right rotor/)).toHaveTextContent('F')
    expect(windowOf(/Right rotor/)).toHaveAttribute('aria-valuetext', 'F, start position A')
    expect(st().settings.right.position).toBe(0)
    const note = screen.getByText(/current position reflects 5 key presses/)
    expect(note).toHaveTextContent('Start position: A A A — current position reflects 5 key presses')

    act(() => st().clearInput())
    expect(screen.queryByText(/Start position/)).not.toBeInTheDocument()
    expect(windowOf(/Right rotor/)).toHaveTextContent('A')
  })

  it('flashes the rotors that stepped and marks a double step', () => {
    vi.useFakeTimers()
    act(() => {
      st().setPosition('left', 0)
      st().setPosition('middle', 3)
      st().setPosition('right', 20) // A D U
    })
    renderStrip()
    const left = windowOf(/Left rotor/)
    const middle = windowOf(/Middle rotor/)
    const right = windowOf(/Right rotor/)

    act(() => st().pressKey(L('A'))) // ADV: right only
    expect(right).toHaveAttribute('data-stepped')
    expect(middle).not.toHaveAttribute('data-stepped')
    expect(screen.queryByText('double step')).not.toBeInTheDocument()

    act(() => st().pressKey(L('A'))) // AEW: right + middle
    expect(middle).toHaveAttribute('data-stepped')
    expect(left).not.toHaveAttribute('data-stepped')

    act(() => st().pressKey(L('A'))) // BFX: double step
    expect(left).toHaveAttribute('data-stepped')
    expect(middle).toHaveAttribute('data-stepped')
    expect(screen.getByText('double step')).toBeInTheDocument()
    expect(left).toHaveTextContent('B')
    expect(middle).toHaveTextContent('F')
    expect(right).toHaveTextContent('X')

    act(() => vi.advanceTimersByTime(STEP_FLASH_MS + 10))
    expect(left).not.toHaveAttribute('data-stepped')
    expect(middle).not.toHaveAttribute('data-stepped')
    expect(right).not.toHaveAttribute('data-stepped')
  })

  it('renders the Greek wheel and thin reflector on the M4 and honours the ring display option', () => {
    act(() => {
      st().setModel('M4')
      st().setRing('right', 1)
      st().setOption('ringDisplay', 'letter')
    })
    renderStrip()
    const reflector = screen.getByRole('img', { name: 'Reflector UKW-B (thin)' })
    expect(within(reflector).getByText('thin')).toBeInTheDocument()
    expect(screen.getAllByRole('spinbutton')).toHaveLength(4)
    const greek = windowOf(/Greek wheel \(Beta\) window/)
    expect(screen.getByText('Greek')).toBeInTheDocument()
    expect(screen.getByText('Beta · A')).toBeInTheDocument()
    expect(screen.getByText(`${st().settings.right.rotor} · B`)).toBeInTheDocument()

    greek.focus()
    fireEvent.keyDown(greek, { key: 'ArrowDown' })
    expect(st().settings.greek?.position).toBe(25)
    expect(selectCurrentPositions(st()).greek).toBe(25)
  })
})
