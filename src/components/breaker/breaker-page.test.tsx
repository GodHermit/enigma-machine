import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { initialData, useEnigmaStore } from '../../state'
import { TooltipProvider } from '../ui'
import BreakerPage from '.'
import { FORM_STORAGE_KEY } from './form-state'
import { SAMPLE, fakeBreakers, lastBreaker, makeCandidate } from './test-fakes'

vi.mock('../../lib/breaker', async () => (await import('./test-fakes')).fakeBreakerModule)

const CIPHER_40 = 'ABCDE FGHIJ KLMNO PQRST UVWXY ZABCD EFGHI JKLMN'

beforeAll(() => {
  // jsdom lacks the pointer-capture / scrolling / resize APIs Radix calls.
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
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8, configurable: true })
})

beforeEach(() => {
  localStorage.clear()
  fakeBreakers.length = 0
  useEnigmaStore.setState(initialData())
  window.location.hash = '#/breaker'
})

afterEach(() => {
  vi.clearAllMocks()
})

function renderPage() {
  return render(
    <TooltipProvider>
      <BreakerPage />
    </TooltipProvider>,
  )
}

const breakButton = () => screen.getByRole('button', { name: /Break cipher|Breaking/ })
const ciphertextBox = () => screen.getByRole('textbox', { name: 'Ciphertext:' })

async function choose(user: ReturnType<typeof userEvent.setup>, trigger: string, option: RegExp) {
  await user.click(screen.getByRole('combobox', { name: trigger }))
  await user.click(await screen.findByRole('option', { name: option }))
}

function pressed(group: string): string[] {
  return within(screen.getByRole('toolbar', { name: group }))
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.textContent ?? '')
}

/** Types a valid ciphertext and starts a run; returns the fake breaker. */
async function startRun(user: ReturnType<typeof userEvent.setup>) {
  await user.type(ciphertextBox(), CIPHER_40)
  await user.click(breakButton())
  return lastBreaker()
}

describe('BreakerPage', () => {
  it('renders the intro, the form, an estimate and the explanation', () => {
    renderPage()
    expect(screen.getByText(/recovers the full key/i)).toBeInTheDocument()
    expect(ciphertextBox()).toHaveAttribute('placeholder', 'Paste an intercepted message…')
    expect(screen.getByRole('combobox', { name: 'Model:' })).toHaveTextContent('Enigma I')
    expect(screen.getByRole('combobox', { name: 'Plaintext language:' })).toHaveTextContent('German')
    expect(pressed('Rotors to try')).toEqual(['I', 'II', 'III', 'IV', 'V'])
    expect(pressed('Reflectors')).toEqual(['UKW-B'])
    expect(screen.queryByRole('toolbar', { name: 'Greek wheels' })).not.toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Plugboard cables' })).toHaveAttribute('aria-valuenow', '10')
    expect(screen.getByRole('slider', { name: 'CPU workers' })).toHaveAttribute('aria-valuemax', '7')
    expect(screen.getByRole('slider', { name: 'CPU workers' })).toHaveAttribute('aria-valuenow', '7')
    expect(screen.getByText(/7 of 7/)).toBeInTheDocument()
    // 60 orders × 17,576 = 1,054,560 keys at 100k keys/s × 7 workers (8 threads, 1 kept free).
    expect(screen.getByText(/≈ 1.1 million keys · about 2 s with 7 workers/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'How it works:' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'The attack in four steps' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Progress' })).not.toBeInTheDocument()
  })

  it('enables Break cipher only with 30+ letters and a valid selection', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(breakButton()).toBeDisabled()

    await user.type(ciphertextBox(), 'ABCDE FGHIJ KLMNO PQRST UVWXY ZABCD')
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(breakButton()).toBeEnabled()
    expect(screen.getByText(/Short messages are hard to break/)).toBeInTheDocument()

    await user.clear(ciphertextBox())
    await user.type(ciphertextBox(), 'ABCDEFGHIJ')
    expect(breakButton()).toBeDisabled()
    expect(screen.getAllByText(/At least 30 letters are needed \(10 so far\)/).length).toBeGreaterThan(0)

    await user.type(ciphertextBox(), 'KLMNOPQRSTUVWXYZABCD')
    expect(breakButton()).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Rotor IV' }))
    await user.click(screen.getByRole('button', { name: 'Rotor V' }))
    expect(breakButton()).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Rotor III' }))
    expect(breakButton()).toBeDisabled()
    expect(screen.getAllByText('Pick at least 3 rotors.').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Rotor III' }))
    await user.click(screen.getByRole('button', { name: 'UKW-B' }))
    expect(breakButton()).toBeDisabled()
    expect(screen.getAllByText('Pick at least one reflector.').length).toBeGreaterThan(0)
  })

  it('resets the rotor, reflector and Greek wheel chips when the model changes', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Rotor I' }))
    expect(pressed('Rotors to try')).toEqual(['II', 'III', 'IV', 'V'])

    await choose(user, 'Model:', /Enigma M3/)
    expect(pressed('Rotors to try')).toEqual(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'])
    expect(pressed('Reflectors')).toEqual(['UKW-B'])
    expect(within(screen.getByRole('toolbar', { name: 'Reflectors' })).getAllByRole('button')).toHaveLength(2)

    await choose(user, 'Model:', /Enigma M4/)
    expect(pressed('Reflectors')).toEqual(['UKW-B (thin)'])
    expect(pressed('Greek wheels')).toEqual(['β Beta', 'γ Gamma'])
  })

  it('starts the breaker with the config built from the form', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(ciphertextBox(), CIPHER_40)
    await choose(user, 'Plaintext language:', /English/)
    await choose(user, 'Ring settings:', /Search right ring only/)
    await user.click(screen.getByRole('button', { name: 'Rotor V' }))
    screen.getByRole('slider', { name: 'Plugboard cables' }).focus()
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    await user.click(screen.getByRole('radio', { name: 'Exactly' }))
    expect(screen.getByText('exactly 8')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Crib (optional):' }), 'Wetter')
    await user.type(screen.getByRole('textbox', { name: /Crib position/ }), '3')
    await user.click(breakButton())

    expect(fakeBreakers).toHaveLength(1)
    expect(lastBreaker().starts).toEqual([
      {
        ciphertext: CIPHER_40,
        model: 'I',
        rotors: ['I', 'II', 'III', 'IV'],
        reflectors: ['UKW-B'],
        greekRotors: [],
        ringSearch: 'right',
        maxPlugs: 8,
        exactPlugs: true,
        language: 'en',
        crib: { text: 'WETTER', position: 2 },
        typoTolerance: 0.2,
        workers: 7,
        backend: 'auto',
        cpuEngine: 'wasm',
      },
    ])
    expect(breakButton()).toBeDisabled()
    expect(breakButton()).toHaveTextContent('Breaking…')
  })

  it('rejects a crib position where a letter would encrypt to itself', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(ciphertextBox(), CIPHER_40)
    await user.type(screen.getByRole('textbox', { name: 'Crib (optional):' }), 'AB')
    await user.type(screen.getByRole('textbox', { name: /Crib position/ }), '1')
    expect(breakButton()).toBeDisabled()
    expect(screen.getAllByText(/never encrypts a letter to itself/).length).toBeGreaterThan(0)
  })

  it('renders progress from the snapshot and stops the run', async () => {
    const user = userEvent.setup()
    renderPage()
    const breaker = await startRun(user)

    act(() =>
      breaker.emit({
        progress: {
          phase: 'rings',
          phaseIndex: 2,
          done: 50,
          total: 100,
          keysTested: 12_400_000,
          keysPerSecond: 2_100_000,
          elapsedMs: 25_000,
          etaMs: 10_000,
          workers: 7,
          message: 'Testing ring settings of II IV I (12 of 40)',
        },
      }),
    )

    const progress = screen.getByRole('region', { name: 'Progress' })
    const steps = within(progress).getAllByRole('listitem')
    expect(steps[0]).toHaveTextContent('Rotor order & positions (done)')
    expect(steps[1]).toHaveAttribute('aria-current', 'step')
    expect(steps[2]).not.toHaveAttribute('aria-current')
    expect(within(progress).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
    expect(within(progress).getByText('12.4 M')).toBeInTheDocument()
    expect(within(progress).getByText('2.1 M')).toBeInTheDocument()
    expect(within(progress).getByText('25 s')).toBeInTheDocument()
    expect(within(progress).getByText('about 10 s')).toBeInTheDocument()
    expect(within(progress).getByRole('status')).toHaveTextContent('Testing ring settings of II IV I')

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(breaker.cancels).toBe(1)
    expect(within(progress).getByText('Stopped')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()
    expect(breakButton()).toBeEnabled()
  })

  it('shows the error of a failed run', async () => {
    const user = userEvent.setup()
    renderPage()
    const breaker = await startRun(user)
    act(() => breaker.emit({ error: 'Worker crashed', progress: { phase: 'error', message: '' } }))
    expect(screen.getByRole('alert')).toHaveTextContent('Worker crashed')
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('selects candidates in the table and shows them in the card', async () => {
    const user = userEvent.setup()
    renderPage()
    const breaker = await startRun(user)
    const candidates = [makeCandidate(1), makeCandidate(2), makeCandidate(3)]
    act(() => breaker.emit({ candidates, progress: { phase: 'done', phaseIndex: 3, message: 'Done' } }))

    expect(screen.getByText('Best candidate:')).toBeInTheDocument()
    expect(screen.getByText('Looks like language')).toBeInTheDocument()
    expect(screen.getByText(/KEY I\.UKW-B\.II-IV-I\.ANV\.ADB\.AB-CD/)).toBeInTheDocument()

    const table = screen.getByRole('table', { name: 'Candidates:' })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      '#',
      'Rotors',
      'Reflector',
      'Rings',
      'Start',
      'Plugs',
      'Score',
      'Words',
      'Preview',
    ])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('II IV I')
    expect(rows[0]).toHaveTextContent('01 14 22')
    expect(rows[0]).toHaveTextContent('DASOBERKOMMANDODERWEHRMA…')
    expect(screen.getByRole('button', { name: 'Show candidate 1' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Show candidate 2' }))
    expect(screen.getByText('Candidate #2:')).toBeInTheDocument()
    expect(screen.getByText(/KEY I\.UKW-B\.II-IV-I\.ANV\.ADC\.AB-CD/)).toBeInTheDocument()
    expect(screen.getByText('Probably wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show candidate 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(rows[1]).toHaveAttribute('data-selected')

    // Rows are keyboard accessible through their "#" button.
    screen.getByRole('button', { name: 'Show candidate 3' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByText('Candidate #3:')).toBeInTheDocument()
  })

  it('switches the plaintext view between readable, groups of five and raw letters', async () => {
    const user = userEvent.setup()
    renderPage()
    const breaker = await startRun(user)
    act(() =>
      breaker.emit({
        candidates: [makeCandidate(1, { plaintext: 'HALLOXWELTXXENDE' })],
        progress: { phase: 'done' },
      }),
    )
    const box = screen.getByRole('textbox', { name: /Plaintext \(16 letters\)/ })
    expect(box).toHaveTextContent('HALLO WELT ENDE')
    await user.click(screen.getByRole('radio', { name: 'Groups of 5' }))
    expect(box).toHaveTextContent('HALLO XWELT XXEND E')
    await user.click(screen.getByRole('radio', { name: 'Letters' }))
    expect(box).toHaveTextContent('HALLOXWELTXXENDE')
  })

  it('opens a candidate in the simulator with the ciphertext as input', async () => {
    const user = userEvent.setup()
    renderPage()
    const breaker = await startRun(user)
    const best = makeCandidate(1)
    act(() => breaker.emit({ candidates: [best], progress: { phase: 'done' } }))

    expect(window.location.hash).toBe('#/breaker')
    await user.click(screen.getByRole('button', { name: 'Open in simulator' }))

    const state = useEnigmaStore.getState()
    expect(state.settings).toEqual(best.settings)
    expect(state.input).toBe(CIPHER_40)
    expect(window.location.hash).toBe('#/simulator')
  })

  it('copies the key', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    renderPage()
    const breaker = await startRun(user)
    act(() => breaker.emit({ candidates: [makeCandidate(1)], progress: { phase: 'done' } }))
    await user.click(screen.getByRole('button', { name: 'Copy key' }))
    expect(writeText).toHaveBeenCalledWith('I.UKW-B.II-IV-I.ANV.ADB.AB-CD')
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeInTheDocument()
  })

  it('fills the ciphertext with an example and checks the result against the hidden key', async () => {
    const user = userEvent.setup()
    renderPage()
    await choose(user, 'Plaintext language:', /English/)
    await user.click(screen.getByRole('button', { name: 'Try an example' }))

    const { sampleChallenge } = await import('../../lib/breaker')
    expect(sampleChallenge).toHaveBeenCalledWith({ model: 'I', language: 'en' })
    expect(ciphertextBox()).toHaveValue(SAMPLE.ciphertext)
    expect(screen.getByText(/Wehrmachtbericht, 1941/)).toBeInTheDocument()

    await user.click(breakButton())
    const breaker = lastBreaker()
    expect(breaker.starts[0].ciphertext).toBe(SAMPLE.ciphertext)
    act(() => breaker.emit({ candidates: [makeCandidate(1)], progress: { phase: 'done' } }))
    expect(screen.getByText(/Matches the hidden key/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Show the hidden key/ }))
    expect(screen.getByText('KEY I.UKW-B.II-IV-I.ANV.ADU.AB-CD')).toBeInTheDocument()
  })

  it('reports a wrong answer for the example', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Try an example' }))
    await user.click(breakButton())
    act(() =>
      lastBreaker().emit({ candidates: [makeCandidate(2)], progress: { phase: 'done' } }),
    )
    expect(screen.getByText(/Differs from the hidden key/)).toBeInTheDocument()
  })

  it('remembers the form (not the results) in localStorage', async () => {
    const user = userEvent.setup()
    const { unmount } = renderPage()
    await user.type(ciphertextBox(), CIPHER_40)
    await choose(user, 'Model:', /Enigma M3/)
    const stored = JSON.parse(localStorage.getItem(FORM_STORAGE_KEY) ?? '{}')
    expect(stored).toMatchObject({ ciphertext: CIPHER_40, model: 'M3' })
    expect(stored).not.toHaveProperty('candidates')
    unmount()

    renderPage()
    expect(ciphertextBox()).toHaveValue(CIPHER_40)
    expect(screen.getByRole('combobox', { name: 'Model:' })).toHaveTextContent('Enigma M3')
  })

  it('creates the breaker lazily and disposes it on unmount', async () => {
    const user = userEvent.setup()
    const { unmount } = renderPage()
    expect(fakeBreakers).toHaveLength(0)
    const breaker = await startRun(user)
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await user.click(breakButton())
    expect(fakeBreakers).toHaveLength(1)
    expect(breaker.starts).toHaveLength(2)
    unmount()
    expect(breaker.disposed).toBe(true)
  })
})
