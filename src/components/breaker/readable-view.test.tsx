import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { parseReadableWords } from '../../lib/breaker/readable'
import { initialData, useEnigmaStore } from '../../state'
import { TooltipProvider } from '../ui'
import BreakerPage from '.'
import { fakeBreakers, lastBreaker, makeCandidate } from './test-fakes'

vi.mock('../../lib/breaker', async () => (await import('./test-fakes')).fakeBreakerModule)

const loadReadableDictionary = vi.fn()
vi.mock('../../lib/breaker/readable-data', () => ({ loadReadableDictionary: (language: string) => loadReadableDictionary(language) }))

const CIPHER_40 = 'ABCDE FGHIJ KLMNO PQRST UVWXY ZABCD EFGHI JKLMN'

beforeAll(() => {
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
  loadReadableDictionary.mockReset()
})

async function showPlaintext(plaintext: string, segmented?: string) {
  const user = userEvent.setup()
  render(
    <TooltipProvider>
      <BreakerPage />
    </TooltipProvider>,
  )
  await user.type(screen.getByRole('textbox', { name: 'Ciphertext:' }), CIPHER_40)
  await user.click(screen.getByRole('button', { name: /Break cipher/ }))
  const words = segmented ? { coverage: 0.9, typos: 0, matched: 3, segmented } : undefined
  act(() => lastBreaker().emit({ candidates: [makeCandidate(1, { plaintext, words })], progress: { phase: 'done' } }))
  return { user, box: screen.getByRole('textbox', { name: /Plaintext \(\d+ letters\)/ }) }
}

describe('Readable view', () => {
  it('splits the plaintext with the frequency word list of the run language', async () => {
    loadReadableDictionary.mockResolvedValue(parseReadableWords('THE\nA\nPULL\nLITTLE\nULLA', 'de'))
    const { box } = await showPlaintext('PULLALITTLE', 'P ULLA LITTLE')
    expect(await screen.findByText('PULL A LITTLE')).toBe(box)
    expect(loadReadableDictionary).toHaveBeenCalledWith('de')
  })

  it("keeps the codebreaker's word split when the word list cannot be loaded", async () => {
    loadReadableDictionary.mockRejectedValue(new Error('offline'))
    const { box } = await showPlaintext('PULLALITTLE', 'P ULLA LITTLE')
    await act(async () => {})
    expect(box).toHaveTextContent('P ULLA LITTLE')
  })

  it('leaves the other views as they were', async () => {
    loadReadableDictionary.mockResolvedValue(parseReadableWords('THE\nA\nPULL\nLITTLE', 'de'))
    const { user, box } = await showPlaintext('PULLALITTLE')
    await screen.findByText('PULL A LITTLE')
    await user.click(screen.getByRole('radio', { name: 'Groups of 5' }))
    expect(box).toHaveTextContent('PULLA LITTL E')
    await user.click(screen.getByRole('radio', { name: 'Letters' }))
    expect(box).toHaveTextContent('PULLALITTLE')
  })
})
