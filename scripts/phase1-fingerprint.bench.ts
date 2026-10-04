/**
 * Fingerprint of phase 1 output (survivors of a few rotor orders on fixed messages), to prove
 * refactors and other backends (GPU) produce bit-identical results.
 *   BENCH_OUT=file yarn vitest run --config scripts/vitest.bench.config.ts scripts/phase1-fingerprint.bench.ts
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'vitest'
import { decodeSettings, encryptText } from '../src/lib/enigma'
import { parseNgrams } from '../src/lib/breaker/ngrams'
import { createContext, rotorUnits, runRotorUnit } from '../src/lib/breaker/search'
import type { BreakerConfig } from '../src/lib/breaker/types'
import { CASES } from './breaker-cases'

test('phase 1 fingerprint', () => {
  const lines: string[] = []
  for (const index of [0, 3, 7]) {
    const c = CASES[index]
    const settings = decodeSettings(c.key)!
    const cipher = encryptText(settings, c.plain, { nonLetters: 'remove' }).output
    const config: BreakerConfig = { ciphertext: cipher, model: 'I', rotors: ['I', 'II', 'III', 'IV', 'V'], reflectors: [settings.reflector], greekRotors: [], ringSearch: 'right-middle', maxPlugs: 10, language: c.language, crib: index === 3 ? { text: c.plain.slice(20, 32), position: null } : null, workers: 1 }
    const ngrams = parseNgrams(readFileSync(join(__dirname, '..', 'src', 'lib', 'breaker', 'data', `ngrams-${c.language}.bin`)), c.language)
    const ctx = createContext(config, ngrams)
    const units = rotorUnits(config)
    const truth = units.findIndex((u) => u.left === settings.left.rotor && u.middle === settings.middle.rotor && u.right === settings.right.rotor)
    for (const u of [units[truth], units[(truth + 17) % units.length]]) {
      const { survivors, keys } = runRotorUnit(ctx, u, { keep: 200 })
      const body = survivors.map((s) => `${s.key.posL},${s.key.posM},${s.key.posR},${s.key.ringM},${s.key.ringR}:${s.score}:${s.ioc}:${s.plugs.join('')}`).join('|')
      let h = 0x811c9dc5
      for (let i = 0; i < body.length; i++) h = Math.imul(h ^ body.charCodeAt(i), 0x01000193)
      lines.push(`case ${index} ${u.left}-${u.middle}-${u.right} keys=${keys} n=${survivors.length} top=${survivors[0]?.score} hash=${(h >>> 0).toString(16)}`)
    }
  }
  const out = process.env.BENCH_OUT
  if (out) appendFileSync(out, lines.join('\n') + '\n')
  else console.log(lines.join('\n'))
})
