/*
 * Adversarial property tests for the plugboard parser and the settings helpers
 * (validate / coerce / random / encode / decode).
 */
import { describe, expect, it } from 'vitest'
import { MAX_PLUGS, MODELS, REFLECTOR_IDS } from './constants'
import { encryptText } from './machine'
import { formatPlugboard, parsePlugboard, partnerOf, plugboardMap, togglePlug } from './plugboard'
import {
  coerceToModel,
  decodeSettings,
  encodeSettings,
  randomSettings,
  validateSettings,
} from './settings'
import type { AnyRotorId, MachineSettings, ModelId, PlugPair, ReflectorId, RotorSlot } from './types'

const AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const MODELS_ALL: ModelId[] = ['I', 'M3', 'M4']
const ALL_ROTORS: AnyRotorId[] = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'Beta', 'Gamma']

/** Seeded PRNG (splitmix32). */
function prng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x9e3779b9) >>> 0
    let z = s
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b)
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35)
    return ((z ^ (z >>> 16)) >>> 0) / 4294967296
  }
}
const int = (r: () => number, n: number): number => Math.floor(r() * n)
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[int(r, xs.length)]
const P = (s: string): PlugPair => [AZ.indexOf(s[0]), AZ.indexOf(s[1])]

function isValidPairSet(pairs: readonly PlugPair[]): boolean {
  if (pairs.length > MAX_PLUGS) return false
  const used = new Set<number>()
  for (const [a, b] of pairs) {
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || a > 25 || b < 0 || b > 25 || a === b) return false
    if (used.has(a) || used.has(b)) return false
    used.add(a)
    used.add(b)
  }
  return true
}

/* ------------------------------------------------------------------------ */
/* Plugboard                                                                 */
/* ------------------------------------------------------------------------ */

describe('parsePlugboard edge cases', () => {
  it('lowercase, mixed case and every supported separator', () => {
    const want = [P('AB'), P('CD'), P('EF')]
    for (const text of ['ab cd ef', 'Ab-cD-eF', 'AB,CD,EF', 'AB;CD;EF', 'AB/CD/EF', 'AB\tCD\nEF', ' AB , CD - EF ', 'ABCDEF', 'ab-cd,ef']) {
      expect(parsePlugboard(text), text).toEqual({ pairs: want, errors: [] })
    }
  })

  it('empty tokens and trailing separators are ignored', () => {
    expect(parsePlugboard('AB--CD,,')).toEqual({ pairs: [P('AB'), P('CD')], errors: [] })
    expect(parsePlugboard(' - , ; / ')).toEqual({ pairs: [], errors: [] })
  })

  it('duplicates: repeated pair, reversed pair and shared letter', () => {
    for (const text of ['AB AB', 'AB BA', 'AB BC', 'AB CA']) {
      const r = parsePlugboard(text)
      expect(r.pairs, text).toEqual([P('AB')])
      expect(r.errors, text).toHaveLength(1)
      expect(r.errors[0]).toMatch(/already plugged/)
    }
  })

  it('self-plug and odd letter counts', () => {
    expect(parsePlugboard('AA').pairs).toEqual([])
    expect(parsePlugboard('AA').errors[0]).toMatch(/itself/)
    for (const odd of ['A', 'ABC', 'abcde']) {
      const r = parsePlugboard(odd)
      expect(r.pairs, odd).toEqual([])
      expect(r.errors[0], odd).toMatch(/not a pair/)
    }
    // A self-plug inside a longer token only drops that pair.
    expect(parsePlugboard('ABCC').pairs).toEqual([P('AB')])
  })

  it('non A–Z characters are rejected per token', () => {
    for (const bad of ['A1', 'ÄB', 'A_', 'AB.', 'éa']) {
      const r = parsePlugboard(`${bad} XY`)
      expect(r.pairs, bad).toEqual([P('XY')])
      expect(r.errors, bad).toHaveLength(1)
    }
  })

  it('a 14th cable is refused', () => {
    const r = parsePlugboard('AB CD EF GH IJ KL MN OP QR ST UV WX YZ')
    expect(r.pairs).toHaveLength(13)
    expect(r.errors).toEqual([])
  })

  it('fuzz: result is always a valid pair set and formatPlugboard round-trips it', () => {
    const r = prng(1)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcxyz  ,-;/1.Ä'
    for (let k = 0; k < 2000; k++) {
      let text = ''
      const n = int(r, 60)
      for (let i = 0; i < n; i++) text += pick(r, [...chars])
      const { pairs } = parsePlugboard(text)
      expect(isValidPairSet(pairs), text).toBe(true)
      expect(parsePlugboard(formatPlugboard(pairs))).toEqual({ pairs, errors: [] })
      const map = plugboardMap(pairs)
      for (let i = 0; i < 26; i++) {
        expect(map[map[i]]).toBe(i)
        expect(partnerOf(pairs, i)).toBe(map[i] === i ? null : map[i])
      }
    }
  })

  it('fuzz: any sequence of togglePlug calls keeps a valid pair set', () => {
    const r = prng(2)
    let pairs: PlugPair[] = []
    for (let k = 0; k < 5000; k++) {
      const a = int(r, 26)
      const b = int(r, 26)
      const before = pairs
      pairs = togglePlug(pairs, a, b)
      expect(isValidPairSet(pairs)).toBe(true)
      if (a !== b && partnerOf(before, a) !== b && pairs.length > 0 && partnerOf(pairs, a) === b) {
        expect(partnerOf(pairs, b)).toBe(a)
      }
      if (a === b || partnerOf(before, a) === b) {
        expect(partnerOf(pairs, a)).toBeNull()
      }
    }
  })
})

/* ------------------------------------------------------------------------ */
/* Settings                                                                  */
/* ------------------------------------------------------------------------ */

/** Arbitrary (frequently invalid) settings: wrong model equipment, duplicates, bad plugs, odd numbers. */
function garbageSettings(r: () => number): MachineSettings {
  const num = (): number => {
    const x = r()
    if (x < 0.6) return int(r, 26)
    if (x < 0.85) return int(r, 200) - 100
    if (x < 0.9) return int(r, 2600) / 100 // fractional
    if (x < 0.95) return Number.NaN
    return Number.POSITIVE_INFINITY
  }
  const slot = (): RotorSlot => ({ rotor: pick(r, ALL_ROTORS), ring: num(), position: num() })
  const plugs: PlugPair[] = []
  const n = int(r, 16)
  for (let i = 0; i < n; i++) plugs.push([r() < 0.9 ? int(r, 26) : num(), r() < 0.9 ? int(r, 26) : num()])
  return {
    model: pick(r, MODELS_ALL),
    reflector: pick(r, REFLECTOR_IDS),
    greek: r() < 0.5 ? slot() : null,
    left: slot(),
    middle: slot(),
    right: slot(),
    plugboard: plugs,
  }
}

describe('coerceToModel (property)', () => {
  it('never yields invalid settings, for every source and target model', () => {
    const r = prng(3)
    for (let k = 0; k < 3000; k++) {
      const s = garbageSettings(r)
      const snapshot = JSON.stringify(s)
      for (const m of MODELS_ALL) {
        const c = coerceToModel(s, m)
        expect(validateSettings(c), `${snapshot} → ${m}`).toEqual([])
        expect(c.model).toBe(m)
        expect(c.greek !== null).toBe(MODELS[m].hasGreek)
        // Coercing valid settings to the same model is the identity.
        expect(coerceToModel(c, m)).toEqual(c)
      }
      expect(JSON.stringify(s)).toBe(snapshot) // input not mutated
    }
  })

  it('regression: NaN / fractional / infinite rings and positions are normalised, not propagated', () => {
    const s: MachineSettings = {
      model: 'M3',
      reflector: 'UKW-B',
      greek: null,
      left: { rotor: 'I', ring: Number.NaN, position: 3.7 },
      middle: { rotor: 'II', ring: Number.POSITIVE_INFINITY, position: -1 },
      right: { rotor: 'III', ring: 27.2, position: Number.NEGATIVE_INFINITY },
      plugboard: [],
    }
    for (const m of MODELS_ALL) {
      const c = coerceToModel(s, m)
      expect(validateSettings(c)).toEqual([])
      expect([c.left.ring, c.left.position, c.middle.ring, c.middle.position, c.right.ring, c.right.position]).toEqual([
        0, 3, 0, 25, 1, 0,
      ])
    }
  })

  it('keeps valid integer rings / positions (normalised mod 26) and valid plugs', () => {
    const r = prng(4)
    for (let k = 0; k < 500; k++) {
      const s = randomSettings(pick(r, MODELS_ALL), r)
      s.left.ring += 26 * (int(r, 5) - 2)
      for (const m of MODELS_ALL) {
        const c = coerceToModel(s, m)
        expect(c.left.ring).toBe(((s.left.ring % 26) + 26) % 26)
        expect(c.left.position).toBe(s.left.position)
        expect(c.middle.position).toBe(s.middle.position)
        expect(c.right.ring).toBe(s.right.ring)
        expect(c.plugboard).toEqual(s.plugboard)
      }
    }
  })

  it('round trip M4 → I → M4 keeps an equivalent cipher when Beta/thin B sit at A', () => {
    const r = prng(5)
    for (let k = 0; k < 50; k++) {
      const s = randomSettings('M3', r)
      s.reflector = 'UKW-B'
      const m4 = coerceToModel(s, 'M4')
      expect(m4.reflector).toBe('UKW-B-thin')
      expect(m4.greek).toEqual({ rotor: 'Beta', ring: 0, position: 0 })
      const text = 'ENIGMAVERIFICATIONTEXT'
      expect(encryptText(m4, text, { nonLetters: 'remove' }).output).toBe(
        encryptText(s, text, { nonLetters: 'remove' }).output,
      )
    }
  })
})

describe('randomSettings (property)', () => {
  it('is always valid with distinct rotors, 10 plugs and model-appropriate equipment', () => {
    const r = prng(6)
    for (let k = 0; k < 3000; k++) {
      const m = pick(r, MODELS_ALL)
      const s = randomSettings(m, r)
      expect(validateSettings(s)).toEqual([])
      expect(s.plugboard).toHaveLength(10)
      expect(MODELS[m].reflectorIds).toContain(s.reflector)
    }
  })

  it('handles degenerate generators (constant 0, constant just-below-1, exactly 1)', () => {
    for (const m of MODELS_ALL) {
      for (const g of [() => 0, () => 0.9999999999999999, () => 1, () => 0.5]) {
        expect(validateSettings(randomSettings(m, g))).toEqual([])
      }
    }
  })
})

describe('encodeSettings / decodeSettings (property)', () => {
  it('round-trips M4 with 13 plugs and non-A rings', () => {
    const s: MachineSettings = {
      model: 'M4',
      reflector: 'UKW-C-thin',
      greek: { rotor: 'Gamma', ring: 25, position: 13 },
      left: { rotor: 'VIII', ring: 1, position: 25 },
      middle: { rotor: 'VI', ring: 12, position: 0 },
      right: { rotor: 'VII', ring: 24, position: 12 },
      plugboard: parsePlugboard('AZ BY CX DW EV FU GT HS IR JQ KP LO MN').pairs,
    }
    expect(s.plugboard).toHaveLength(13)
    const enc = encodeSettings(s)
    expect(enc).toBe('M4.UKW-C-thin.Gamma-VIII-VI-VII.ZBMY.NZAM.AZ-BY-CX-DW-EV-FU-GT-HS-IR-JQ-KP-LO-MN')
    expect(enc).toMatch(/^[A-Za-z0-9._-]+$/) // URL-safe without escaping
    expect(decodeSettings(enc)).toEqual(s)
    expect(decodeSettings(enc.toLowerCase())).toEqual(s)
  })

  it('round-trips arbitrary valid settings with 0..13 plugs', () => {
    const r = prng(7)
    for (let k = 0; k < 2000; k++) {
      const s = randomSettings(pick(r, MODELS_ALL), r)
      s.plugboard = s.plugboard.slice(0, int(r, 11))
      const extra = Array.from({ length: 26 }, (_, i) => i).filter((l) => !s.plugboard.some(([a, b]) => a === l || b === l))
      while (s.plugboard.length < 13 && extra.length >= 2 && r() < 0.5) {
        s.plugboard.push([extra.shift()!, extra.pop()!])
      }
      const enc = encodeSettings(s)
      expect(enc).toMatch(/^[A-Za-z0-9._-]+$/)
      expect(decodeSettings(enc)).toEqual(s)
    }
  })

  it('decoding mutated strings yields null or valid settings that re-encode stably', () => {
    const r = prng(8)
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.-IVM34ukwthinBetaGamma'
    for (let k = 0; k < 3000; k++) {
      const s = randomSettings(pick(r, MODELS_ALL), r)
      const chars = [...encodeSettings(s)]
      const edits = 1 + int(r, 3)
      for (let e = 0; e < edits; e++) {
        const i = int(r, chars.length + 1)
        const op = r()
        if (op < 0.33) chars.splice(i, 1)
        else if (op < 0.66) chars.splice(i, 0, pick(r, [...alphabet]))
        else chars[Math.min(i, chars.length - 1)] = pick(r, [...alphabet])
      }
      const d = decodeSettings(chars.join(''))
      if (d === null) continue
      expect(validateSettings(d)).toEqual([])
      expect(decodeSettings(encodeSettings(d))).toEqual(d)
    }
  })

  it('rejects reflector / Greek wheel combinations not allowed on the model', () => {
    expect(decodeSettings('M3.UKW-A.I-II-III.AAA.AAA.')).toBeNull()
    expect(decodeSettings('M4.UKW-B.Beta-I-II-III.AAAA.AAAA.')).toBeNull()
    expect(decodeSettings('M4.UKW-B-thin.I-Beta-II-III.AAAA.AAAA.')).toBeNull()
    expect(decodeSettings('I.UKW-B.Beta-II-III.AAA.AAA.')).toBeNull()
    expect(decodeSettings('M3.UKW-B.VI-VII-VIII.AAA.AAA.AB-CD-EF-GH-IJ-KL-MN-OP-QR-ST-UV-WX-YZ')).not.toBeNull()
  })
})

describe('encryptText non-letter handling', () => {
  it('passes astral characters (surrogate pairs) through intact without stepping', () => {
    const s = randomSettings('M4', prng(9))
    const text = 'a😀b 🇺🇦 c'
    const keep = encryptText(s, text, { nonLetters: 'keep' })
    expect(keep.output.replace(/[A-Z]/g, '')).toBe(text.replace(/[a-z]/g, ''))
    expect(keep.output).toHaveLength(text.length)
    expect(keep.traces).toHaveLength(3)
    expect(keep.inputToTrace.filter((x) => x !== null)).toEqual([0, 1, 2])
    expect(encryptText(s, text, { nonLetters: 'remove' }).output).toBe(
      encryptText(s, 'abc', { nonLetters: 'remove' }).output,
    )
  })
})

describe('validateSettings', () => {
  it('flags non-integer and non-finite ring / position values', () => {
    const base: MachineSettings = {
      model: 'I',
      reflector: 'UKW-B' as ReflectorId,
      greek: null,
      left: { rotor: 'I', ring: 0, position: 0 },
      middle: { rotor: 'II', ring: 0, position: 0 },
      right: { rotor: 'III', ring: 0, position: 0 },
      plugboard: [],
    }
    for (const bad of [Number.NaN, 1.5, -1, 26, Number.POSITIVE_INFINITY]) {
      expect(validateSettings({ ...base, left: { rotor: 'I', ring: bad, position: 0 } })).toHaveLength(1)
      expect(validateSettings({ ...base, right: { rotor: 'III', ring: 0, position: bad } })).toHaveLength(1)
    }
  })
})
