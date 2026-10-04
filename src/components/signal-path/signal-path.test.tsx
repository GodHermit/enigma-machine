import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { defaultSettings, toLetter } from '../../lib/enigma'
import { initialData, useEnigmaStore } from '../../state'
import { SignalPath } from './index'

beforeAll(() => {
  // Radix Slider measures its thumb; jsdom has no ResizeObserver.
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  }
})

beforeEach(() => {
  useEnigmaStore.setState(initialData())
})

afterEach(() => {
  vi.useRealTimers()
})

function press(text: string) {
  act(() => {
    for (const ch of text) useEnigmaStore.getState().pressKey(toLetter(ch)!)
  })
}

function setAnimate(on: boolean) {
  act(() => useEnigmaStore.getState().setOption('animate', on))
}

function visibleStages(container: HTMLElement): number[] {
  return [...container.querySelectorAll('[data-layer="active"] [data-stage]')].map((el) =>
    Number(el.getAttribute('data-stage')),
  )
}

describe('SignalPath', () => {
  it('shows the empty state with disabled playback controls', () => {
    const { container } = render(<SignalPath />)
    expect(screen.getByRole('heading', { name: 'Signal path:' })).toBeInTheDocument()
    expect(screen.getByText('Press a key to see the signal path')).toBeInTheDocument()
    expect(screen.getByText('No key pressed yet')).toBeInTheDocument()
    for (const name of ['Play', 'Step', 'Back', 'Show all']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    expect(screen.getByRole('button', { name: 'Previous key press' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next key press' })).toBeDisabled()
    // Faint wiring is drawn for all three rotors even without a key press.
    expect(container.querySelectorAll('[data-wires]').length).toBeGreaterThanOrEqual(6)
    expect(container.querySelector('[data-layer="active"]')).toBeNull()
  })

  it('draws the full path, summary and trace chips for the latest key press', () => {
    setAnimate(false)
    const { container } = render(<SignalPath />)
    press('AAAAA') // → BDZGO
    expect(screen.queryByText('Press a key to see the signal path')).not.toBeInTheDocument()
    expect(screen.getByTestId('trace-picker-label')).toHaveTextContent('Key 5 of 5: A → O')
    expect(screen.getByTestId('signal-summary')).toHaveTextContent(
      'Key A lit lamp O. Right rotor stepped E → F.',
    )
    expect(new Set(visibleStages(container)).size).toBe(13)
    expect(container.querySelector('[data-lamp="O"]')).toBeInTheDocument()
    expect(container.querySelector('[data-key="A"]')).toBeInTheDocument()

    const stages = within(screen.getByRole('list', { name: 'Signal stages' })).getAllByRole(
      'listitem',
    )
    expect(stages).toHaveLength(13)
    expect(stages.at(-1)).toHaveTextContent('LampO')
    expect(screen.getByText('stepped E→F')).toBeInTheDocument()
  })

  it('stays within the SVG element budget for an M4 machine', () => {
    setAnimate(false)
    act(() => useEnigmaStore.getState().loadSettings(defaultSettings('M4')))
    const { container } = render(<SignalPath />)
    press('Q')
    const svg = container.querySelector('svg[data-columns]')!
    expect(svg.getAttribute('data-columns')).toContain('greek')
    expect(svg.querySelectorAll('*').length).toBeLessThanOrEqual(600)
    expect(new Set(visibleStages(container)).size).toBe(15)
  })

  it('steps forward and back through the stages and shows all again', async () => {
    const user = userEvent.setup()
    setAnimate(false)
    const { container } = render(<SignalPath />)
    press('K')

    await user.click(screen.getByRole('button', { name: 'Step' }))
    expect(useEnigmaStore.getState().stageCursor).toBe(1)
    expect(screen.getByText('Stage 1 of 13')).toBeInTheDocument()
    expect(new Set(visibleStages(container))).toEqual(new Set([0]))

    await user.click(screen.getByRole('button', { name: 'Step' }))
    await user.click(screen.getByRole('button', { name: 'Step' }))
    expect(new Set(visibleStages(container))).toEqual(new Set([0, 1, 2]))
    expect(container.querySelector('[data-signal-head="2"]')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Stage 3, Entry wheel/ })).toHaveAttribute(
      'aria-current',
      'step',
    )

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(useEnigmaStore.getState().stageCursor).toBe(2)

    await user.click(screen.getByRole('button', { name: 'Show all' }))
    expect(useEnigmaStore.getState().stageCursor).toBeNull()
    expect(screen.getByRole('button', { name: 'Show all' })).toBeDisabled()
    expect(container.querySelector('[data-signal-head]')).toBeNull()
  })

  it('jumps to a stage when its chip is clicked', async () => {
    const user = userEvent.setup()
    setAnimate(false)
    render(<SignalPath />)
    press('K')
    await user.click(screen.getByRole('button', { name: /^Stage 4, Rotor III \(right\)/ }))
    expect(useEnigmaStore.getState().stageCursor).toBe(4)
    const items = within(screen.getByRole('list', { name: 'Signal stages' })).getAllByRole(
      'listitem',
    )
    expect(items[4]).not.toHaveAttribute('data-revealed')
    expect(items[3]).toHaveAttribute('data-revealed')
  })

  it('plays the stages with the playback timer and pauses', () => {
    vi.useFakeTimers()
    const { container } = render(<SignalPath />)
    press('K') // animate is on: playback starts at stage 0
    expect(useEnigmaStore.getState().playing).toBe(true)
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
    const speed = useEnigmaStore.getState().options.speed

    act(() => vi.advanceTimersByTime(speed))
    expect(useEnigmaStore.getState().stageCursor).toBe(1)
    act(() => vi.advanceTimersByTime(speed))
    expect(useEnigmaStore.getState().stageCursor).toBe(2)
    // The newest stage animates its stroke.
    expect(container.querySelectorAll('[data-stage="1"] path.sp-draw').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('[data-stage="0"] path.sp-draw')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(useEnigmaStore.getState().playing).toBe(false)
    act(() => vi.advanceTimersByTime(speed * 3))
    expect(useEnigmaStore.getState().stageCursor).toBe(2)

    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    for (let i = 0; i < 20; i++) act(() => vi.advanceTimersByTime(speed))
    expect(useEnigmaStore.getState().playing).toBe(false)
    expect(useEnigmaStore.getState().stageCursor).toBeNull()
  })

  it('switches between key presses with the trace picker', async () => {
    const user = userEvent.setup()
    setAnimate(false)
    render(<SignalPath />)
    press('AAAAA') // BDZGO
    await user.click(screen.getByRole('button', { name: 'Previous key press' }))
    expect(useEnigmaStore.getState().selectedTrace).toBe(3)
    expect(screen.getByTestId('trace-picker-label')).toHaveTextContent('Key 4 of 5: A → G')
    await user.click(screen.getByRole('button', { name: 'Previous key press' }))
    await user.click(screen.getByRole('button', { name: 'Previous key press' }))
    await user.click(screen.getByRole('button', { name: 'Previous key press' }))
    expect(screen.getByTestId('trace-picker-label')).toHaveTextContent('Key 1 of 5: A → B')
    expect(screen.getByRole('button', { name: 'Previous key press' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Next key press' }))
    expect(screen.getByTestId('trace-picker-label')).toHaveTextContent('Key 2 of 5: A → D')
  })

  it('toggles animation and changes the speed', async () => {
    const user = userEvent.setup()
    render(<SignalPath />)
    await user.click(screen.getByRole('switch', { name: 'Animate' }))
    expect(useEnigmaStore.getState().options.animate).toBe(false)

    const thumb = screen.getByRole('slider', { name: 'Speed' })
    const before = useEnigmaStore.getState().options.speed
    act(() => thumb.focus())
    await user.keyboard('{ArrowRight}')
    expect(useEnigmaStore.getState().options.speed).toBe(before - 10)
    expect(screen.getByText(`${before - 10} ms`)).toBeInTheDocument()
  })
})
