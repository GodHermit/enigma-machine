import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, HISTORICAL_PLUGS, MODELS } from './constants'
import { toLetter } from './letters'
import { encryptText } from './machine'
import { parsePlugboard } from './plugboard'
import {
  cloneSettings,
  coerceToModel,
  decodeSettings,
  defaultSettings,
  encodeSettings,
  randomSettings,
  settingsEqual,
  validateSettings,
} from './settings'
import type { MachineSettings, ModelId, PlugPair } from './types'

const L = (s: string): number => toLetter(s) as number

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const M4: MachineSettings = {
  model: 'M4',
  reflector: 'UKW-B-thin',
  greek: { rotor: 'Beta', ring: 0, position: L('V') },
  left: { rotor: 'II', ring: 0, position: L('J') },
  middle: { rotor: 'IV', ring: 0, position: L('N') },
  right: { rotor: 'I', ring: 21, position: L('A') },
  plugboard: parsePlugboard('AT BL DF').pairs,
}

const fields = (s: MachineSettings) => validateSettings(s).map((i) => i.field)

describe('validateSettings', () => {
  it('accepts the defaults and valid settings', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual([])
    expect(validateSettings(M4)).toEqual([])
    for (const m of ['I', 'M3', 'M4'] as ModelId[]) expect(validateSettings(defaultSettings(m))).toEqual([])
  })

  it('detects duplicate rotors', () => {
    const s = { ...DEFAULT_SETTINGS, right: { rotor: 'I' as const, ring: 0, position: 0 } }
    const issues = validateSettings(s)
    expect(issues).toHaveLength(1)
    expect(issues[0].field).toBe('right')
    expect(issues[0].message).toMatch(/already/)
  })

  it('detects rotors and reflectors not allowed on the model', () => {
    expect(fields({ ...DEFAULT_SETTINGS, left: { rotor: 'VI', ring: 0, position: 0 } })).toEqual(['left'])
    expect(fields({ ...DEFAULT_SETTINGS, left: { rotor: 'Beta', ring: 0, position: 0 } })).toEqual(['left'])
    expect(fields({ ...DEFAULT_SETTINGS, reflector: 'UKW-B-thin' })).toEqual(['reflector'])
    expect(fields({ ...DEFAULT_SETTINGS, model: 'M3', reflector: 'UKW-A' })).toEqual(['reflector'])
    expect(fields({ ...M4, reflector: 'UKW-B' })).toEqual(['reflector'])
  })

  it('requires a Greek wheel exactly on the M4', () => {
    expect(fields({ ...M4, greek: null })).toEqual(['greek'])
    expect(fields({ ...M4, greek: { rotor: 'III', ring: 0, position: 0 } })).toEqual(['greek'])
    expect(fields({ ...DEFAULT_SETTINGS, greek: { rotor: 'Beta', ring: 0, position: 0 } })).toEqual(['greek'])
  })

  it('checks ring and position ranges', () => {
    expect(fields({ ...DEFAULT_SETTINGS, left: { rotor: 'I', ring: 26, position: 0 } })).toEqual(['left'])
    expect(fields({ ...DEFAULT_SETTINGS, middle: { rotor: 'II', ring: 0, position: -1 } })).toEqual(['middle'])
    expect(fields({ ...DEFAULT_SETTINGS, right: { rotor: 'III', ring: 1.5, position: 0 } })).toEqual(['right'])
  })

  it('detects plugboard problems', () => {
    const reuse: PlugPair[] = [
      [0, 1],
      [1, 2],
    ]
    expect(fields({ ...DEFAULT_SETTINGS, plugboard: reuse })).toEqual(['plugboard'])
    expect(fields({ ...DEFAULT_SETTINGS, plugboard: [[3, 3]] })).toEqual(['plugboard'])
    expect(fields({ ...DEFAULT_SETTINGS, plugboard: [[3, 30]] })).toEqual(['plugboard'])
    const fourteen: PlugPair[] = Array.from({ length: 14 }, (_, i) => [i, 25 - i] as PlugPair)
    expect(fields({ ...DEFAULT_SETTINGS, plugboard: fourteen })).toContain('plugboard')
  })

  it('reports an unknown model', () => {
    expect(fields({ ...DEFAULT_SETTINGS, model: 'X' as ModelId })).toEqual(['model'])
  })
})

describe('defaultSettings', () => {
  it('returns independent copies per model', () => {
    const a = defaultSettings('I')
    expect(a).toEqual(DEFAULT_SETTINGS)
    a.left.ring = 5
    expect(DEFAULT_SETTINGS.left.ring).toBe(0)
    expect(defaultSettings('M3').model).toBe('M3')
    const m4 = defaultSettings('M4')
    expect(m4.reflector).toBe('UKW-B-thin')
    expect(m4.greek?.rotor).toBe('Beta')
    // M4 defaults encipher exactly like the Enigma I defaults (thin B + Beta at A ≡ UKW-B)
    expect(encryptText(m4, 'AAAAA', { nonLetters: 'keep' }).output).toBe('BDZGO')
  })
})

describe('coerceToModel', () => {
  it('keeps everything that is allowed', () => {
    const s = coerceToModel(DEFAULT_SETTINGS, 'M3')
    expect(s).toEqual({ ...DEFAULT_SETTINGS, model: 'M3' })
  })

  it('M3 → I replaces disallowed rotors with unused allowed ones', () => {
    const s: MachineSettings = {
      ...DEFAULT_SETTINGS,
      model: 'M3',
      reflector: 'UKW-C',
      left: { rotor: 'VI', ring: 3, position: 4 },
      middle: { rotor: 'I', ring: 0, position: 0 },
      right: { rotor: 'VIII', ring: 7, position: 9 },
      plugboard: parsePlugboard('AB CD').pairs,
    }
    const c = coerceToModel(s, 'I')
    expect(validateSettings(c)).toEqual([])
    expect(c.middle.rotor).toBe('I')
    expect(c.left).toEqual({ rotor: 'II', ring: 3, position: 4 })
    expect(c.right).toEqual({ rotor: 'III', ring: 7, position: 9 })
    expect(c.reflector).toBe('UKW-C')
    expect(c.plugboard).toEqual(s.plugboard)
  })

  it('to M4 maps thick → thin reflector and adds a Greek wheel; back again removes it', () => {
    const toM4 = coerceToModel({ ...DEFAULT_SETTINGS, reflector: 'UKW-C' }, 'M4')
    expect(validateSettings(toM4)).toEqual([])
    expect(toM4.reflector).toBe('UKW-C-thin')
    expect(toM4.greek?.rotor).toBe('Gamma')
    const fromA = coerceToModel({ ...DEFAULT_SETTINGS, reflector: 'UKW-A' }, 'M4')
    expect(fromA.reflector).toBe('UKW-B-thin')
    expect(fromA.greek?.rotor).toBe('Beta')
    const back = coerceToModel(M4, 'I')
    expect(validateSettings(back)).toEqual([])
    expect(back.greek).toBeNull()
    expect(back.reflector).toBe('UKW-B')
    expect(back.left.rotor).toBe('II')
    expect(back.middle.rotor).toBe('IV')
    expect(back.right).toEqual(M4.right)
  })

  it('always produces valid settings', () => {
    const rand = rng(11)
    const models: ModelId[] = ['I', 'M3', 'M4']
    for (let k = 0; k < 60; k++) {
      const s = randomSettings(models[k % 3], rand)
      for (const m of models) expect(validateSettings(coerceToModel(s, m))).toEqual([])
    }
  })

  it('does not mutate its input', () => {
    const copy = cloneSettings(M4)
    coerceToModel(M4, 'I')
    expect(M4).toEqual(copy)
  })
})

describe('randomSettings', () => {
  it('produces valid settings with distinct rotors and 10 plugs', () => {
    const rand = rng(1)
    for (const m of ['I', 'M3', 'M4'] as ModelId[]) {
      for (let k = 0; k < 50; k++) {
        const s = randomSettings(m, rand)
        expect(validateSettings(s)).toEqual([])
        expect(s.model).toBe(m)
        expect(s.plugboard).toHaveLength(HISTORICAL_PLUGS)
        expect(new Set([s.left.rotor, s.middle.rotor, s.right.rotor]).size).toBe(3)
        expect(s.greek !== null).toBe(MODELS[m].hasGreek)
      }
    }
  })

  it('works with the default Math.random and with extreme generators', () => {
    expect(validateSettings(randomSettings('M4'))).toEqual([])
    expect(validateSettings(randomSettings('I', () => 0))).toEqual([])
    expect(validateSettings(randomSettings('M3', () => 0.9999999999))).toEqual([])
  })
})

describe('encodeSettings / decodeSettings', () => {
  it('uses the readable dotted format', () => {
    expect(encodeSettings(M4)).toBe('M4.UKW-B-thin.Beta-II-IV-I.AAAV.VJNA.AT-BL-DF')
    expect(encodeSettings(DEFAULT_SETTINGS)).toBe('I.UKW-B.I-II-III.AAA.AAA.')
  })

  it('round-trips losslessly', () => {
    expect(decodeSettings(encodeSettings(M4))).toEqual(M4)
    expect(decodeSettings(encodeSettings(DEFAULT_SETTINGS))).toEqual(DEFAULT_SETTINGS)
    const rand = rng(77)
    for (let k = 0; k < 60; k++) {
      const s = randomSettings((['I', 'M3', 'M4'] as ModelId[])[k % 3], rand)
      const decoded = decodeSettings(encodeSettings(s))
      expect(decoded).toEqual(s)
      expect(settingsEqual(decoded!, s)).toBe(true)
    }
  })

  it('is case-insensitive, URL-decodes and accepts a missing plug section', () => {
    expect(decodeSettings('m4.ukw-b-thin.beta-ii-iv-i.aaav.vjna.at-bl-df')).toEqual(M4)
    expect(decodeSettings(encodeURIComponent(encodeSettings(M4)))).toEqual(M4)
    expect(decodeSettings('I.UKW-B.I-II-III.AAA.AAA')).toEqual(DEFAULT_SETTINGS)
  })

  it('rejects malformed or invalid strings', () => {
    const bad = [
      '',
      'garbage',
      'X.UKW-B.I-II-III.AAA.AAA.',
      'I.UKW-Z.I-II-III.AAA.AAA.',
      'I.UKW-B.I-II.AA.AA.',
      'I.UKW-B.I-II-IX.AAA.AAA.',
      'I.UKW-B.I-I-III.AAA.AAA.',
      'I.UKW-B.I-II-VI.AAA.AAA.',
      'I.UKW-B-thin.I-II-III.AAA.AAA.',
      'I.UKW-B.I-II-III.AA1.AAA.',
      'I.UKW-B.I-II-III.AAA.AAAA.',
      'I.UKW-B.I-II-III.AAA.AAA.AB-AC',
      'I.UKW-B.I-II-III.AAA.AAA.A',
      'M4.UKW-B-thin.II-IV-I.AAA.AAA.',
      'M4.UKW-B-thin.III-II-IV-I.AAAA.AAAA.',
      'I.UKW-B.I-II-III.AAA.AAA..extra',
      '%E0%A4%A',
    ]
    for (const b of bad) expect(decodeSettings(b)).toBeNull()
  })
})
