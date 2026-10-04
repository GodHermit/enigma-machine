import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { toLetter } from '../lib/enigma'
import type { Letter } from '../lib/enigma'
import { initialData, selectStageCount, useEnigmaStore } from '../state'
import { Lampboard } from './lampboard'

const L = (ch: string): Letter => toLetter(ch) as Letter
const st = () => useEnigmaStore.getState()

function litLamps(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-lit]')).map(
    (el) => el.getAttribute('data-letter') ?? '',
  )
}

beforeEach(() => {
  useEnigmaStore.setState(initialData())
})

describe('Lampboard', () => {
  it('renders 26 lamps in the QWERTZ rows with the label', () => {
    const { container } = render(<Lampboard />)
    expect(screen.getByRole('heading', { name: 'Lampboard:' })).toBeInTheDocument()
    const lamps = container.querySelectorAll('[data-letter]')
    expect(lamps).toHaveLength(26)
    expect(Array.from(lamps, (el) => el.textContent).join('')).toBe('QWERTZUIOASDFGHJKPYXCVBNML')
    expect(litLamps(container)).toEqual([])
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('lights the output lamp of the last key press when not animating', () => {
    act(() => st().setOption('animate', false))
    const { container } = render(<Lampboard />)
    act(() => st().pressKey(L('A'))) // AAAAA → BDZGO
    expect(litLamps(container)).toEqual(['B'])
    const lamp = container.querySelector('[data-letter="B"]')
    expect(lamp?.className).toContain('lamp')
    expect(lamp?.className).toContain('text-lamp-letter')
    expect(screen.getByRole('status')).toHaveTextContent('Lamp B lit')

    act(() => st().pressKey(L('A')))
    expect(litLamps(container)).toEqual(['D'])
    expect(screen.getByRole('status')).toHaveTextContent('Lamp D lit')
  })

  it('waits until the playback reaches the lampboard', () => {
    const { container } = render(<Lampboard />)
    act(() => st().pressKey(L('A'))) // animate is on by default → stageCursor 0
    expect(st().stageCursor).toBe(0)
    expect(litLamps(container)).toEqual([])

    const stages = selectStageCount(st())
    act(() => st().setStageCursor(stages - 1))
    expect(litLamps(container)).toEqual([])

    act(() => st().pause())
    act(() => st().setStageCursor(stages))
    expect(litLamps(container)).toEqual(['B'])
    expect(screen.getByRole('status')).toHaveTextContent('Lamp B lit')
  })

  it('follows the selected trace and goes dark when the input is cleared', () => {
    act(() => st().setOption('animate', false))
    const { container } = render(<Lampboard />)
    act(() => st().typeText('AAAAA'))
    expect(litLamps(container)).toEqual(['O'])
    act(() => st().selectTrace(2))
    expect(litLamps(container)).toEqual(['Z'])
    act(() => st().clearInput())
    expect(litLamps(container)).toEqual([])
    expect(screen.getByRole('status')).toHaveTextContent('')
  })
})
