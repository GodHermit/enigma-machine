import { describe, expect, it } from 'vitest'
import { encryptText, stepRotors, startPositions } from '../enigma/machine'
import { parsePlugboard } from '../enigma/plugboard'
import { randomSettings } from '../enigma/settings'
import type { MachineSettings, RotorId } from '../enigma/types'
import { PASSAGES } from './data/passages'
import { buildClassTable, cipherLayout, climbIoc, countPlugs, iocFromSumSquares } from './climb'
import { runSearchSync } from './pipeline'
import { mulberry32 } from './random'
import { compileKey, decipherCodes, keyFromSettings, plugMap } from './scrambler'
import {
  createContext,
  cribPositions,
  rotorUnits,
  runPlugboardSearch,
  runRingSearch,
  runRotorUnit,
} from './search'
import type { CoreCandidate } from './search'
import { testNgrams } from './test-data'
import { fromCodes, letterAgreement, lettersOnly, toCodes } from './text'
import type { BreakerConfig } from './types'

const GERMAN = PASSAGES.de.map((p) => lettersOnly(p.text)).join('')
const IDENTITY = Array.from({ length: 26 }, (_, i) => i)

function config(cipher: string, extra: Partial<BreakerConfig> = {}): BreakerConfig {
  return {
    ciphertext: cipher,
    model: 'I',
    rotors: ['I', 'II', 'III', 'IV', 'V'],
    reflectors: ['UKW-B'],
    greekRotors: [],
    ringSearch: 'right-middle',
    maxPlugs: 10,
    language: 'de',
    crib: null,
    workers: 1,
    ...extra,
  }
}

function keyed(seed: number, overrides: Partial<MachineSettings> = {}): MachineSettings {
  return { ...randomSettings('I', mulberry32(seed)), reflector: 'UKW-B', ...overrides }
}

function correctPlugs(found: ArrayLike<number>, truth: MachineSettings): number {
  const t = plugMap(truth.plugboard)
  let k = 0
  for (let a = 0; a < 26; a++) if (found[a] > a && t[a] === found[a]) k++
  return k
}

/** Index of the first letter enciphered after a left-rotor turnover, or -1. */
function leftTurnover(s: MachineSettings, n: number): number {
  let pos = startPositions(s)
  for (let i = 0; i < n; i++) {
    const step = stepRotors(s, pos)
    if (step.stepped.left) return i
    pos = step.after
  }
  return -1
}

describe('crib positions', () => {
  it('skips offsets where a crib letter equals the ciphertext letter', () => {
    expect(cribPositions(toCodes('ABCDE'), toCodes('BC'), null)).toEqual([0, 2, 3])
    expect(cribPositions(toCodes('ABCDE'), toCodes('BC'), 2)).toEqual([2])
    expect(cribPositions(toCodes('ABCDE'), toCodes('BC'), 1)).toEqual([])
    expect(cribPositions(toCodes('ABCDE'), toCodes('BC'), 4)).toEqual([])
    expect(cribPositions(toCodes('AB'), toCodes(''), null)).toEqual([])
  })

  it('always keeps the true offset of a real crib', () => {
    const s = keyed(3)
    const plain = GERMAN.slice(0, 200)
    const cipher = toCodes(encryptText(s, plain, { nonLetters: 'remove' }).output)
    const crib = toCodes(plain.slice(57, 77))
    expect(cribPositions(cipher, crib, null)).toContain(57)
    expect(cribPositions(cipher, crib, 57)).toEqual([57])
  })
})

describe('rotor units', () => {
  it('enumerates reflector × Greek wheel × ordered rotor triples', () => {
    expect(rotorUnits(config(''))).toHaveLength(60)
    expect(rotorUnits(config('', { rotors: ['I', 'II', 'III'] }))).toHaveLength(6)
    expect(
      rotorUnits({ ...config(''), model: 'M4', rotors: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'], reflectors: ['UKW-B-thin'], greekRotors: ['Beta', 'Gamma'] }),
    ).toHaveLength(336 * 2)
    // Rotors / reflectors foreign to the model are ignored.
    expect(rotorUnits(config('', { rotors: ['I', 'II', 'VI'] as RotorId[] }))).toHaveLength(0)
  })
})

describe('plugboard hill climbing', () => {
  it('IoC climb finds the plugs on the correct rotor setting', () => {
    const s = keyed(21)
    const plain = GERMAN.slice(400, 700)
    const codes = toCodes(encryptText(s, plain, { nonLetters: 'remove' }).output)
    const layout = cipherLayout(codes)
    const c = compileKey(keyFromSettings(s), codes.length)
    const tab = new Uint8Array(codes.length * 26)
    buildClassTable(layout, c.inner, c.rf, c.rb, c.rBase, c.iBase, tab)
    const P = Uint8Array.from(IDENTITY)
    const ioc = iocFromSumSquares(climbIoc(layout, tab, P, 10, 10), codes.length)
    expect(ioc).toBeGreaterThan(0.065)
    expect(countPlugs(P)).toBeLessThanOrEqual(10)
    expect(correctPlugs(P, s)).toBeGreaterThanOrEqual(8)
  })

  it('phase 3 recovers the full plugboard on a known rotor setting', () => {
    const s = keyed(22)
    const plain = GERMAN.slice(900, 1150)
    const cipher = encryptText(s, plain, { nonLetters: 'remove' }).output
    const ctx = createContext(config(cipher), testNgrams('de'))
    const start: CoreCandidate = { key: keyFromSettings(s), plugs: IDENTITY, score: 0, ioc: 0, phase: 'rings' }
    const { result, keys } = runPlugboardSearch(ctx, start, 1)
    expect(keys).toBeGreaterThan(1000)
    expect(result.plaintext).toBe(plain)
    expect(correctPlugs(result.plugs, s)).toBe(10)
    expect(result.score).toBeGreaterThan(-5)
    expect(result.ioc).toBeGreaterThan(0.06)
  })

  it('phase 3 in exact-cable mode ends with exactly the requested number of cables', () => {
    const s = keyed(22)
    const plain = GERMAN.slice(900, 1150)
    const cipher = encryptText(s, plain, { nonLetters: 'remove' }).output
    const ctx = createContext(config(cipher, { exactPlugs: true }), testNgrams('de'))
    expect(ctx.exactPlugs).toBe(true)
    const start: CoreCandidate = { key: keyFromSettings(s), plugs: IDENTITY, score: 0, ioc: 0, phase: 'rings' }
    const { result } = runPlugboardSearch(ctx, start, 1)
    expect(countPlugs(result.plugs)).toBe(10)
    expect(result.plaintext).toBe(plain)
    expect(correctPlugs(result.plugs, s)).toBe(10)
  })

  it('exact-cable mode fills a key with fewer real cables up to the requested count', () => {
    // A 6-cable key searched as "exactly 6" gets exactly 6 and the right plaintext.
    const base = keyed(31)
    const s = { ...base, plugboard: base.plugboard.slice(0, 6) }
    const plain = GERMAN.slice(2400, 2680)
    const cipher = encryptText(s, plain, { nonLetters: 'remove' }).output
    const ctx = createContext(config(cipher, { maxPlugs: 6, exactPlugs: true }), testNgrams('de'))
    const start: CoreCandidate = { key: keyFromSettings(s), plugs: IDENTITY, score: 0, ioc: 0, phase: 'rings' }
    const { result } = runPlugboardSearch(ctx, start, 3)
    expect(countPlugs(result.plugs)).toBe(6)
    expect(letterAgreement(result.plaintext ?? '', plain)).toBeGreaterThan(0.95)
  })

  it('exact-cable climbs never remove a cable', () => {
    const s = keyed(24)
    const plain = GERMAN.slice(3000, 3250)
    const cipher = encryptText(s, plain, { nonLetters: 'remove' }).output
    const codes = toCodes(cipher)
    const ctx = createContext(config(cipher), null)
    const c = compileKey(keyFromSettings(s), codes.length)
    const layout = cipherLayout(codes)
    const tab = new Uint8Array(codes.length * 26)
    buildClassTable(layout, c.inner, c.rf, c.rb, c.rBase, c.iBase, tab)
    // Start from a wrong 10-cable board: the exact climb may rewire but must keep 10 cables.
    const P = Uint8Array.from(IDENTITY)
    for (let k = 0; k < 20; k += 2) {
      P[k] = k + 1
      P[k + 1] = k
    }
    climbIoc(layout, tab, P, 10, 10, ctx.order, 26, true)
    expect(countPlugs(P)).toBe(10)
  })

  it('phase 3 repairs a slightly wrong ring timing (one stretch garbled around a turnover)', () => {
    // The failure a user reported: the right key except a middle ring that moves the left
    // turnover by one middle step, and a right ring 3 off — a stretch of the decrypt is garbled.
    let s = keyed(140)
    for (let seed = 140; leftTurnover(s, 280) < 80 || leftTurnover(s, 280) > 200; seed++) s = keyed(seed)
    const plain = GERMAN.slice(4000, 4280)
    const cipher = encryptText(s, plain, { nonLetters: 'remove' }).output
    const ctx = createContext(config(cipher), testNgrams('de'))
    const truth = keyFromSettings(s)
    const mod = (x: number) => ((x % 26) + 26) % 26
    const oM = mod(truth.posM - truth.ringM)
    const oR = mod(truth.posR - truth.ringR)
    const ringM = mod(truth.ringM + 1)
    const ringR = mod(truth.ringR + 3)
    const off = { ...truth, ringM, posM: mod(oM + ringM), ringR, posR: mod(oR + ringR) }
    const start: CoreCandidate = { key: off, plugs: IDENTITY, score: 0, ioc: 0, phase: 'rings' }
    const { result } = runPlugboardSearch(ctx, start, 1)
    expect(result.plaintext).toBe(plain)
  })

  it('phase 3 uses a crib', () => {
    const s = keyed(23)
    const plain = GERMAN.slice(1500, 1640)
    const cipher = encryptText(s, plain, { nonLetters: 'remove' }).output
    const ctx = createContext(config(cipher, { crib: { text: plain.slice(10, 30), position: null } }), testNgrams('de'))
    expect(ctx.crib?.positions).toContain(10)
    const start: CoreCandidate = { key: keyFromSettings(s), plugs: IDENTITY, score: 0, ioc: 0, phase: 'rings' }
    const { result } = runPlugboardSearch(ctx, start, 1)
    expect(letterAgreement(result.plaintext ?? '', plain)).toBeGreaterThan(0.95)
  })
})

describe('phase 2: ring settings', () => {
  it('recovers the right and middle ring from a candidate with the right wiring offsets', () => {
    // A key whose left rotor turns over in the middle of the message, so the middle ring matters.
    let s = keyed(100)
    for (let seed = 100; leftTurnover(s, 300) < 90 || leftTurnover(s, 300) > 210; seed++) s = keyed(seed)
    const plain = GERMAN.slice(2000, 2300)
    const cipher = encryptText(s, plain, { nonLetters: 'remove' }).output
    const ctx = createContext(config(cipher), null)
    const truth = keyFromSettings(s)
    // Same wiring offsets, rings off by 3 (right) and 7 (middle).
    const off = { ...truth, ringR: (truth.ringR + 3) % 26, posR: (truth.posR + 3) % 26, ringM: (truth.ringM + 7) % 26, posM: (truth.posM + 7) % 26 }
    const { results } = runRingSearch(ctx, { key: off, plugs: Array.from(plugMap(s.plugboard)), score: 0, ioc: 0, phase: 'rotors' })
    const best = results[0]
    expect(fromCodes(decipherCodes(best.key, plugMap(s.plugboard), toCodes(cipher)))).toBe(plain)
    expect(best.phase).toBe('rings')
    expect(best.ioc).toBeGreaterThan(0.065)
  })
})

describe('phase 1: rotor order and start positions', () => {
  it('ranks the true start position first (rings known)', () => {
    const s = keyed(31, {
      left: { rotor: 'IV', ring: 0, position: 7 },
      middle: { rotor: 'II', ring: 0, position: 19 },
      right: { rotor: 'V', ring: 0, position: 3 },
      plugboard: parsePlugboard('AQ BW CE DR FT GZ HU JI KO LP').pairs,
    })
    const plain = GERMAN.slice(3000, 3300)
    const cipher = encryptText(s, plain, { nonLetters: 'remove' }).output
    const ctx = createContext(config(cipher, { ringSearch: 'none' }), null)
    const unit = rotorUnits(config(cipher)).find((u) => u.left === 'IV' && u.middle === 'II' && u.right === 'V')
    expect(unit).toBeDefined()
    const { survivors, keys } = runRotorUnit(ctx, unit!, { keep: 10 })
    expect(keys).toBe(17576)
    expect(survivors[0].key).toMatchObject({ posL: 7, posM: 19, posR: 3, ringM: 0, ringR: 0 })
    expect(survivors[0].ioc).toBeGreaterThan(0.065)
  })
})

describe('full pipeline (synchronous, no workers)', () => {
  it('breaks a message when the search space is narrowed', () => {
    const s = keyed(41, {
      left: { rotor: 'III', ring: 0, position: 12 },
      middle: { rotor: 'I', ring: 0, position: 2 },
      right: { rotor: 'II', ring: 0, position: 20 },
    })
    const plain = GERMAN.slice(4000, 4260)
    const cipher = encryptText(s, plain, { nonLetters: 'remove' }).output
    const cfg = config(cipher, { rotors: ['I', 'II', 'III'], ringSearch: 'none' })
    const phases = new Set<string>()
    const result = runSearchSync(cfg, testNgrams('de'), { survivors: 50, finalists: 5 }, (p) => phases.add(p.phase))
    expect([...phases]).toEqual(['rotors', 'rings', 'plugboard'])
    expect(result.candidates[0].plaintext).toBe(plain)
    expect(result.keysTested).toBeGreaterThan(6 * 17576)
  }, 60_000)
})
