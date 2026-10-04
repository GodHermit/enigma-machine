import { describe, expect, it } from 'vitest'
import { encryptText } from '../enigma/machine'
import { randomSettings } from '../enigma/settings'
import type { MachineSettings, ModelId } from '../enigma/types'
import { buildClassTable, cipherLayout, decodeClassTable, decodeWith } from './climb'
import { mulberry32 } from './random'
import {
  buildTable,
  compileKey,
  decipherCodes,
  keyFromSettings,
  normalizeSettings,
  plugMap,
  plugPairs,
  settingsFromKey,
} from './scrambler'
import { fromCodes, toCodes } from './text'

const MESSAGE =
  'DASOBERKOMMANDODERWEHRMACHTGIBTBEKANNTXAACHENXAACHENISTGERETTETXDURCHGEBUENDELTENEINSATZDERHILFSKRAEFTE'.repeat(
    8,
  )

function randomKeys(model: ModelId, count: number, seed: number): MachineSettings[] {
  const rand = mulberry32(seed)
  return Array.from({ length: count }, () => randomSettings(model, rand))
}

describe('scrambler model', () => {
  it.each(['I', 'M3', 'M4'] as const)('deciphers exactly like encryptText (%s)', (model) => {
    for (const s of randomKeys(model, 12, model.length * 101)) {
      const cipher = encryptText(s, MESSAGE, { nonLetters: 'remove' }).output
      const plain = decipherCodes(keyFromSettings(s), plugMap(s.plugboard), toCodes(cipher))
      expect(fromCodes(plain)).toBe(MESSAGE)
    }
  })

  it('position-major and class-major tables agree with the direct decipherment', () => {
    for (const s of randomKeys('M3', 5, 9)) {
      const codes = toCodes(encryptText(s, MESSAGE, { nonLetters: 'remove' }).output)
      const P = plugMap(s.plugboard)
      const c = compileKey(keyFromSettings(s), codes.length)
      const pos = decodeWith(codes, buildTable(c), P, new Uint8Array(codes.length))
      const layout = cipherLayout(codes)
      const tab = new Uint8Array(codes.length * 26)
      buildClassTable(layout, c.inner, c.rf, c.rb, c.rBase, c.iBase, tab)
      const cls = decodeClassTable(layout, tab, P, new Uint8Array(codes.length))
      expect(fromCodes(pos)).toBe(MESSAGE)
      expect(fromCodes(cls)).toBe(MESSAGE)
    }
  })

  it('normalisation (left / Greek ring folded into the position) keeps the plaintext', () => {
    for (const model of ['I', 'M3', 'M4'] as const) {
      for (const s of randomKeys(model, 10, 77)) {
        const n = normalizeSettings(s)
        expect(n.left.ring).toBe(0)
        if (n.greek) expect(n.greek.ring).toBe(0)
        expect(n.middle).toEqual(s.middle)
        expect(n.right).toEqual(s.right)
        const a = encryptText(s, MESSAGE, { nonLetters: 'remove' }).output
        const b = encryptText(n, MESSAGE, { nonLetters: 'remove' }).output
        expect(b).toBe(a)
      }
    }
  })

  it('round-trips settings ↔ rotor key and plugboard pairs ↔ involution', () => {
    const [s] = randomKeys('M4', 1, 5)
    const back = settingsFromKey('M4', keyFromSettings(s), plugMap(s.plugboard))
    expect(back.plugboard).toHaveLength(s.plugboard.length)
    expect(plugPairs(plugMap(s.plugboard)).map(([a, b]) => a * 26 + b).sort()).toEqual(
      s.plugboard.map(([a, b]) => Math.min(a, b) * 26 + Math.max(a, b)).sort(),
    )
    expect(encryptText(back, MESSAGE).output).toBe(encryptText(s, MESSAGE).output)
  })
})
