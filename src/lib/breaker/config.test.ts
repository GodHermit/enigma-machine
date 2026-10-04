import { describe, expect, it } from 'vitest'
import { MODELS } from '../enigma/constants'
import { encryptText } from '../enigma/machine'
import { validateSettings } from '../enigma/settings'
import { defaultBreakerConfig, estimateWork, KEYS_PER_SECOND_PER_WORKER, validateBreakerConfig, WASM_KEYS_PER_SECOND_PER_WORKER } from './config'
import { describeKey, sampleChallenge } from './samples'
import { indexOfCoincidence } from './text'

describe('defaultBreakerConfig', () => {
  it('uses the model’s rotors and reflector B', () => {
    const i = defaultBreakerConfig('I')
    expect(i).toMatchObject({
      model: 'I',
      rotors: ['I', 'II', 'III', 'IV', 'V'],
      reflectors: ['UKW-B'],
      ringSearch: 'right-middle',
      maxPlugs: 10,
      language: 'de',
      crib: null,
      ciphertext: '',
    })
    expect(i.workers).toBeGreaterThanOrEqual(1)
    expect(defaultBreakerConfig('M3')).toMatchObject({ rotors: MODELS.M3.rotorIds, reflectors: ['UKW-B'] })
    expect(defaultBreakerConfig('M4')).toMatchObject({
      rotors: MODELS.M4.rotorIds,
      reflectors: ['UKW-B-thin'],
      greekRotors: ['Beta', 'Gamma'],
    })
    expect(defaultBreakerConfig()).toEqual(defaultBreakerConfig('I'))
    // A fresh object every call.
    expect(defaultBreakerConfig('I').rotors).not.toBe(defaultBreakerConfig('I').rotors)
  })
})

describe('estimateWork', () => {
  const cipher = 'X'.repeat(300)

  it('counts rotor orders and phase-1 keys', () => {
    const i = estimateWork({ ...defaultBreakerConfig('I'), ciphertext: cipher, workers: 1 })
    expect(i.orders).toBe(60)
    expect(i.keys).toBe(60 * 17576)
    const m3 = estimateWork({ ...defaultBreakerConfig('M3'), ciphertext: cipher, workers: 1 })
    expect(m3.orders).toBe(336)
    expect(m3.keys).toBe(336 * 17576)
    const m4 = estimateWork({ ...defaultBreakerConfig('M4'), ciphertext: cipher, workers: 1 })
    expect(m4.orders).toBe(336 * 2)
    expect(m4.keys).toBe(336 * 2 * 26 * 17576)
  })

  it('gives plausible, monotone times', () => {
    const base = { ...defaultBreakerConfig('I'), ciphertext: cipher }
    const one = estimateWork({ ...base, workers: 1 }).seconds
    const eight = estimateWork({ ...base, workers: 8 }).seconds
    // Phase 1 alone: keys / throughput (the default engine is WebAssembly SIMD).
    expect(one).toBeGreaterThan((60 * 17576) / WASM_KEYS_PER_SECOND_PER_WORKER)
    const js = estimateWork({ ...base, workers: 1, cpuEngine: 'js' }).seconds
    expect(js).toBeGreaterThan((60 * 17576) / KEYS_PER_SECOND_PER_WORKER)
    expect(js).toBeGreaterThan(one * 5)
    expect(one).toBeLessThan(3600)
    expect(eight).toBeLessThan(one / 6)
    expect(estimateWork({ ...base, workers: 1 }, WASM_KEYS_PER_SECOND_PER_WORKER * 2).seconds).toBeLessThan(one)
    expect(estimateWork({ ...base, ringSearch: 'none', workers: 1 }).seconds).toBeLessThan(one)
    // 'all' repeats phase 1 through every left ring: same rotor orders, 26× the keys.
    const all = estimateWork({ ...base, ringSearch: 'all', workers: 1 })
    expect(all).toMatchObject({ orders: 60, keys: 26 * 60 * 17576 })
    expect(all.seconds).toBeGreaterThan(one * 20)
    expect(estimateWork({ ...base, ciphertext: 'X'.repeat(600), workers: 1 }).seconds).toBeGreaterThan(one)
    const m4 = estimateWork({ ...defaultBreakerConfig('M4'), ciphertext: cipher, workers: 8 }).seconds
    expect(m4).toBeGreaterThan(eight * 100)
    // Empty / invalid selections cost nothing rather than NaN.
    const none = estimateWork({ ...base, rotors: ['I', 'II'] })
    expect(none).toMatchObject({ orders: 0, keys: 0 })
    expect(Number.isFinite(none.seconds)).toBe(true)
  })
})

describe('validateBreakerConfig', () => {
  const ok = { ...defaultBreakerConfig('I'), ciphertext: 'QWERTZUIOPASDFGHJKLYXCVBNM' }

  it('accepts a sensible config', () => {
    expect(validateBreakerConfig(ok)).toBeNull()
    expect(validateBreakerConfig({ ...ok, exactPlugs: true })).toBeNull()
    expect(validateBreakerConfig({ ...ok, ringSearch: 'all' })).toBeNull()
    expect(validateBreakerConfig({ ...ok, ringSearch: 'left' as unknown as 'all' })).toMatch(/ring search/)
    expect(validateBreakerConfig({ ...ok, exactPlugs: 'yes' as unknown as boolean })).toMatch(/exactPlugs/)
  })

  it('reports problems', () => {
    expect(validateBreakerConfig({ ...ok, ciphertext: 'ABC' })).toMatch(/at least 10 letters/)
    expect(validateBreakerConfig({ ...ok, rotors: ['I', 'II'] })).toMatch(/three rotors/)
    expect(validateBreakerConfig({ ...ok, reflectors: ['UKW-B-thin'] })).toMatch(/reflector/)
    expect(validateBreakerConfig({ ...defaultBreakerConfig('M4'), ciphertext: ok.ciphertext, greekRotors: [] })).toMatch(/Greek/)
    expect(validateBreakerConfig({ ...ok, maxPlugs: 14 })).toMatch(/plugs/)
    // Q is at offset 0 of both: the crib cannot start there, and fits nowhere else either.
    expect(validateBreakerConfig({ ...ok, crib: { text: 'Q', position: 0 } })).toMatch(/cannot sit/)
    expect(validateBreakerConfig({ ...ok, ciphertext: 'AAAAAAAAAAAA', crib: { text: 'A', position: null } })).toMatch(
      /fits nowhere/,
    )
    expect(validateBreakerConfig({ ...ok, crib: { text: 'ABC', position: 30 } })).toMatch(/outside/)
    expect(validateBreakerConfig({ ...ok, crib: { text: 'WETTER', position: null } })).toBeNull()
  })
})

describe('sampleChallenge', () => {
  it.each(['I', 'M3', 'M4'] as const)('makes a valid, reproducible challenge (%s)', (model) => {
    const a = sampleChallenge({ model, language: 'de', seed: 42 })
    const b = sampleChallenge({ model, language: 'de', seed: 42 })
    expect(b).toEqual(a)
    expect(validateSettings(a.settings)).toEqual([])
    expect(a.settings.model).toBe(model)
    expect(a.settings.plugboard).toHaveLength(10)
    expect(a.plaintext).toMatch(/^[A-Z]{300}$/)
    expect(a.ciphertext).toMatch(/^[A-Z]{300}$/)
    expect(encryptText(a.settings, a.plaintext, { nonLetters: 'remove' }).output).toBe(a.ciphertext)
    expect(encryptText(a.settings, a.ciphertext, { nonLetters: 'remove' }).output).toBe(a.plaintext)
    expect(a.source).toMatch(/Kafka|Hauff/)
    expect(indexOfCoincidence(a.plaintext)).toBeGreaterThan(0.06)
  })

  it('only uses keys inside the default search space of the model', () => {
    for (const model of ['I', 'M3', 'M4'] as const) {
      const d = defaultBreakerConfig(model)
      for (let seed = 0; seed < 60; seed++) {
        const s = sampleChallenge({ model, language: seed % 2 ? 'en' : 'de', seed }).settings
        expect(d.reflectors).toContain(s.reflector)
        for (const slot of [s.left, s.middle, s.right]) expect(d.rotors).toContain(slot.rotor)
        if (model === 'M4') expect(d.greekRotors).toContain(s.greek?.rotor)
        else expect(s.greek).toBeNull()
        expect(validateSettings(s)).toEqual([])
      }
    }
  })

  it('honours an explicit search space', () => {
    for (let seed = 0; seed < 20; seed++) {
      const s = sampleChallenge({
        model: 'I',
        language: 'de',
        seed,
        rotors: ['I', 'II', 'III'],
        reflectors: ['UKW-C'],
      }).settings
      expect(s.reflector).toBe('UKW-C')
      expect([s.left.rotor, s.middle.rotor, s.right.rotor].sort()).toEqual(['I', 'II', 'III'])
    }
  })

  it('honours language, length and plug count', () => {
    const en = sampleChallenge({ model: 'I', language: 'en', length: 150, plugs: 6, seed: 1 })
    expect(en.plaintext).toHaveLength(150)
    expect(en.settings.plugboard).toHaveLength(6)
    expect(en.source).toMatch(/Doyle|Stevenson/)
    const long = sampleChallenge({ model: 'I', language: 'en', length: 1200, plugs: 13, seed: 2 })
    expect(long.plaintext).toHaveLength(1200)
    expect(long.settings.plugboard).toHaveLength(13)
    expect(validateSettings(long.settings)).toEqual([])
    expect(sampleChallenge({ model: 'I', language: 'de', seed: 3 }).ciphertext).not.toBe(
      sampleChallenge({ model: 'I', language: 'de', seed: 4 }).ciphertext,
    )
  })
})

describe('describeKey', () => {
  it('formats a key in one line', () => {
    const s = sampleChallenge({ model: 'I', language: 'de', seed: 5 }).settings
    const text = describeKey({
      ...s,
      reflector: 'UKW-B',
      left: { rotor: 'II', ring: 0, position: 0 },
      middle: { rotor: 'IV', ring: 13, position: 3 },
      right: { rotor: 'I', ring: 21, position: 20 },
    })
    expect(text).toBe('Enigma I · UKW-B · II IV I · rings 01 14 22 · start ADU · 10 plugs')
    const m4 = describeKey({
      model: 'M4',
      reflector: 'UKW-B-thin',
      greek: { rotor: 'Beta', ring: 0, position: 21 },
      left: { rotor: 'II', ring: 0, position: 9 },
      middle: { rotor: 'IV', ring: 0, position: 13 },
      right: { rotor: 'I', ring: 21, position: 0 },
      plugboard: [[0, 19]],
    })
    expect(m4).toBe('Enigma M4 · UKW-B (thin) · Beta II IV I · rings 01 01 01 22 · start VJNA · 1 plug')
  })
})
