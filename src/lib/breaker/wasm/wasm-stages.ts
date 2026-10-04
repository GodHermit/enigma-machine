/**
 * WebAssembly (SIMD) backend of phase 1: stages A (screen) and B (refine) of search.ts compiled
 * from src-wasm/phase1.ts (AssemblyScript, `yarn build:wasm`), bit-identical to cpuStages — same
 * candidates, same integer scores, same tie-breaking. Synchronous, so it runs inside the existing
 * worker loop exactly where cpuStages does.
 *
 * Supported: refineMode 'sweep' with any rankBy / screenRankBy, screenRings, screenLeftAt,
 * screen / refine letter limits, passes, refineKeep, maxPlugs and ringSearch, Greek wheels, and
 * messages of 1 … MAX_WASM_LETTERS letters (linear memory grows with the message). Anything else
 * (refineMode 'grid', screen rings outside 0–25, letter limits above 26 or not integers, empty or
 * longer messages) makes createWasmStages return cpuStages(ctx) — see wasmUnsupportedReason.
 *
 * Usage: compile once with loadPhase1Wasm() (or `new WebAssembly.Module(bytes)`); a compiled
 * WebAssembly.Module can be posted to workers. createWasmStages instantiates it synchronously,
 * one instance (≈ 1 MB of linear memory + 41 bytes per letter) per search context.
 */
import { cpuStages, refineSelection } from '../search'
import type { RefineFinal, ScreenResult, SearchContext, UnitPlan, UnitStages } from '../search'
import wasmUrl from './phase1.wasm?url'

/** Longest message the kernels take (16-bit lanes hold 2·count + change ≤ 3n); longer ones run on cpuStages. */
export const MAX_WASM_LETTERS = 10922

/** Exports of phase1.wasm (src-wasm/phase1.ts). */
interface Phase1Exports {
  memory: WebAssembly.Memory
  heapBase(): number
  simd(): number
  configure(block: number): void
  screen(pL: number): void
  refine(count: number): number
}

/** Parameter block of src-wasm/phase1.ts (the P_ constants there), one i32 each, in this order. */
const PARAMS = [
  'n',
  'maxPlugs',
  'screenPasses',
  'refinePasses',
  'finalPasses',
  'refineKeep',
  'screenBigram',
  'rankBigram',
  'screenPairCount',
  'refinePairCount',
  'finalPairCount',
  'screenRingCount',
  'sweepRingCount',
  'screenRmsStride',
  'allRmsStride',
  'rf',
  'rb',
  'inner',
  'notchM',
  'notchR',
  'bigram',
  'codes',
  'pairsScreen',
  'pairsRefine',
  'pairsFinal',
  'screenRms',
  'allRms',
  'screenRings',
  'sweepRings',
  'h',
  'tab',
  'cur',
  'plugs',
  'bestPlugs',
  'scratch',
  'screen',
  'screenP',
  'selection',
  'cand',
  'candCap',
  'finals',
  'next',
] as const

type Param = (typeof PARAMS)[number]

/** Bytes per finalist in the FINALS region: idx, r, rm, Σcount², bigram sum (i32), 26 plugboard bytes. */
const FINAL_BYTES = 48
const PAGE = 65536
/** Right rings per sweep (all 26) and middle-ring variants per offset (≤ 26 turnover moments + none). */
const MAX_SWEEP = 26
const MAX_ALL_RMS = 27

/* ------------------------------------------------------------------------ */
/* Loading                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * A minimal module using v128 (i32.const 0; i8x16.splat; i8x16.popcnt): validates only where
 * WebAssembly SIMD is supported.
 */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
])

/** True when this runtime supports WebAssembly SIMD (validate a tiny v128 module). */
export function wasmSimdSupported(): boolean {
  try {
    return typeof WebAssembly === 'object' && WebAssembly.validate(SIMD_PROBE)
  } catch {
    return false
  }
}

let loading: Promise<WebAssembly.Module> | null = null

/**
 * Browser/worker: fetch + compile the bundled phase1.wasm (Vite `?url` import, same origin), cached
 * per page. A failed load is not cached (the next call retries).
 */
export function loadPhase1Wasm(): Promise<WebAssembly.Module> {
  if (!loading) {
    loading = (async () => {
      const response = await fetch(wasmUrl)
      if (!response.ok) throw new Error(`phase1.wasm: HTTP ${response.status}`)
      return WebAssembly.compile(await response.arrayBuffer())
    })()
    loading.catch(() => {
      loading = null
    })
  }
  return loading
}

/* ------------------------------------------------------------------------ */
/* Backend                                                                   */
/* ------------------------------------------------------------------------ */

/** Why the WASM kernels cannot reproduce cpuStages for this search (null when they can). */
export function wasmUnsupportedReason(ctx: SearchContext): string | null {
  const t = ctx.tuning
  const n = ctx.layout.n
  const ring = (r: number): boolean => Number.isInteger(r) && r >= 0 && r < 26
  const letters = (l: number): boolean => Number.isInteger(l) && l <= 26
  if (t.refineMode !== 'sweep') return "only the 'sweep' refine mode runs in WebAssembly"
  if (n < 1) return 'empty message'
  if (n > MAX_WASM_LETTERS) return `messages longer than ${MAX_WASM_LETTERS} letters run in JavaScript`
  if (!t.screenRings.every(ring)) return 'screen rings must be 0–25'
  if (!letters(t.screenLetters) || !letters(t.refineLetters)) return 'letter limits above 26'
  return null
}

/** The phase-1 kernels bound to one search context; screen / refine are exposed for parity tests. */
export interface WasmBackend {
  stages: UnitStages
  /** Stage A (screenStage). */
  screen(plan: UnitPlan, inner: Uint8Array, onProgress?: (positions: number) => void): ScreenResult
  /** Stage B (refineStage, 'sweep') for a stage-A result and selection. */
  refine(plan: UnitPlan, inner: Uint8Array, screen: ScreenResult, selection: Int32Array): RefineFinal[]
  /** Whether the instance runs SIMD code. */
  simd: boolean
}

/** Cable pairs of a climb in climbIoc's order: (order[i], order[j]) for i < j < limit, a | b << 8. */
function pairList(order: Uint8Array, limit: number): Uint16Array {
  const out: number[] = []
  for (let i = 0; i < limit - 1; i++) for (let j = i + 1; j < limit; j++) out.push(order[i] | (order[j] << 8))
  return Uint16Array.from(out)
}

/** Phase-1 stages A + B in WebAssembly, bit-identical to cpuStages(ctx). Synchronous. */
export function createWasmStages(ctx: SearchContext, module: WebAssembly.Module): UnitStages {
  if (wasmUnsupportedReason(ctx)) return cpuStages(ctx)
  return createWasmBackend(ctx, module).stages
}

/**
 * The kernels for a supported context (see wasmUnsupportedReason; throws instead of delegating).
 * Instantiation is synchronous, meant for the search worker.
 */
export function createWasmBackend(ctx: SearchContext, module: WebAssembly.Module): WasmBackend {
  const reason = wasmUnsupportedReason(ctx)
  if (reason) throw new Error(`WebAssembly phase 1: ${reason}`)
  const wasm = new WebAssembly.Instance(module, {}).exports as unknown as Phase1Exports
  const t = ctx.tuning
  const n = ctx.layout.n
  const bigrams = ctx.ngrams
  const candCap = 2 * MAX_SWEEP + MAX_ALL_RMS
  // Integers as the JS loops see them: `pass < passes` runs ceil(passes) times, slice(0, keep) truncates.
  const loops = (x: number): number => Math.min(0x7fffffff, Math.max(0, Math.ceil(x)))
  const keep = Math.min(candCap, Math.max(1, Math.trunc(t.refineKeep)))
  const screenPairs = pairList(ctx.order, t.screenLetters)
  const refinePairs = pairList(ctx.order, t.refineLetters)
  const finalPairs = pairList(ctx.order, 26)
  const screenRmsStride = 2 + (t.screenLeft ? t.screenLeftAt.length : 0)

  // Layout: 64-byte aligned regions from the module's heap base; FINALS last (grows on demand).
  let top = wasm.heapBase()
  const region = (bytes: number): number => {
    const at = top
    top += Math.ceil(bytes / 64) * 64
    return at
  }
  const at: Record<Param, number> = {
    n,
    maxPlugs: ctx.maxPlugs,
    screenPasses: loops(t.screenPasses),
    refinePasses: loops(t.refinePasses),
    finalPasses: loops(t.finalPasses),
    refineKeep: keep,
    screenBigram: t.screenRankBy === 'bigram' && bigrams ? 1 : 0,
    rankBigram: t.rankBy === 'bigram' && bigrams ? 1 : 0,
    screenPairCount: screenPairs.length,
    refinePairCount: refinePairs.length,
    finalPairCount: finalPairs.length,
    screenRingCount: 0,
    sweepRingCount: 0,
    screenRmsStride,
    allRmsStride: 1 + MAX_ALL_RMS,
    rf: 0,
    rb: 0,
    inner: 0,
    notchM: 0,
    notchR: 0,
    bigram: 0,
    codes: 0,
    pairsScreen: 0,
    pairsRefine: 0,
    pairsFinal: 0,
    screenRms: 0,
    allRms: 0,
    screenRings: 0,
    sweepRings: 0,
    h: 0,
    tab: 0,
    cur: 0,
    plugs: 0,
    bestPlugs: 0,
    scratch: 0,
    screen: 0,
    screenP: 0,
    selection: 0,
    cand: 0,
    candCap,
    finals: 0,
    next: 0,
  }
  const block = region(PARAMS.length * 4)
  at.rf = region(26 * 32)
  at.rb = region(26 * 32)
  at.inner = region(676 * 32)
  at.notchM = region(26)
  at.notchR = region(26)
  at.bigram = region(676)
  at.codes = region(n)
  at.pairsScreen = region(screenPairs.byteLength)
  at.pairsRefine = region(refinePairs.byteLength)
  at.pairsFinal = region(finalPairs.byteLength)
  at.screenRms = region(26 * screenRmsStride * 4)
  at.allRms = region(26 * (1 + MAX_ALL_RMS) * 4)
  at.screenRings = region(Math.max(1, t.screenRings.length) * 4)
  at.sweepRings = region(MAX_SWEEP * 4)
  at.h = region(676 * 64)
  at.tab = region(n * 32)
  at.cur = region(n * 4)
  at.next = region(n * 4)
  at.plugs = region(32)
  at.bestPlugs = region(32)
  at.scratch = region(256)
  at.screen = region(17576 * 4)
  at.screenP = region(17576 * 26)
  at.selection = region(17576 * 4)
  at.cand = region(candCap * 13)
  at.finals = top

  const ensure = (bytes: number): void => {
    const have = wasm.memory.buffer.byteLength
    if (bytes > have) wasm.memory.grow(Math.ceil((bytes - have) / PAGE))
  }
  ensure(top)
  const u8 = (): Uint8Array => new Uint8Array(wasm.memory.buffer)
  const i32 = (): Int32Array => new Int32Array(wasm.memory.buffer)

  // Per-search data.
  {
    const m = u8()
    m.set(ctx.layout.codes, at.codes)
    if (bigrams) m.set(bigrams.bi, at.bigram)
    m.set(new Uint8Array(screenPairs.buffer), at.pairsScreen)
    m.set(new Uint8Array(refinePairs.buffer), at.pairsRefine)
    m.set(new Uint8Array(finalPairs.buffer), at.pairsFinal)
  }

  let planFor: UnitPlan | null = null
  let innerFor: Uint8Array | null = null

  /** Writes the unit's tables / ring lists and the inner table (when they changed), then configures. */
  const prepare = (plan: UnitPlan, inner: Uint8Array): void => {
    if (plan.n !== n) throw new Error('WebAssembly phase 1: plan of another message')
    const m = u8()
    const w = i32()
    if (planFor !== plan) {
      for (let o = 0; o < 26; o++) {
        m.set(plan.rf.subarray(o * 26, o * 26 + 26), at.rf + o * 32)
        m.set(plan.rb.subarray(o * 26, o * 26 + 26), at.rb + o * 32)
      }
      m.set(plan.notchM, at.notchM)
      m.set(plan.notchR, at.notchR)
      for (let oM = 0; oM < 26; oM++) {
        const s = plan.screenRms[oM]
        const a = plan.allRms[oM]
        if (s.length > screenRmsStride - 1 || a.length > MAX_ALL_RMS) throw new Error('WebAssembly phase 1: unexpected plan')
        const so = at.screenRms / 4 + oM * screenRmsStride
        w[so] = s.length
        s.forEach((rm, k) => (w[so + 1 + k] = rm))
        const ao = at.allRms / 4 + oM * (1 + MAX_ALL_RMS)
        w[ao] = a.length
        a.forEach((rm, k) => (w[ao + 1 + k] = rm))
      }
      if (plan.sweepRings.length > MAX_SWEEP) throw new Error('WebAssembly phase 1: unexpected plan')
      w.set(plan.screenRings, at.screenRings / 4)
      w.set(plan.sweepRings, at.sweepRings / 4)
      at.screenRingCount = plan.screenRings.length
      at.sweepRingCount = plan.sweepRings.length
      planFor = plan
    }
    if (innerFor !== inner) {
      for (let ib = 0; ib < 676; ib++) m.set(inner.subarray(ib * 26, ib * 26 + 26), at.inner + ib * 32)
      innerFor = inner
    }
    PARAMS.forEach((p, k) => (w[block / 4 + k] = at[p]))
    wasm.configure(block)
  }

  const runScreen = (onProgress?: (positions: number) => void): Float64Array => {
    u8().fill(0, at.bestPlugs, at.bestPlugs + 32)
    for (let pL = 0; pL < 26; pL++) {
      wasm.screen(pL)
      onProgress?.((pL + 1) * 676)
    }
    return Float64Array.from(i32().subarray(at.screen / 4, at.screen / 4 + 17576))
  }

  const runRefine = (selection: Int32Array): RefineFinal[] => {
    ensure(at.finals + selection.length * keep * FINAL_BYTES)
    i32().set(selection, at.selection / 4)
    const count = wasm.refine(selection.length)
    const m = u8()
    const w = i32()
    const finals: RefineFinal[] = []
    for (let k = 0; k < count; k++) {
      const o = at.finals + k * FINAL_BYTES
      const q = o / 4
      finals.push({ idx: w[q], r: w[q + 1], rm: w[q + 2], sumSq: w[q + 3], bigramSum: w[q + 4], P: m.slice(o + 20, o + 46) })
    }
    return finals
  }

  return {
    stages(plan, _g, inner, onProgress) {
      prepare(plan, inner)
      const screen = runScreen(onProgress)
      return runRefine(refineSelection(ctx, screen))
    },
    screen(plan, inner, onProgress) {
      prepare(plan, inner)
      const screen = runScreen(onProgress)
      return { screen, screenP: u8().slice(at.screenP, at.screenP + 17576 * 26) }
    },
    refine(plan, inner, screen, selection) {
      prepare(plan, inner)
      u8().set(screen.screenP, at.screenP)
      return runRefine(selection)
    },
    simd: wasm.simd() !== 0,
  }
}
