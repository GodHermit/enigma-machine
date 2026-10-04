import { describe, expect, it } from 'vitest'
import { computeKeyspace, formatBig, orderOfMagnitudeRatio, plugboardWirings, plugboardWiringsUpTo } from './keyspace'

const enigmaI = {
  model: 'I' as const,
  rotors: ['I', 'II', 'III', 'IV', 'V'] as ('I' | 'II' | 'III' | 'IV' | 'V')[],
  reflectors: ['UKW-B' as const],
  greekRotors: [],
  ringSearch: 'right-middle' as const,
  maxPlugs: 10,
}

describe('keyspace', () => {
  it('counts plugboard wirings (known values)', () => {
    expect(plugboardWirings(0)).toBe(1n)
    expect(plugboardWirings(1)).toBe(325n)
    // The famous figure for exactly 10 cables.
    expect(plugboardWirings(10)).toBe(150_738_274_937_250n)
    expect(plugboardWirings(13)).toBe(7_905_853_580_625n)
    expect(plugboardWiringsUpTo(1)).toBe(326n)
  })

  it('multiplies every factor for Enigma I', () => {
    const k = computeKeyspace(enigmaI)
    expect(k.factors.map((f) => f.id)).toEqual(['orders', 'reflectors', 'positions', 'rings', 'plugboard'])
    expect(k.exhaustive).toBe(60n * 17_576n)
    expect(k.total).toBe(60n * 17_576n * 676n * plugboardWiringsUpTo(10))
    expect(k.stages[0].keys).toBe(1_054_560n)
  })

  it('uses only the exact cable count when exactPlugs is set', () => {
    const k = computeKeyspace({ ...enigmaI, exactPlugs: true })
    const plug = k.factors.find((f) => f.id === 'plugboard')
    expect(plug?.count).toBe(150_738_274_937_250n)
    expect(plug?.formula).toBe('exactly 10 cables')
    expect(k.total).toBe(60n * 17_576n * 676n * 150_738_274_937_250n)
  })

  it('adds the Greek wheel and its 26 positions on the M4', () => {
    const k = computeKeyspace({
      model: 'M4',
      rotors: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'],
      reflectors: ['UKW-B-thin', 'UKW-C-thin'],
      greekRotors: ['Beta', 'Gamma'],
      ringSearch: 'right',
      maxPlugs: 10,
    })
    expect(k.factors.find((f) => f.id === 'greek')?.count).toBe(52n)
    expect(k.exhaustive).toBe(336n * 2n * 52n * 17_576n)
    expect(k.stages[1].detail).toMatch(/^26 ring settings/)
  })

  it('handles too few rotors and skipped phases', () => {
    const k = computeKeyspace({ ...enigmaI, rotors: ['I', 'II'], ringSearch: 'none', maxPlugs: 0 })
    expect(k.exhaustive).toBe(0n)
    expect(k.stages[1].detail).toMatch(/skipped/)
    expect(k.stages[2].detail).toMatch(/skipped/)
  })

  it('formats big numbers', () => {
    expect(formatBig(17_576n)).toBe('17,576')
    expect(formatBig(150_738_274_937_250n)).toBe('1.50 × 10¹⁴')
    expect(formatBig(10n ** 23n * 107n / 100n)).toBe('1.07 × 10²³')
    expect(orderOfMagnitudeRatio(10n ** 23n, 10n ** 6n)).toBe(17)
  })
})
