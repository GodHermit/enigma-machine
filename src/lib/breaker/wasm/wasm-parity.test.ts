/**
 * Larger WebAssembly phase-1 parity cases (own file so vitest runs them next to
 * wasm-stages.test.ts): default tuning, a long message, an M4 unit at a Greek wheel position.
 */
import { describe, expect, it } from 'vitest'
import { encryptText } from '../../enigma/machine'
import { randomSettings } from '../../enigma/settings'
import type { GreekRotorId, RotorId } from '../../enigma/types'
import { mulberry32 } from '../random'
import { createContext, rotorUnits } from '../search'
import { testNgrams } from '../test-data'
import type { BreakerConfig } from '../types'
import { DEFAULT_CASE, LIGHT, LONG_CASE, SIMD, contextOf, expectStagesEqual, text } from './parity-helpers'
import { wasmUnsupportedReason } from './wasm-stages'

describe('WebAssembly phase 1 (larger cases)', () => {
  for (const c of [DEFAULT_CASE, LONG_CASE]) {
    it(`stages A and B equal the JS: ${c.name}`, () => {
      const { ctx, units } = contextOf(c)
      expect(wasmUnsupportedReason(ctx)).toBeNull()
      for (const unit of units) expectStagesEqual(ctx, unit, SIMD)
    }, 120_000)
  }

  it('stages A and B equal the JS: M4 unit at a Greek wheel position', () => {
    const s = randomSettings('M4', mulberry32(21))
    const cipher = encryptText(s, text('de', 300, 60), { nonLetters: 'remove' }).output
    const config: BreakerConfig = {
      ciphertext: cipher,
      model: 'M4',
      rotors: [s.left.rotor, s.middle.rotor, s.right.rotor] as RotorId[],
      reflectors: [s.reflector],
      greekRotors: [s.greek!.rotor as GreekRotorId],
      ringSearch: 'right-middle',
      maxPlugs: 10,
      language: 'de',
      crib: null,
      workers: 1,
    }
    const ctx = createContext(config, testNgrams('de'), LIGHT)
    const unit = rotorUnits(config).find((u) => u.left === s.left.rotor && u.middle === s.middle.rotor && u.right === s.right.rotor)!
    expect(unit.greek).not.toBeNull()
    expectStagesEqual(ctx, unit, SIMD, 17)
  }, 120_000)
})
