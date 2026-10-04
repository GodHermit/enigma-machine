/**
 * Speed of one full phase-1 rotor unit (default tuning): JavaScript (runRotorUnit) vs the
 * WebAssembly kernels with SIMD (phase1.wasm) and without (phase1-scalar.wasm, same algorithm).
 * Also checks that the survivors are identical, so it doubles as the full-length parity check.
 *
 *   yarn vitest run --config scripts/vitest.bench.config.ts scripts/wasm-speed.bench.ts
 *
 *   BENCH_CASES=0,3      indexes into scripts/breaker-cases.ts (default 0: English, 263 letters)
 *   BENCH_UNITS=2        rotor units per case (the true rotor order first, then others)
 *   BENCH_LONG=1         also a 520-letter German message (stages A + B parity and speed)
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { decodeSettings, encryptText } from '../src/lib/enigma'
import { parseNgrams } from '../src/lib/breaker/ngrams'
import type { NgramModel } from '../src/lib/breaker/ngrams'
import { createContext, rotorUnits, runRotorUnit, runRotorUnitWith } from '../src/lib/breaker/search'
import type { RotorUnit } from '../src/lib/breaker/search'
import { lettersOnly } from '../src/lib/breaker/text'
import type { BreakerConfig, BreakerLanguage } from '../src/lib/breaker/types'
import { PASSAGES } from '../src/lib/breaker/data/passages'
import { createWasmStages } from '../src/lib/breaker/wasm/wasm-stages'
import { CASES } from './breaker-cases'

const env = process.env
const CASE_LIST = (env.BENCH_CASES ?? '0').split(',').map(Number)
const UNITS = Number(env.BENCH_UNITS ?? 1)
const root = join(__dirname, '..', 'src', 'lib', 'breaker')
const SIMD = new WebAssembly.Module(readFileSync(join(root, 'wasm', 'phase1.wasm')))
const SCALAR = new WebAssembly.Module(readFileSync(join(root, 'wasm', 'phase1-scalar.wasm')))

const ngramCache = new Map<BreakerLanguage, NgramModel>()
function ngrams(language: BreakerLanguage): NgramModel {
  let model = ngramCache.get(language)
  if (!model) {
    model = parseNgrams(readFileSync(join(root, 'data', `ngrams-${language}.bin`)), language)
    ngramCache.set(language, model)
  }
  return model
}

interface Message {
  name: string
  language: BreakerLanguage
  plain: string
  key: string
}

const LONG: Message = {
  name: 'de 520, 10 plugs (long message)',
  language: 'de',
  plain: PASSAGES.de.map((p) => lettersOnly(p.text)).join('').slice(2000, 2520),
  key: 'I.UKW-B.IV-II-V.KDS.PRH.AQ-BJ-CW-DX-EI-FN-GT-HY-KO-LZ',
}

async function run(m: Message): Promise<void> {
  const settings = decodeSettings(m.key)!
  const cipher = encryptText(settings, m.plain, { nonLetters: 'remove' }).output
  const config: BreakerConfig = {
    ciphertext: cipher,
    model: 'I',
    rotors: ['I', 'II', 'III', 'IV', 'V'],
    reflectors: [settings.reflector],
    greekRotors: [],
    ringSearch: 'right-middle',
    maxPlugs: 10,
    language: m.language,
    crib: null,
    workers: 1,
  }
  const ctx = createContext(config, ngrams(m.language))
  const all = rotorUnits(config)
  const truth = all.findIndex((u) => u.left === settings.left.rotor && u.middle === settings.middle.rotor && u.right === settings.right.rotor)
  const units: RotorUnit[] = Array.from({ length: UNITS }, (_, k) => all[(truth + 17 * k) % all.length])
  for (const unit of units) {
    const name = `${m.name} · ${unit.left}-${unit.middle}-${unit.right}`
    let t = performance.now()
    const js = runRotorUnit(ctx, unit, { keep: 1000 })
    const jsMs = performance.now() - t
    t = performance.now()
    const simd = await runRotorUnitWith(ctx, unit, { keep: 1000 }, createWasmStages(ctx, SIMD))
    const simdMs = performance.now() - t
    t = performance.now()
    const scalar = await runRotorUnitWith(ctx, unit, { keep: 1000 }, createWasmStages(ctx, SCALAR))
    const scalarMs = performance.now() - t
    expect(simd).toEqual(js)
    expect(scalar).toEqual(js)
    console.log(
      `${name} (n=${ctx.layout.n}): JS ${Math.round(jsMs)} ms · WASM scalar ${Math.round(scalarMs)} ms (${(jsMs / scalarMs).toFixed(1)}×)` +
        ` · WASM SIMD ${Math.round(simdMs)} ms (${(jsMs / simdMs).toFixed(1)}×, SIMD gain ${(scalarMs / simdMs).toFixed(2)}×) · survivors identical`,
    )
  }
}

test('phase 1 unit: JavaScript vs WebAssembly', async () => {
  for (const index of CASE_LIST) await run(CASES[index])
  if (env.BENCH_LONG === '1') await run(LONG)
})
