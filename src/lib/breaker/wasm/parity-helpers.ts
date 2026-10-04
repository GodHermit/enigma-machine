/**
 * Test-only helpers of the WebAssembly phase-1 parity tests (wasm-stages.test.ts,
 * wasm-parity.test.ts): reads the committed .wasm builds from disk (vitest runs in node, where the
 * app's `?url` + fetch path has no server) and compares the kernels with the JS stages.
 */
import { expect } from 'vitest'
import { encryptText } from '../../enigma/machine'
import { randomSettings } from '../../enigma/settings'
import type { MachineSettings } from '../../enigma/types'
import { PASSAGES } from '../data/passages'
import { mulberry32 } from '../random'
import { createContext, innerFor, planUnit, refineSelection, refineStage, rotorUnits, screenStage } from '../search'
import type { RotorUnit, SearchContext, SearchTuning } from '../search'
import { testNgrams } from '../test-data'
import { lettersOnly } from '../text'
import type { BreakerConfig, BreakerLanguage } from '../types'
import { createWasmBackend } from './wasm-stages'

interface NodeFs {
  readFileSync(path: URL): Uint8Array<ArrayBuffer>
}

export function wasmBytes(file: string): Uint8Array<ArrayBuffer> {
  const proc = (globalThis as unknown as { process?: { getBuiltinModule?: (id: string) => unknown } }).process
  const fs = proc?.getBuiltinModule?.('node:fs') as NodeFs | undefined
  if (!fs) throw new Error('needs Node.js ≥ 22.3')
  // Not `new URL(literal, import.meta.url)`: Vite would rewrite that into an asset URL.
  const here = import.meta.url
  return fs.readFileSync(new URL(`./${file}`, here))
}

export const wasmModule = (file: string): WebAssembly.Module => new WebAssembly.Module(wasmBytes(file))

export const SIMD = wasmModule('phase1.wasm')
export const SCALAR = wasmModule('phase1-scalar.wasm')

export const text = (language: BreakerLanguage, from: number, length: number): string =>
  PASSAGES[language].map((p) => lettersOnly(p.text)).join('').slice(from, from + length)

export interface Case {
  name: string
  language: BreakerLanguage
  plain: string
  settings: MachineSettings
  config?: Partial<BreakerConfig>
  tuning?: Partial<SearchTuning>
  /** Rotor units (indexes into rotorUnits(config)); -1 = the true rotor order. */
  units: number[]
}

export function settings(seed: number, overrides: Partial<MachineSettings> = {}): MachineSettings {
  return { ...randomSettings('I', mulberry32(seed)), reflector: 'UKW-B', ...overrides }
}

/** Fewer screen variants, pairs and refined positions: the same code paths in a fraction of the JS time. */
export const LIGHT: Partial<SearchTuning> = { screenRings: [0, 13], screenLeftAt: [0.5], screenLetters: 16, refineFraction: 0.02 }

export const DEFAULT_CASE: Case = {
  name: 'German 60 letters, 10 plugs, default tuning',
  language: 'de',
  plain: text('de', 100, 60),
  settings: settings(11),
  units: [-1],
}

export const LONG_CASE: Case = {
  name: 'German 430 letters (long message), 10 plugs',
  language: 'de',
  plain: text('de', 1500, 430),
  settings: settings(15),
  tuning: LIGHT,
  units: [-1],
}

export const LIGHT_CASES: Case[] = [
  {
    name: 'English 60 letters, no plugboard, ioc ranking, refineKeep 3, letter limits',
    language: 'en',
    plain: text('en', 40, 60),
    settings: settings(12, { plugboard: [] }),
    tuning: { ...LIGHT, rankBy: 'ioc', refineKeep: 3, screenLetters: 12, refineLetters: 20 },
    units: [-1, 7],
  },
  {
    name: 'German 55 letters, crib, bigram screen, ringSearch right, 6 plugs',
    language: 'de',
    plain: text('de', 900, 55),
    settings: settings(13),
    config: { ringSearch: 'right', crib: { text: text('de', 910, 12), position: null }, maxPlugs: 6 },
    tuning: { ...LIGHT, screenRankBy: 'bigram', finalPasses: 2 },
    units: [-1, 30],
  },
  {
    name: 'English 50 letters, ringSearch none, 13 plugs, 2 screen / refine passes',
    language: 'en',
    plain: text('en', 700, 50),
    settings: settings(14),
    config: { ringSearch: 'none', maxPlugs: 13 },
    tuning: { screenPasses: 2, refinePasses: 2, refineFraction: 0.05 },
    units: [-1],
  },
]

export function contextOf(c: Case): { ctx: SearchContext; units: RotorUnit[] } {
  const cipher = encryptText(c.settings, c.plain, { nonLetters: 'remove' }).output
  const config: BreakerConfig = {
    ciphertext: cipher,
    model: 'I',
    rotors: ['I', 'II', 'III', 'IV', 'V'],
    reflectors: ['UKW-B'],
    greekRotors: [],
    ringSearch: 'right-middle',
    maxPlugs: 10,
    language: c.language,
    crib: null,
    workers: 1,
    ...c.config,
  }
  const ctx = createContext(config, testNgrams(c.language), c.tuning)
  const all = rotorUnits(config)
  const truth = all.findIndex((u) => u.left === c.settings.left.rotor && u.middle === c.settings.middle.rotor && u.right === c.settings.right.rotor)
  return { ctx, units: c.units.map((k) => all[k < 0 ? truth : k]) }
}

/** Stage A + B of the JS and of a WASM build on one unit / Greek position must agree exactly. */
export function expectStagesEqual(ctx: SearchContext, unit: RotorUnit, module: WebAssembly.Module, g = 0): void {
  const plan = planUnit(ctx, unit)
  const inner = innerFor(ctx, unit.reflector, unit.greek, g, unit.left, unit.middle)
  const backend = createWasmBackend(ctx, module)
  const js = screenStage(ctx, plan, inner)
  const wasm = backend.screen(plan, inner)
  expect(wasm.screen).toEqual(js.screen)
  expect(wasm.screenP).toEqual(js.screenP)
  const selection = refineSelection(ctx, js.screen)
  expect(backend.refine(plan, inner, js, selection)).toEqual(refineStage(ctx, plan, inner, js, selection))
}
