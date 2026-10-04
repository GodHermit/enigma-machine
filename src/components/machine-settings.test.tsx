import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { initialData, useEnigmaStore } from '../state'
import { MachineSettings } from './machine-settings'
import { TooltipProvider } from './ui'

beforeAll(() => {
  // jsdom lacks the pointer-capture / scrolling APIs Radix Select calls.
  const proto = Element.prototype as unknown as Record<string, unknown>
  proto.hasPointerCapture ??= () => false
  proto.setPointerCapture ??= () => {}
  proto.releasePointerCapture ??= () => {}
  proto.scrollIntoView ??= () => {}
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

beforeEach(() => {
  useEnigmaStore.setState(initialData())
})

function renderSettings() {
  return render(
    <TooltipProvider>
      <MachineSettings />
    </TooltipProvider>,
  )
}

async function choose(user: ReturnType<typeof userEvent.setup>, trigger: string, option: string | RegExp) {
  await user.click(screen.getByRole('combobox', { name: trigger }))
  await user.click(await screen.findByRole('option', { name: option }))
}

describe('MachineSettings', () => {
  it('shows model, reflector and one table row per rotor of the Enigma I', () => {
    renderSettings()
    expect(screen.getByRole('combobox', { name: 'Model:' })).toHaveTextContent('Enigma I')
    expect(screen.getByRole('combobox', { name: 'Reflector:' })).toHaveTextContent('UKW-B')

    const table = screen.getByRole('table', { name: 'Rotors:' })
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent)
    expect(headers).toEqual(['Slot', 'Rotor', 'Ring setting', 'Start position', 'Turnover'])
    const rows = within(table)
      .getAllByRole('rowheader')
      .map((h) => h.textContent)
    expect(rows).toEqual(['Left', 'Middle', 'Right'])

    expect(screen.getByRole('combobox', { name: 'Left rotor' })).toHaveTextContent('I')
    expect(screen.getByRole('combobox', { name: 'Right rotor' })).toHaveTextContent('III')
    expect(screen.getByRole('combobox', { name: 'Right rotor ring setting' })).toHaveTextContent('01')
    expect(screen.getByRole('combobox', { name: 'Right rotor start position' })).toHaveTextContent('A')
    expect(screen.getByLabelText('Turnover at V')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('switches to the M4 and adds the Greek wheel row with thin reflectors', async () => {
    const user = userEvent.setup()
    renderSettings()
    await choose(user, 'Model:', /Enigma M4/)

    expect(useEnigmaStore.getState().settings.model).toBe('M4')
    expect(screen.getByRole('combobox', { name: 'Model:' })).toHaveTextContent('Enigma M4')
    expect(screen.getByRole('combobox', { name: 'Reflector:' })).toHaveTextContent('UKW-B (thin)')
    expect(screen.getByRole('rowheader', { name: 'Greek' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Greek wheel' })).toHaveTextContent('Beta')
    expect(screen.getByLabelText('No turnover')).toBeInTheDocument()
    expect(screen.getByText(/Greek wheels never step/)).toBeInTheDocument()

    await choose(user, 'Reflector:', /UKW-C \(thin\)/)
    expect(useEnigmaStore.getState().settings.reflector).toBe('UKW-C-thin')

    await user.click(screen.getByRole('combobox', { name: 'Greek wheel' }))
    const greekOptions = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(greekOptions.some((t) => t?.startsWith('Gamma'))).toBe(true)
    expect(greekOptions.some((t) => t?.startsWith('VIII'))).toBe(false)
    await user.click(screen.getByRole('option', { name: /Gamma/ }))
    expect(useEnigmaStore.getState().settings.greek?.rotor).toBe('Gamma')
  })

  it('offers only the model reflectors and rotors', async () => {
    const user = userEvent.setup()
    renderSettings()
    await user.click(screen.getByRole('combobox', { name: 'Reflector:' }))
    const reflectors = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(reflectors).toHaveLength(3)
    expect(reflectors[0]).toMatch(/^UKW-A/)
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('combobox', { name: 'Middle rotor' }))
    const rotors = await screen.findAllByRole('option')
    expect(rotors.map((o) => o.textContent?.split('Turnover')[0])).toEqual(['I', 'II', 'III', 'IV', 'V'])
    expect(screen.getByRole('option', { name: 'I' })).toHaveTextContent('Turnover Q · swaps with left')
    expect(screen.getByRole('option', { name: 'II' })).toHaveTextContent(/^IITurnover E$/)
  })

  it('swaps rotors when one already used elsewhere is chosen', async () => {
    const user = userEvent.setup()
    renderSettings()
    await choose(user, 'Left rotor', 'III')

    const { left, right } = useEnigmaStore.getState().settings
    expect(left.rotor).toBe('III')
    expect(right.rotor).toBe('I')
    expect(screen.getByRole('combobox', { name: 'Left rotor' })).toHaveTextContent('III')
    expect(screen.getByRole('combobox', { name: 'Right rotor' })).toHaveTextContent(/^I$/)
    expect(screen.getByLabelText('Turnover at Q')).toBeInTheDocument()
  })

  it('sets ring settings and start positions, honouring the ring display option', async () => {
    const user = userEvent.setup()
    renderSettings()
    await choose(user, 'Middle rotor ring setting', '05')
    expect(useEnigmaStore.getState().settings.middle.ring).toBe(4)

    await choose(user, 'Right rotor start position', 'Q')
    expect(useEnigmaStore.getState().settings.right.position).toBe(16)
    expect(screen.getByRole('combobox', { name: 'Right rotor start position' })).toHaveTextContent('Q')

    act(() => useEnigmaStore.getState().setOption('ringDisplay', 'letter'))
    expect(screen.getByRole('combobox', { name: 'Middle rotor ring setting' })).toHaveTextContent('E')
    await choose(user, 'Left rotor ring setting', 'Z')
    expect(useEnigmaStore.getState().settings.left.ring).toBe(25)
  })

  it('explains the rotor wiring and notch in a tooltip', async () => {
    renderSettings()
    act(() => screen.getByRole('combobox', { name: 'Left rotor' }).focus())
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('Rotor I')
    expect(tip).toHaveTextContent('Wiring: EKMFLGDQVZNTOWYHXUSPAIBRCJ')
    expect(tip).toHaveTextContent('Notch: Q')

    // Opening the rotor list hides the hint so it never covers the options.
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('shows validation issues under the controls', () => {
    const base = useEnigmaStore.getState().settings
    useEnigmaStore.setState({
      settings: { ...base, reflector: 'UKW-B-thin', left: { ...base.left, rotor: 'VI' } },
    })
    renderSettings()
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent)
    expect(alerts.some((t) => /UKW-B \(thin\).*Enigma I/.test(t ?? ''))).toBe(true)
    expect(alerts.some((t) => /Rotor VI cannot be used in the Enigma I/.test(t ?? ''))).toBe(true)
    // The invalid current values stay visible in their triggers.
    expect(screen.getByRole('combobox', { name: 'Reflector:' })).toHaveTextContent('UKW-B (thin)')
    expect(screen.getByRole('combobox', { name: 'Left rotor' })).toHaveTextContent('VI')
    expect(screen.getByRole('combobox', { name: 'Left rotor' })).toHaveAttribute('aria-invalid', 'true')
  })
})
