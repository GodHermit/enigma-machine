import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { decodeSettings, defaultSettings, encodeSettings } from '../lib/enigma'
import { initialData, shareUrl, useEnigmaStore } from '../state'
import { MachineControls } from './machine-controls'
import { useCopyFeedback } from './use-copy-feedback'

const M3_KEY = 'M3.UKW-C.IV-I-II.DOM.CWT.FP-WS-IU-TX-MO-EY-GQ-VR-JD-HK'

function setup() {
  const user = userEvent.setup()
  render(<MachineControls />)
  return user
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More machine actions' }))
  return screen.findByRole('menu')
}

beforeEach(() => {
  useEnigmaStore.setState(initialData())
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('MachineControls buttons', () => {
  it('renders the labelled button group with Reset/Continue disabled while the input is empty', () => {
    setup()
    expect(screen.getByRole('group', { name: 'Machine:' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Continue from here' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Randomize' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reset' })).toHaveAttribute('data-variant', 'primary')
  })

  it('Reset clears the input so the rotors return to their start positions', async () => {
    const user = setup()
    act(() => useEnigmaStore.getState().setInput('HELLO WORLD'))
    const reset = screen.getByRole('button', { name: 'Reset' })
    expect(reset).toBeEnabled()
    await user.click(reset)
    expect(useEnigmaStore.getState().input).toBe('')
    expect(useEnigmaStore.getState().settings.right.position).toBe(0)
    expect(reset).toBeDisabled()
  })

  it('Continue from here adopts the current rotor positions and clears the text', async () => {
    const user = setup()
    act(() => useEnigmaStore.getState().setInput('AAAAA'))
    await user.click(screen.getByRole('button', { name: 'Continue from here' }))
    const { settings, input } = useEnigmaStore.getState()
    expect(input).toBe('')
    expect(settings.right.position).toBe(5)
    expect(settings.middle.position).toBe(0)
    expect(settings.left.position).toBe(0)
  })

  it('Randomize picks new settings with 10 plug cables and clears the input', async () => {
    const user = setup()
    act(() => useEnigmaStore.getState().setInput('ABC'))
    await user.click(screen.getByRole('button', { name: 'Randomize' }))
    const { settings, input } = useEnigmaStore.getState()
    expect(input).toBe('')
    expect(settings.model).toBe('I')
    expect(settings.plugboard).toHaveLength(10)
  })

  it('shows a tooltip explaining Continue from here', async () => {
    // jsdom has no ResizeObserver; Radix measures the tooltip arrow with one.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    const user = setup()
    act(() => useEnigmaStore.getState().setInput('A'))
    await user.hover(screen.getByRole('button', { name: 'Continue from here' }))
    expect(
      await screen.findByRole('tooltip', {
        name: 'Make the current rotor positions the new start position and clear the text',
      }),
    ).toBeInTheDocument()
  })
})

describe('MachineControls ⋮ menu', () => {
  it('copies the share link and shows a transient "Copied!" state', async () => {
    const user = setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText')
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Copy share link' }))
    expect(write).toHaveBeenCalledWith(shareUrl(useEnigmaStore.getState().settings))
    expect(await screen.findByRole('menuitem', { name: 'Copied!' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Share link copied to the clipboard.')
  })

  it('copies the key text', async () => {
    const user = setup()
    act(() => useEnigmaStore.getState().loadSettings(decodeSettings(M3_KEY)!))
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Copy key' }))
    expect(await navigator.clipboard.readText()).toBe(M3_KEY)
    expect(await screen.findByRole('menuitem', { name: 'Copied!' })).toBeInTheDocument()
  })

  it('reports a clipboard failure', async () => {
    const user = setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Copy key' }))
    expect(await screen.findByRole('menuitem', { name: 'Copy failed' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Could not copy the key.')
  })

  it('imports a key through the dialog with live validation', async () => {
    const user = setup()
    act(() => useEnigmaStore.getState().setInput('SOME TEXT'))
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Import key…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Import key' })
    expect(dialog).toBeInTheDocument()

    const field = screen.getByLabelText('Key:')
    const submit = screen.getByRole('button', { name: 'Import' })
    expect(submit).toBeDisabled()

    await user.type(field, 'NOT A KEY')
    expect(screen.getByRole('alert')).toHaveTextContent('This is not a valid key or share link.')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(submit).toBeDisabled()

    await user.clear(field)
    await user.type(field, M3_KEY)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Enigma M3 · UKW-C · IV I II · 10 plugs')).toBeInTheDocument()
    await user.click(submit)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const state = useEnigmaStore.getState()
    expect(encodeSettings(state.settings)).toBe(M3_KEY)
    expect(state.input).toBe('')
    expect(screen.getByRole('button', { name: 'More machine actions' })).toHaveFocus()
  })

  it('accepts a share link in the import dialog and submits with Enter', async () => {
    const user = setup()
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Import key…' }))
    const field = await screen.findByLabelText('Key:')
    await user.type(field, 'https://example.com/enigma/#other=1')
    expect(screen.getByRole('alert')).toHaveTextContent('This is not a valid key or share link.')
    await user.clear(field)
    expect(screen.getByText('Example: I.UKW-B.I-II-III.AAA.AAA.AB-CD')).toBeInTheDocument()
    await user.type(field, `https://example.com/enigma/#key=${M3_KEY}{Enter}`)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(encodeSettings(useEnigmaStore.getState().settings)).toBe(M3_KEY)
  })

  it('switches the ring display between numbers and letters', async () => {
    const user = setup()
    await openMenu(user)
    const numbers = screen.getByRole('menuitemradio', { name: 'Numbers (01–26)' })
    expect(numbers).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('menuitemradio', { name: 'Letters (A–Z)' }))
    expect(useEnigmaStore.getState().options.ringDisplay).toBe('letter')

    await openMenu(user)
    expect(screen.getByRole('menuitemradio', { name: 'Letters (A–Z)' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('offers no theme switcher (light theme only)', async () => {
    const user = setup()
    await openMenu(user)
    expect(screen.queryByRole('menuitemradio', { name: 'Dark' })).not.toBeInTheDocument()
  })

  it('resets the settings to defaults and clears the input', async () => {
    const user = setup()
    act(() => {
      useEnigmaStore.getState().randomize()
      useEnigmaStore.getState().setInput('ABC')
    })
    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Reset settings to defaults' }))
    const state = useEnigmaStore.getState()
    expect(state.settings).toEqual(defaultSettings('I'))
    expect(state.input).toBe('')
  })
})

describe('useCopyFeedback', () => {
  it('returns to idle after the timeout', async () => {
    vi.useFakeTimers()
    try {
      function Probe() {
        const { status, copy } = useCopyFeedback(1000)
        return <button onClick={() => void copy('hello')}>{status}</button>
      }
      const write = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: write } })
      render(<Probe />)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'idle' }))
      })
      expect(write).toHaveBeenCalledWith('hello')
      expect(screen.getByRole('button', { name: 'copied' })).toBeInTheDocument()
      act(() => vi.advanceTimersByTime(1000))
      expect(screen.getByRole('button', { name: 'idle' })).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})
