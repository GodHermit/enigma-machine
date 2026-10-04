/**
 * Parity of the WebAssembly phase-1 kernels with the JavaScript stages (stage A screen values and
 * plugboards, stage B finalists, unit survivors: exactly equal), plus loading and delegation.
 * Larger cases: wasm-parity.test.ts; a full-length unit: scripts/wasm-speed.bench.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cpuStages, innerFor, planUnit, runRotorUnit, runRotorUnitWith } from '../search'
import { LIGHT_CASES, SCALAR, SIMD, contextOf, expectStagesEqual, wasmBytes } from './parity-helpers'
import {
  MAX_WASM_LETTERS,
  createWasmBackend,
  createWasmStages,
  loadPhase1Wasm,
  wasmSimdSupported,
  wasmUnsupportedReason,
} from './wasm-stages'

describe('WebAssembly phase 1', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads and caches the bundled module', async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).toMatch(/phase1\.wasm/)
      return new Response(wasmBytes('phase1.wasm'))
    })
    vi.stubGlobal('fetch', fetch)
    const a = await loadPhase1Wasm()
    const b = await loadPhase1Wasm()
    expect(a).toBe(b)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(WebAssembly.Module.exports(a).map((e) => e.name)).toContain('screen')
  })

  it('detects SIMD support (node has it)', () => {
    const { ctx } = contextOf(LIGHT_CASES[0])
    expect(wasmSimdSupported()).toBe(true)
    expect(createWasmBackend(ctx, SIMD).simd).toBe(true)
    expect(createWasmBackend(ctx, SCALAR).simd).toBe(false)
  })

  for (const c of LIGHT_CASES) {
    it(`stages A and B equal the JS: ${c.name}`, () => {
      const { ctx, units } = contextOf(c)
      expect(wasmUnsupportedReason(ctx)).toBeNull()
      for (const unit of units) expectStagesEqual(ctx, unit, SIMD)
    }, 120_000)
  }

  it('the scalar build equals the JS too', () => {
    const { ctx, units } = contextOf(LIGHT_CASES[1])
    expectStagesEqual(ctx, units[0], SCALAR)
  }, 120_000)

  it('unit survivors equal runRotorUnit (crib bonus included)', async () => {
    for (const c of LIGHT_CASES.slice(0, 2)) {
      const { ctx, units } = contextOf(c)
      const js = runRotorUnit(ctx, units[0], { keep: 300 })
      const wasm = await runRotorUnitWith(ctx, units[0], { keep: 300 }, createWasmStages(ctx, SIMD))
      expect(wasm.survivors.length).toBeGreaterThan(0)
      expect(wasm).toEqual(js)
    }
  }, 120_000)

  it('delegates what it does not support to the JS stages', () => {
    const { ctx, units } = contextOf(LIGHT_CASES[2])
    const grid = { ...ctx, tuning: { ...ctx.tuning, refineMode: 'grid' as const } }
    expect(wasmUnsupportedReason(grid)).toMatch(/sweep/)
    expect(() => createWasmBackend(grid, SIMD)).toThrow()
    const plan = planUnit(grid, units[0])
    const inner = innerFor(grid, units[0].reflector, null, 0, units[0].left, units[0].middle)
    expect(createWasmStages(grid, SIMD)(plan, 0, inner)).toEqual(cpuStages(grid)(plan, 0, inner))
    expect(wasmUnsupportedReason({ ...ctx, layout: { ...ctx.layout, n: MAX_WASM_LETTERS + 1 } })).toMatch(/longer/)
    expect(wasmUnsupportedReason({ ...ctx, layout: { ...ctx.layout, n: 0 } })).toMatch(/empty/)
    expect(wasmUnsupportedReason({ ...ctx, tuning: { ...ctx.tuning, screenLetters: 27 } })).not.toBeNull()
    expect(wasmUnsupportedReason({ ...ctx, tuning: { ...ctx.tuning, screenRings: [26] } })).not.toBeNull()
  }, 120_000)
})
