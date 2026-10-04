/**
 * The four search phases as pure, synchronous functions. The Web Worker runs them on work
 * units handed out by the main thread; tests and the benchmark call them directly.
 */
import { MODELS } from '../enigma/constants'
import type { GreekRotorId, ModelId, ReflectorId, RotorId } from '../enigma/types'
import {
  bestCribPosition,
  buildClassTable,
  cipherLayout,
  climbIoc,
  climbNgram,
  countPlugs,
  fillPlugs,
  decodeClassTable,
  decodeWith,
  iocFromSumSquares,
  lettersByFrequency,
  ngramObjective,
} from './climb'
import type { CipherLayout, CribSpec, NgramObjective } from './climb'
import { ngramLog10, ngramSum } from './ngrams'
import type { NgramModel } from './ngrams'
import { mulberry32, randomInt } from './random'
import {
  buildInner,
  buildTable,
  effectiveReflector,
  fillSchedule,
  fillScheduleRaw,
  rotorTables,
} from './scrambler'
import type { CompiledKey, RotorKey } from './scrambler'
import { fromCodes, indexOfCoincidence, toCodes } from './text'
import type { BreakerConfig, BreakerPhase, BreakerWords, RingSearch } from './types'
import { DEFAULT_TYPO_TOLERANCE, MAX_TYPO_TOLERANCE, exactCoverage, scoreWords } from './words'
import type { WordDictionary } from './words'

/* ------------------------------------------------------------------------ */
/* Tuning                                                                    */
/* ------------------------------------------------------------------------ */

export interface SearchTuning {
  /** Phase 1: survivors kept (global top K by score). */
  survivors: number
  /** Phase 1 screen: IoC hill-climb passes from an empty plugboard per screen variant. */
  screenPasses: number
  /** Phase 1 screen: right ring settings tried (turnover phases spread over the 26 letters). */
  screenRings: number[]
  /** Phase 1 screen / refine: pairs of only the most frequent this-many ciphertext letters are tried. */
  screenLetters: number
  refineLetters: number
  /** Phase 1 screen: also try a left turnover inside the message. */
  screenLeft: boolean
  /** Phase 1 screen: where those left turnovers are tried, as fractions of the message (e.g. [0.5]). */
  screenLeftAt: number[]
  /** Phase 1: fraction of start positions (by screen score) that are refined. */
  refineFraction: number
  /**
   * Phase 1 refine strategy. 'grid': the fixed `rightGrid` × `leftOptions` grid. 'sweep': every
   * right ring setting, then every left-turnover moment with the best one, then the right ring
   * again — the exact stepping schedule is reachable, which matters on short messages where a
   * turnover a few letters off garbles enough text to hide the true key.
   */
  refineMode: 'grid' | 'sweep'
  /**
   * Phases 1–2 ranking. 'ioc': index of coincidence of the decrypt. 'bigram': bigram
   * log-likelihood of the decrypt (after the same IoC plugboard climb) — far more selective on
   * short messages, where many wrong settings reach a language-like IoC by chance.
   */
  rankBy: 'ioc' | 'bigram'
  /** Phase 1 screen ranking (its one-pass plugboards are rough, which bigrams punish harder). */
  screenRankBy: 'ioc' | 'bigram'
  /** Phase 1 refine ('grid' mode): right ring settings tried. */
  rightGrid: number[]
  /** Phase 1 refine: left-turnover moments tried besides "none" (spread over the message). */
  leftOptions: number
  /** Phase 1 refine: passes per ring variant (warm-started from the screen's plugboard). */
  refinePasses: number
  /** Phase 1 refine: best variants per start position that get `finalPasses` more. */
  refineKeep: number
  finalPasses: number
  /** Phase 2: right ring settings probed around phase 1's value (± this many; 13 = all 26). */
  ringSpread: number
  /** Phase 2: ring variants per survivor that get a full IoC hill climb. */
  ringClimbs: number
  /** Phase 2: candidates kept per survivor. */
  ringKeep: number
  /** Phase 2: maximum IoC hill-climb passes per ring variant. */
  ringPasses: number
  /** Phase 3: candidates (best phase-2 results) that get the n-gram plugboard search. */
  finalists: number
  /** Phase 3: random restarts per finalist. */
  restarts: number
  /** Phase 4: best phase-3 results that get the dictionary check. */
  wordCandidates: number
  /** Phase 4: how many of them (best first) may get the dictionary-guided plugboard polish. */
  wordPolish: number
  /** Phase 4: exact dictionary coverage range [min, max) that triggers the polish. */
  polishRange: [number, number]
}

export const DEFAULT_TUNING: SearchTuning = {
  survivors: 1000,
  screenPasses: 1,
  screenLeft: true,
  screenLeftAt: [0.15, 0.5, 0.85],
  screenRings: [0, 9, 17],
  screenLetters: 26,
  refineLetters: 26,
  refineFraction: 0.1,
  refineMode: 'sweep',
  rankBy: 'bigram',
  screenRankBy: 'ioc',
  rightGrid: [0, 5, 10, 16, 21],
  leftOptions: 3,
  refinePasses: 1,
  refineKeep: 2,
  finalPasses: 3,
  ringSpread: 13,
  ringClimbs: 4,
  ringKeep: 2,
  ringPasses: 4,
  finalists: 100,
  restarts: 4,
  wordCandidates: 20,
  wordPolish: 5,
  polishRange: [0.2, 0.9],
}

/** Phase 1/2 score bonus (IoC units) for a fully matching crib. */
const CRIB_IOC_WEIGHT = 0.02
/** The same bonus in bigram units (log10 per bigram), when phases 1–2 rank by bigrams. */
const CRIB_BIGRAM_WEIGHT = 0.3
/** Phase 3: log10 units per matching crib letter. */
const CRIB_NGRAM_WEIGHT = 2
/** Phase 4: ranking bonus (log10 units per quadgram) for full exact dictionary coverage. */
export const WORDS_WEIGHT = 1
/** Phase 4 polish: weight of the exact coverage against the quadgram score. */
const POLISH_WORDS_WEIGHT = 2

/** The config's typo tolerance, clamped (default 0.2). */
export function typoToleranceOf(config: BreakerConfig): number {
  const t = config.typoTolerance
  return typeof t === 'number' && Number.isFinite(t) ? Math.max(0, Math.min(MAX_TYPO_TOLERANCE, t)) : DEFAULT_TYPO_TOLERANCE
}

/* ------------------------------------------------------------------------ */
/* Context                                                                   */
/* ------------------------------------------------------------------------ */

export interface CoreCandidate {
  key: RotorKey
  /** Plugboard involution (26 letter codes). */
  plugs: number[]
  score: number
  ioc: number
  phase: BreakerPhase
  /** Set once phase 3 ran. */
  plaintext?: string
  /** Set once phase 4 ran. */
  words?: BreakerWords
}

export interface SearchContext {
  model: ModelId
  codes: Uint8Array
  layout: CipherLayout
  maxPlugs: number
  /** Exactly `maxPlugs` cables (phases 3–4 fill up to the count and only rewire). */
  exactPlugs: boolean
  ringSearch: RingSearch
  crib: CribSpec | null
  ngrams: NgramModel | null
  dictionary: WordDictionary | null
  typoTolerance: number
  tuning: SearchTuning
  innerCache: Map<string, Uint8Array>
  /** Ciphertext letters, most frequent first (pair order of the IoC climbs). */
  order: Uint8Array
  /** Scratch buffers sized for the message. */
  tab: Uint8Array
  rBase: Int32Array
  iBase: Int32Array
  plain: Uint8Array
}

/**
 * Offsets where the crib may sit: Enigma never enciphers a letter to itself, so an offset is
 * only possible when no crib letter equals the ciphertext letter under it.
 */
export function cribPositions(cipher: Uint8Array, crib: Uint8Array, position: number | null): number[] {
  const out: number[] = []
  const last = cipher.length - crib.length
  const consistent = (p: number): boolean => {
    for (let j = 0; j < crib.length; j++) if (cipher[p + j] === crib[j]) return false
    return true
  }
  if (crib.length === 0) return out
  if (position !== null) {
    if (Number.isInteger(position) && position >= 0 && position <= last && consistent(position)) out.push(position)
    return out
  }
  for (let p = 0; p <= last; p++) if (consistent(p)) out.push(p)
  return out
}

export function createContext(
  config: BreakerConfig,
  ngrams: NgramModel | null,
  tuning: Partial<SearchTuning> = {},
  dictionary: WordDictionary | null = null,
): SearchContext {
  const codes = toCodes(config.ciphertext)
  const n = codes.length
  let crib: CribSpec | null = null
  if (config.crib && config.crib.text.trim() !== '') {
    const cc = toCodes(config.crib.text)
    crib = { codes: cc, positions: Int32Array.from(cribPositions(codes, cc, config.crib.position)) }
  }
  const layout = cipherLayout(codes)
  return {
    model: config.model,
    codes,
    layout,
    order: lettersByFrequency(layout),
    maxPlugs: Math.max(0, Math.min(13, Math.floor(config.maxPlugs))),
    exactPlugs: config.exactPlugs === true,
    ringSearch: config.ringSearch,
    crib,
    ngrams,
    dictionary,
    typoTolerance: typoToleranceOf(config),
    tuning: { ...DEFAULT_TUNING, ...tuning },
    innerCache: new Map(),
    tab: new Uint8Array(n * 26),
    rBase: new Int32Array(n),
    iBase: new Int32Array(n),
    plain: new Uint8Array(n),
  }
}

export function innerFor(
  ctx: SearchContext,
  reflector: ReflectorId,
  greek: GreekRotorId | null,
  greekPos: number,
  left: RotorId,
  middle: RotorId,
): Uint8Array {
  const id = `${reflector}/${greek ?? '-'}${greekPos}/${left}/${middle}`
  let inner = ctx.innerCache.get(id)
  if (!inner) {
    if (ctx.innerCache.size > 64) ctx.innerCache.clear()
    inner = buildInner(effectiveReflector(reflector, greek, greekPos), left, middle)
    ctx.innerCache.set(id, inner)
  }
  return inner
}

function compiled(ctx: SearchContext, key: RotorKey): CompiledKey {
  const n = ctx.codes.length
  const R = rotorTables(key.right)
  const rBase = new Int32Array(n)
  const iBase = new Int32Array(n)
  fillSchedule(key, n, rBase, iBase)
  return {
    key,
    inner: innerFor(ctx, key.reflector, key.greek, key.greekPos, key.left, key.middle),
    rf: R.fwd,
    rb: R.bwd,
    rBase,
    iBase,
    n,
  }
}

/* ------------------------------------------------------------------------ */
/* Work units                                                                */
/* ------------------------------------------------------------------------ */

/** One phase-1 work unit: a reflector, Greek wheel (M4) and rotor order. */
export interface RotorUnit {
  reflector: ReflectorId
  greek: GreekRotorId | null
  left: RotorId
  middle: RotorId
  right: RotorId
}

/** Every reflector × [Greek wheel] × ordered triple of distinct rotors allowed by the config. */
export function rotorUnits(config: BreakerConfig): RotorUnit[] {
  const spec = MODELS[config.model]
  const rotors = unique(config.rotors).filter((r) => spec.rotorIds.includes(r))
  const reflectors = unique(config.reflectors).filter((r) => spec.reflectorIds.includes(r))
  const greeks: (GreekRotorId | null)[] = spec.hasGreek
    ? unique(config.greekRotors).filter((g) => spec.greekIds.includes(g))
    : [null]
  const units: RotorUnit[] = []
  for (const reflector of reflectors) {
    for (const greek of greeks) {
      for (const left of rotors) {
        for (const middle of rotors) {
          if (middle === left) continue
          for (const right of rotors) {
            if (right === left || right === middle) continue
            units.push({ reflector, greek, left, middle, right })
          }
        }
      }
    }
  }
  return units
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}


/* ------------------------------------------------------------------------ */
/* Ring variants                                                             */
/* ------------------------------------------------------------------------ */

const mod = (n: number): number => ((n % 26) + 26) % 26

/** Upper bound of middle-rotor steps in an n-letter message (plus one). */
function middleSteps(n: number): number {
  return Math.ceil(n / 26) + 1
}

/**
 * Middle ring settings worth trying for a middle-rotor offset oM: one per distinct moment of
 * the left rotor's turnover (after 0, 1, 2 … middle steps), the LAST entry being a setting
 * without any left turnover inside the message when one exists. With the middle offset kept,
 * the start position is oM + ring.
 */
function middleRingVariants(notchM: Uint8Array, oM: number, n: number): { rm: number; first: number }[] {
  const steps = middleSteps(n)
  const byFirst = new Map<number, number>()
  let none = -1
  for (let rm = 0; rm < 26; rm++) {
    let first = 26
    for (let j = 0; j < 26; j++) {
      if (notchM[(oM + rm + j) % 26] === 1) {
        first = j
        break
      }
    }
    if (first <= steps) {
      if (!byFirst.has(first)) byFirst.set(first, rm)
    } else if (none < 0) {
      none = rm
    }
  }
  const out = [...byFirst.entries()].sort((a, b) => a[0] - b[0]).map(([first, rm]) => ({ rm, first }))
  if (none >= 0) out.push({ rm: none, first: 26 })
  return out
}

/* ------------------------------------------------------------------------ */
/* Phase 1: rotor order and start positions                                  */
/* ------------------------------------------------------------------------ */

class TopK {
  readonly scores: Float64Array
  readonly iocs: Float64Array
  readonly keys: Float64Array
  readonly plugs: Uint8Array
  size = 0
  readonly capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
    this.scores = new Float64Array(capacity)
    this.iocs = new Float64Array(capacity)
    this.keys = new Float64Array(capacity)
    this.plugs = new Uint8Array(capacity * 26)
  }

  /** Lowest score kept (−∞ while not full). */
  min(): number {
    return this.size < this.capacity ? -Infinity : this.scores[0]
  }

  push(score: number, ioc: number, key: number, P: Uint8Array): void {
    if (this.capacity === 0) return
    let i: number
    if (this.size < this.capacity) {
      i = this.size++
      while (i > 0) {
        const parent = (i - 1) >> 1
        if (this.scores[parent] <= score) break
        this.move(parent, i)
        i = parent
      }
    } else {
      if (score <= this.scores[0]) return
      i = 0
      const n = this.size
      for (;;) {
        const l = 2 * i + 1
        if (l >= n) break
        const r = l + 1
        const c = r < n && this.scores[r] < this.scores[l] ? r : l
        if (this.scores[c] >= score) break
        this.move(c, i)
        i = c
      }
    }
    this.scores[i] = score
    this.iocs[i] = ioc
    this.keys[i] = key
    this.plugs.set(P, i * 26)
  }

  private move(from: number, to: number): void {
    this.scores[to] = this.scores[from]
    this.iocs[to] = this.iocs[from]
    this.keys[to] = this.keys[from]
    this.plugs.copyWithin(to * 26, from * 26, from * 26 + 26)
  }
}

export interface RotorUnitResult {
  survivors: CoreCandidate[]
  /** Start positions tested (× Greek positions). */
  keys: number
}

export interface RotorUnitOptions {
  /** Survivors to keep from this unit. */
  keep: number
  /** Only candidates scoring above this are kept (the current global cut-off). */
  threshold?: number
  /** Called every 26² start positions with the keys tested so far in this unit. */
  onProgress?: (keys: number) => void
}

/** Phase-1 keys (start positions × Greek positions) of one unit. */
export function unitKeys(unit: RotorUnit): number {
  return (unit.greek ? 26 : 1) * 17576
}

/**
 * Everything phase 1 needs for one unit that does not depend on the start position: rotor
 * tables and the ring / turnover variants per middle offset. Shared by the CPU stages below and
 * the GPU backend, so both evaluate exactly the same candidates.
 */
export interface UnitPlan {
  unit: RotorUnit
  n: number
  greekCount: number
  rf: Uint8Array
  rb: Uint8Array
  notchM: Uint8Array
  notchR: Uint8Array
  /** Stage A: middle ring settings per middle offset (no turnover first) × `screenRings`. */
  screenRms: number[][]
  screenRings: number[]
  /** Stage B 'sweep': every distinct left-turnover moment per middle offset, none first. */
  allRms: number[][]
  sweepRings: number[]
  /** Stage B 'grid': `leftRms` × `gridRings`. */
  leftRms: number[][]
  gridRings: number[]
}

export function planUnit(ctx: SearchContext, unit: RotorUnit): UnitPlan {
  const n = ctx.layout.n
  const tuning = ctx.tuning
  const R = rotorTables(unit.right)
  const notchM = rotorTables(unit.middle).notch
  const searchRight = ctx.ringSearch !== 'none'
  const searchMiddle = ctx.ringSearch === 'right-middle'

  // Middle ring settings per middle offset: the one without a left turnover (screen) and a few
  // spread over the message (refine).
  const steps = Math.max(1, Math.floor(n / 26))
  const screenRms: number[][] = []
  const leftRms: number[][] = []
  const allRms: number[][] = []
  for (let oM = 0; oM < 26; oM++) {
    const variants = searchMiddle ? middleRingVariants(notchM, oM, n) : [{ rm: 0, first: 26 }]
    const none = variants[variants.length - 1]
    allRms.push([none.rm, ...variants.slice(0, -1).map((v) => v.rm)])
    const pickFirst = (target: number): number => {
      let pick = variants[0]
      for (const v of variants) if (Math.abs(v.first - target) < Math.abs(pick.first - target)) pick = v
      return pick.rm
    }
    const screenList = [none.rm]
    if (searchMiddle && tuning.screenLeft) {
      for (const at of tuning.screenLeftAt) {
        const rm = pickFirst(Math.round(steps * at))
        if (!screenList.includes(rm)) screenList.push(rm)
      }
    }
    screenRms.push(screenList)
    const list = [none.rm]
    if (searchMiddle) {
      for (let j = 1; j <= tuning.leftOptions; j++) {
        const rm = pickFirst(Math.round((steps * j) / (tuning.leftOptions + 1)))
        if (!list.includes(rm)) list.push(rm)
      }
    }
    leftRms.push(list)
  }
  return {
    unit,
    n,
    greekCount: unit.greek ? 26 : 1,
    rf: R.fwd,
    rb: R.bwd,
    notchM,
    notchR: R.notch,
    screenRms,
    screenRings: searchRight ? tuning.screenRings : [0],
    allRms,
    sweepRings: searchRight ? Array.from({ length: 26 }, (_, r) => r) : [0],
    leftRms,
    gridRings: searchRight ? tuning.rightGrid : [0],
  }
}

/** Stage A result for one Greek position: best value and plugboard per start position. */
export interface ScreenResult {
  /** screen[(pL·26 + oM)·26 + oR]: best variant value (Σcount² or bigram sum). */
  screen: Float64Array
  /** The plugboard of that best variant, 26 bytes per start position. */
  screenP: Uint8Array
}

/** One stage-B finalist: a ring variant of a start position after the final climb. */
export interface RefineFinal {
  idx: number
  r: number
  rm: number
  /** Σcount² of the decrypt after the final climb. */
  sumSq: number
  /** Bigram sum of that decrypt ('bigram' ranking), else 0. */
  bigramSum: number
  P: Uint8Array
}

/** Schedule writer bound to a plan (wiring offsets oM / oR kept, rings rm / r). */
function planFill(ctx: SearchContext, plan: UnitPlan) {
  const n = plan.n
  return (pL: number, oM: number, oR: number, rm: number, r: number, out: Int32Array): void =>
    fillScheduleRaw(plan.notchM, plan.notchR, pL, (oM + rm) % 26, (oR + r) % 26, rm, r, n, ctx.rBase, out)
}

/** Rebuilds the class-table rows of positions whose schedule (iBase) differs from curI. */
function planUpdater(ctx: SearchContext, plan: UnitPlan, curI: Int32Array) {
  const { codes, classStart, classRank } = ctx.layout
  const { tab, rBase, iBase } = ctx
  const { rf, rb, n } = plan
  return (inner: Uint8Array): void => {
    for (let i = 0; i < n; i++) {
      const ib = iBase[i]
      if (ib === curI[i]) continue
      const z = codes[i]
      const s = classStart[z]
      const cnt = classStart[z + 1] - s
      const rr = rBase[i]
      let o = s * 26 + classRank[i]
      for (let x = 0; x < 26; x++) {
        tab[o] = rb[rr + inner[ib + rf[rr + x]]]
        o += cnt
      }
      curI[i] = ib
    }
  }
}

/**
 * Stage A (CPU): every start position × screen variant gets a short IoC climb from an empty
 * plugboard; the best value per position is kept (first best in variant order).
 */
export function screenStage(
  ctx: SearchContext,
  plan: UnitPlan,
  inner: Uint8Array,
  onProgress?: (positions: number) => void,
): ScreenResult {
  const { layout, tab, rBase, iBase, plain, maxPlugs, order } = ctx
  const tuning = ctx.tuning
  const screenBigrams = tuning.screenRankBy === 'bigram' ? ctx.ngrams : null
  const curI = new Int32Array(plan.n)
  const fill = planFill(ctx, plan)
  const updateTable = planUpdater(ctx, plan, curI)
  const P = new Uint8Array(26)
  const P0 = new Uint8Array(26)
  const screen = new Float64Array(17576)
  const screenP = new Uint8Array(17576 * 26)
  for (let pL = 0; pL < 26; pL++) {
    for (let oM = 0; oM < 26; oM++) {
      const rms = plan.screenRms[oM]
      for (let oR = 0; oR < 26; oR++) {
        let best = -1
        let first = true
        for (const rm of rms) {
          for (const r of plan.screenRings) {
            fill(pL, oM, oR, rm, r, first ? curI : iBase)
            if (first) buildClassTable(layout, inner, plan.rf, plan.rb, rBase, curI, tab)
            else updateTable(inner)
            first = false
            for (let a = 0; a < 26; a++) P[a] = a
            let sum = climbIoc(layout, tab, P, maxPlugs, tuning.screenPasses, order, tuning.screenLetters)
            if (screenBigrams) {
              decodeClassTable(layout, tab, P, plain)
              sum = ngramSum(screenBigrams, plain, 2)
            }
            if (sum > best) {
              best = sum
              P0.set(P)
            }
          }
        }
        const idx = (pL * 26 + oM) * 26 + oR
        screen[idx] = best
        screenP.set(P0, idx * 26)
      }
    }
    onProgress?.((pL + 1) * 676)
  }
  return { screen, screenP }
}

/** Start positions that get stage B: the best `refineFraction` by screen value, ascending. */
export function refineSelection(ctx: SearchContext, screen: Float64Array): Int32Array {
  const sorted = Float64Array.from(screen).sort()
  const cut = sorted[Math.min(17575, Math.floor((1 - ctx.tuning.refineFraction) * 17576))]
  const out: number[] = []
  for (let idx = 0; idx < 17576; idx++) if (screen[idx] >= cut) out.push(idx)
  return Int32Array.from(out)
}

/**
 * Stage B (CPU): each selected start position tries the ring variants (warm-started from its
 * screen plugboard); the best `refineKeep` get the final climb. Finalists are returned in the
 * order they are found (position ascending, best variant first).
 */
export function refineStage(
  ctx: SearchContext,
  plan: UnitPlan,
  inner: Uint8Array,
  screen: ScreenResult,
  selection: Int32Array,
): RefineFinal[] {
  const { layout, tab, rBase, iBase, plain, maxPlugs, order } = ctx
  const tuning = ctx.tuning
  const bigrams = tuning.rankBy === 'bigram' ? ctx.ngrams : null
  const curI = new Int32Array(plan.n)
  const fill = planFill(ctx, plan)
  const updateTable = planUpdater(ctx, plan, curI)
  const P = new Uint8Array(26)
  const cand: { sum: number; r: number; rm: number }[] = []
  const finals: RefineFinal[] = []
  for (const idx of selection) {
    const oR = idx % 26
    const oM = ((idx - oR) / 26) % 26
    const pL = (idx - oR - oM * 26) / 676
    const start = screen.screenP.subarray(idx * 26, idx * 26 + 26)
    cand.length = 0
    let first = true
    const tryVariant = (rm: number, r: number): number => {
      fill(pL, oM, oR, rm, r, first ? curI : iBase)
      if (first) buildClassTable(layout, inner, plan.rf, plan.rb, rBase, curI, tab)
      else updateTable(inner)
      first = false
      P.set(start)
      let sum = climbIoc(layout, tab, P, maxPlugs, tuning.refinePasses, order, tuning.refineLetters)
      if (bigrams) {
        decodeClassTable(layout, tab, P, plain)
        sum = ngramSum(bigrams, plain, 2)
      }
      cand.push({ sum, r, rm })
      return sum
    }
    if (tuning.refineMode === 'sweep') {
      // Coordinate search over the stepping schedule: right ring, then left turnover, then
      // the right ring again for that turnover.
      const rms = plan.allRms[oM]
      const sweepRight = (rm: number): number => {
        let bestR = 0
        let best = -1
        for (const r of plan.sweepRings) {
          const sum = tryVariant(rm, r)
          if (sum > best) {
            best = sum
            bestR = r
          }
        }
        return bestR
      }
      const r1 = sweepRight(rms[0])
      let bestRm = rms[0]
      let best = -1
      for (const c of cand) if (c.r === r1 && c.rm === rms[0]) best = c.sum
      for (let j = 1; j < rms.length; j++) {
        const sum = tryVariant(rms[j], r1)
        if (sum > best) {
          best = sum
          bestRm = rms[j]
        }
      }
      if (bestRm !== rms[0]) sweepRight(bestRm)
    } else {
      for (const rm of plan.leftRms[oM]) for (const r of plan.gridRings) tryVariant(rm, r)
    }
    cand.sort((a, b) => b.sum - a.sum)
    for (const f of cand.slice(0, Math.max(1, tuning.refineKeep))) {
      fill(pL, oM, oR, f.rm, f.r, iBase)
      updateTable(inner)
      P.set(start)
      const sumSq = climbIoc(layout, tab, P, maxPlugs, tuning.finalPasses, order)
      let bigramSum = 0
      if (bigrams) {
        decodeClassTable(layout, tab, P, plain)
        bigramSum = ngramSum(bigrams, plain, 2)
      }
      finals.push({ idx, r: f.r, rm: f.rm, sumSq, bigramSum, P: Uint8Array.from(P) })
    }
  }
  return finals
}

/**
 * Scores stage-B finalists (IoC or bigram log-likelihood, plus a crib bonus) and offers them to
 * the unit's top list in the order given — the same order on every backend, so the cut-off
 * evolves identically.
 */
function collectFinals(
  ctx: SearchContext,
  plan: UnitPlan,
  inner: Uint8Array,
  g: number,
  finals: readonly RefineFinal[],
  top: TopK,
  threshold: number,
): void {
  const { layout, tab, rBase, iBase, plain, crib } = ctx
  const n = plan.n
  const bigrams = ctx.tuning.rankBy === 'bigram' ? ctx.ngrams : null
  const cribWeight = bigrams ? CRIB_BIGRAM_WEIGHT : CRIB_IOC_WEIGHT
  const cribLen = crib ? crib.codes.length : 0
  const fill = planFill(ctx, plan)
  for (const f of finals) {
    const oR = f.idx % 26
    const oM = ((f.idx - oR) / 26) % 26
    const pL = (f.idx - oR - oM * 26) / 676
    const ioc = iocFromSumSquares(f.sumSq, n)
    let score = ioc
    if (bigrams) score = bigrams.floor[0] + (bigrams.step[0] * f.bigramSum) / Math.max(1, n - 1)
    const floor = Math.max(threshold, top.min())
    if (crib && crib.positions.length > 0) {
      if (score + cribWeight <= floor) continue
      fill(pL, oM, oR, f.rm, f.r, iBase)
      buildClassTable(layout, inner, plan.rf, plan.rb, rBase, iBase, tab)
      decodeClassTable(layout, tab, f.P, plain)
      score += (cribWeight * bestCribPosition(crib, plain).matches) / cribLen
    }
    if (score > floor) top.push(score, ioc, ((((g * 26 + pL) * 26 + oM) * 26 + oR) * 26 + f.r) * 26 + f.rm, f.P)
  }
}

/** Phase-1 stages A and B of one Greek position — the part a backend (CPU or GPU) provides. */
export type UnitStages = (
  plan: UnitPlan,
  g: number,
  inner: Uint8Array,
  onProgress?: (positions: number) => void,
) => RefineFinal[] | Promise<RefineFinal[]>

/** The CPU implementation of stages A and B. */
export function cpuStages(ctx: SearchContext): UnitStages {
  return (plan, _g, inner, onProgress) => {
    const screen = screenStage(ctx, plan, inner, onProgress)
    return refineStage(ctx, plan, inner, screen, refineSelection(ctx, screen.screen))
  }
}

/** Turns the unit's top list into survivors, best first. */
function survivorsOf(unit: RotorUnit, top: TopK): CoreCandidate[] {
  const survivors: CoreCandidate[] = []
  for (let i = 0; i < top.size; i++) {
    let k = top.keys[i]
    const take = (): number => {
      const v = k % 26
      k = (k - v) / 26
      return v
    }
    const ringM = take()
    const ringR = take()
    const oR = take()
    const oM = take()
    const posL = take()
    const greekPos = k
    survivors.push({
      key: {
        reflector: unit.reflector,
        greek: unit.greek,
        greekPos: unit.greek ? greekPos : 0,
        left: unit.left,
        middle: unit.middle,
        right: unit.right,
        ringM,
        ringR,
        posL,
        posM: (oM + ringM) % 26,
        posR: (oR + ringR) % 26,
      },
      plugs: Array.from(top.plugs.subarray(i * 26, i * 26 + 26)),
      score: top.scores[i],
      ioc: top.iocs[i],
      phase: 'rotors',
    })
  }
  survivors.sort((a, b) => b.score - a.score)
  return survivors
}

/**
 * Phase 1 for one unit, every start position (and Greek position), in two stages.
 *
 * The plugboard is hill-climbed on the index of coincidence for every candidate. That only
 * works when the turnover points are (nearly) right — a wrong right ring moves every middle
 * rotor step, a wrong middle ring the left rotor's step, and the garbled letters drown the
 * signal of a short message. Ring settings cannot be probed with a fixed plugboard (the climbed
 * plugboard is over-fitted to the variant it was climbed on), so they are searched with climbs:
 *
 *  A. screen: a few right rings (`screenRings`: turnover phases spread over the 26 letters,
 *     wiring offsets kept) × a few left-turnover moments, each a short climb from an empty
 *     plugboard; the best value per start position is kept;
 *  B. refine: the best `refineFraction` of the start positions sweep every right ring and every
 *     left-turnover moment, each warm-started from the screen's plugboard and ranked by bigrams;
 *     the best variants get a longer climb.
 *
 * `stages` runs A and B (CPU by default; the GPU backend supplies its own, bit-identical).
 */
export function runRotorUnit(
  ctx: SearchContext,
  unit: RotorUnit,
  options: RotorUnitOptions,
  /** Synchronous stages backend (e.g. WebAssembly); the JavaScript stages by default. */
  syncStages?: UnitStages,
): RotorUnitResult {
  const plan = planUnit(ctx, unit)
  const top = new TopK(Math.max(0, options.keep))
  const threshold = options.threshold ?? -Infinity
  const stages = syncStages ?? cpuStages(ctx)
  let keys = 0
  for (let g = 0; g < plan.greekCount; g++) {
    const inner = innerFor(ctx, unit.reflector, unit.greek, g, unit.left, unit.middle)
    const done = keys
    const finals = stages(plan, g, inner, (positions) => options.onProgress?.(done + positions)) as RefineFinal[]
    keys += 17576
    collectFinals(ctx, plan, inner, g, finals, top, threshold)
    options.onProgress?.(keys)
  }
  return { survivors: survivorsOf(unit, top), keys }
}

/** Same as runRotorUnit with a (possibly asynchronous) stages backend, e.g. the GPU. */
export async function runRotorUnitWith(
  ctx: SearchContext,
  unit: RotorUnit,
  options: RotorUnitOptions,
  stages: UnitStages,
): Promise<RotorUnitResult> {
  const plan = planUnit(ctx, unit)
  const top = new TopK(Math.max(0, options.keep))
  const threshold = options.threshold ?? -Infinity
  let keys = 0
  for (let g = 0; g < plan.greekCount; g++) {
    const inner = innerFor(ctx, unit.reflector, unit.greek, g, unit.left, unit.middle)
    const done = keys
    const finals = await stages(plan, g, inner, (positions) => options.onProgress?.(done + positions))
    keys += 17576
    collectFinals(ctx, plan, inner, g, finals, top, threshold)
    options.onProgress?.(keys)
  }
  return { survivors: survivorsOf(unit, top), keys }
}

/* ------------------------------------------------------------------------ */
/* Phase 2: ring settings                                                    */
/* ------------------------------------------------------------------------ */

/** Schedule signature (keys with equal signatures decipher identically). */
function signatureOf(rBase: Int32Array, iBase: Int32Array, n: number): number {
  let h = 0x811c9dc5
  for (let i = 0; i < n; i++) {
    h = Math.imul(h ^ rBase[i], 0x01000193)
    h = Math.imul(h ^ iBase[i], 0x01000193)
  }
  return h >>> 0
}

/**
 * Phase 2 for one phase-1 survivor: probes (plugboard fixed — by now it is mostly right for the
 * true key) every middle ring setting and the right ring settings around phase 1's coarse value,
 * start positions shifted so the wiring offsets stay put, combined with the neighbouring left /
 * middle offsets (phase 1 may have aligned the part of the message after a turnover instead of
 * the part before it). The best few variants get a full IoC hill climb of the plugboard.
 */
export function runRingSearch(
  ctx: SearchContext,
  cand: CoreCandidate,
): { results: CoreCandidate[]; keys: number } {
  const { layout, tab, rBase, iBase, plain, crib, codes, ringSearch } = ctx
  const n = layout.n
  const base = cand.key
  const inner = innerFor(ctx, base.reflector, base.greek, base.greekPos, base.left, base.middle)
  const R = rotorTables(base.right)
  const notchM = rotorTables(base.middle).notch
  const P = Uint8Array.from(cand.plugs)
  const T = new Int32Array(26)
  const oL0 = base.posL
  const oM0 = mod(base.posM - base.ringM)
  const oR = mod(base.posR - base.ringR)
  // Neighbouring start offsets (left, middle): the middle one shifts when a right-ring change
  // moves a turnover across the first letter, both shift together around a left turnover.
  const shifts: [number, number][] =
    ringSearch === 'none'
      ? [[0, 0]]
      : ringSearch === 'right'
        ? [[0, 0], [0, 1], [0, -1]]
        : [[0, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]
  const climbs = Math.max(1, ctx.tuning.ringClimbs)
  const spread = ringSearch === 'none' ? 0 : Math.max(0, Math.min(13, ctx.tuning.ringSpread))
  const best: { sum: number; key: RotorKey }[] = []
  const seen = new Set<number>()
  let keys = 0

  for (const [dL, dM] of shifts) {
    const oL = mod(oL0 + dL)
    const oM = mod(oM0 + dM)
    const rms =
      ringSearch === 'right-middle'
        ? middleRingVariants(notchM, oM, n).map((v) => v.rm)
        : [ringSearch === 'none' ? base.ringM : 0]
    for (const rm of rms) {
      for (let dr = -spread; dr <= spread; dr++) {
        const r = mod(base.ringR + dr)
        keys++
        fillScheduleRaw(notchM, R.notch, oL, (oM + rm) % 26, (oR + r) % 26, rm, r, n, rBase, iBase)
        const sig = signatureOf(rBase, iBase, n)
        if (seen.has(sig)) continue
        seen.add(sig)
        T.fill(0)
        for (let i = 0; i < n; i++) {
          const rr = rBase[i]
          T[R.bwd[rr + inner[iBase[i] + R.fwd[rr + P[codes[i]]]]]]++
        }
        let sum = 0
        for (let v = 0; v < 26; v++) sum += T[v] * T[v]
        if (best.length < climbs || sum > best[best.length - 1].sum) {
          const key: RotorKey = { ...base, posL: oL, ringM: rm, posM: (oM + rm) % 26, ringR: r, posR: (oR + r) % 26 }
          best.push({ sum, key })
          best.sort((a, b) => b.sum - a.sum)
          if (best.length > climbs) best.pop()
        }
      }
    }
  }

  const results: CoreCandidate[] = []
  for (const { key } of best) {
    fillSchedule(key, n, rBase, iBase)
    buildClassTable(layout, inner, R.fwd, R.bwd, rBase, iBase, tab)
    const Q = Uint8Array.from(P)
    const ioc = iocFromSumSquares(climbIoc(layout, tab, Q, ctx.maxPlugs, ctx.tuning.ringPasses, ctx.order), n)
    let score = ioc
    const bigrams = ctx.tuning.rankBy === 'bigram' ? ctx.ngrams : null
    if (bigrams) {
      decodeClassTable(layout, tab, Q, plain)
      score = ngramLog10(bigrams, plain, 2)
    }
    if (crib && crib.positions.length > 0) {
      decodeClassTable(layout, tab, Q, plain)
      score += ((bigrams ? CRIB_BIGRAM_WEIGHT : CRIB_IOC_WEIGHT) * bestCribPosition(crib, plain).matches) / crib.codes.length
    }
    results.push({ key, plugs: Array.from(Q), score, ioc, phase: 'rings' })
  }
  results.sort((a, b) => b.score - a.score)
  return { results: results.slice(0, Math.max(1, ctx.tuning.ringKeep)), keys }
}

/* ------------------------------------------------------------------------ */
/* Phase 3: plugboard                                                        */
/* ------------------------------------------------------------------------ */

function perturb(P: Uint8Array, rand: () => number, maxPlugs: number, exact = false): void {
  // Drop a few cables, then add a couple of random ones (in exact mode: refill to the count).
  const drops = 1 + randomInt(rand, 3)
  for (let k = 0; k < drops; k++) {
    const a = randomInt(rand, 26)
    const b = P[a]
    P[a] = a
    P[b] = b
  }
  const adds = exact ? 26 * 26 : randomInt(rand, 3)
  for (let k = 0; k < adds; k++) {
    let plugs = 0
    for (let a = 0; a < 26; a++) if (P[a] > a) plugs++
    if (plugs >= maxPlugs) break
    const a = randomInt(rand, 26)
    const b = randomInt(rand, 26)
    if (a === b || P[a] !== a || P[b] !== b) continue
    P[a] = b
    P[b] = a
  }
}

/**
 * Every ring timing around a key with the plugboard P fixed: all right rings × all middle rings
 * (or only the right ring for ringSearch 'right'), wiring offsets kept, plus the neighbouring
 * left / middle start offsets (a turnover moved across the first letter). Distinct stepping
 * schedules only. Returns the best key by the n-gram objective (the original key included).
 */
function polishRings(
  ctx: SearchContext,
  base: RotorKey,
  P: Uint8Array,
  obj: NgramObjective,
): { key: RotorKey; value: number; trials: number } {
  const n = ctx.codes.length
  const notchM = rotorTables(base.middle).notch
  const notchR = rotorTables(base.right).notch
  const oL0 = base.posL
  const oM0 = mod(base.posM - base.ringM)
  const oR = mod(base.posR - base.ringR)
  const shifts: [number, number][] =
    ctx.ringSearch === 'right'
      ? [[0, 0], [0, 1], [0, -1]]
      : [[0, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]
  const middleRings = ctx.ringSearch === 'right-middle' ? Array.from({ length: 26 }, (_, i) => i) : [base.ringM]
  const rBase = new Int32Array(n)
  const iBase = new Int32Array(n)
  const tab = new Uint8Array(n * 26)
  // Start from the key as found, so it is only replaced by a strictly better timing.
  fillScheduleRaw(notchM, notchR, base.posL, base.posM, base.posR, base.ringM, base.ringR, n, rBase, iBase)
  const seen = new Set<number>([signatureOf(rBase, iBase, n)])
  buildTable(compiled(ctx, base), tab)
  let bestKey = base
  let bestValue = ngramObjective(ctx.codes, tab, P, obj)
  let trials = 1
  for (const [dL, dM] of shifts) {
    for (const rm of middleRings) {
      for (let r = 0; r < 26; r++) {
        const key: RotorKey = {
          ...base,
          posL: mod(oL0 + dL),
          ringM: rm,
          posM: mod(oM0 + dM + rm),
          ringR: r,
          posR: mod(oR + r),
        }
        fillScheduleRaw(notchM, notchR, key.posL, key.posM, key.posR, rm, r, n, rBase, iBase)
        const sig = signatureOf(rBase, iBase, n)
        if (seen.has(sig)) continue
        seen.add(sig)
        trials++
        buildTable(compiled(ctx, key), tab)
        const value = ngramObjective(ctx.codes, tab, P, obj)
        if (value > bestValue) {
          bestValue = value
          bestKey = key
        }
      }
    }
  }
  return { key: bestKey, value: bestValue, trials }
}

/**
 * Phase 3 for one candidate: hill-climbs the plugboard on bigram, then trigram, then quadgram
 * log-likelihood (+ crib), with random restarts. The rotor key stays fixed.
 */
export function runPlugboardSearch(
  ctx: SearchContext,
  cand: CoreCandidate,
  seed: number,
): { result: CoreCandidate; keys: number } {
  const model = ctx.ngrams
  if (!model) throw new Error('n-gram statistics are not loaded')
  const n = ctx.codes.length
  const c = compiled(ctx, cand.key)
  const tab = buildTable(c)
  const rand = mulberry32(seed)
  const objective = (order: 2 | 3 | 4): NgramObjective => ({
    model,
    order,
    crib: ctx.crib && ctx.crib.positions.length > 0 ? ctx.crib : null,
    cribWeight: CRIB_NGRAM_WEIGHT,
  })
  const passes = 30
  let keys = 0

  // The IoC climb first: n-gram scores are poor guides while most plugs are still wrong.
  const P = Uint8Array.from(cand.plugs)
  buildClassTable(ctx.layout, c.inner, c.rf, c.rb, c.rBase, c.iBase, ctx.tab)
  const exact = ctx.exactPlugs
  climbIoc(ctx.layout, ctx.tab, P, ctx.maxPlugs, passes, ctx.order, 26, exact)
  keys += 325
  // Exact cable count: add the best remaining pairs now, then the climbs only rewire.
  if (exact) keys += fillPlugs(ctx.codes, tab, P, ctx.maxPlugs, objective(2))
  keys += climbNgram(ctx.codes, tab, P, ctx.maxPlugs, objective(2), passes, exact).trials
  keys += climbNgram(ctx.codes, tab, P, ctx.maxPlugs, objective(3), passes, exact).trials
  let r = climbNgram(ctx.codes, tab, P, ctx.maxPlugs, objective(4), passes, exact)
  keys += r.trials
  const best = Uint8Array.from(P)
  let bestValue = r.value

  for (let k = 0; k < ctx.tuning.restarts; k++) {
    P.set(best)
    perturb(P, rand, ctx.maxPlugs, exact)
    keys += climbNgram(ctx.codes, tab, P, ctx.maxPlugs, objective(3), passes, exact).trials
    r = climbNgram(ctx.codes, tab, P, ctx.maxPlugs, objective(4), passes, exact)
    keys += r.trials
    if (r.value > bestValue) {
      bestValue = r.value
      best.set(P)
    }
  }

  // Ring polish: with the plugboard solved, every ring timing can be judged on the full decrypt.
  // This repairs keys whose middle ring (left turnover) or right ring (middle steps) is slightly
  // off — they decrypt one stretch of the message wrongly, which phases 1–2 cannot see.
  let key = cand.key
  let finalTab = tab
  if (ctx.ringSearch !== 'none') {
    const polish = polishRings(ctx, key, best, objective(4))
    keys += polish.trials
    if (polish.value > bestValue) {
      key = polish.key
      finalTab = buildTable(compiled(ctx, key))
      P.set(best)
      r = climbNgram(ctx.codes, finalTab, P, ctx.maxPlugs, objective(4), passes, exact)
      keys += r.trials
      best.set(P)
      bestValue = r.value
    }
  }

  const plain = decodeWith(ctx.codes, finalTab, best, new Uint8Array(n))
  const count = Math.max(1, n - 3)
  let text = ''
  for (let i = 0; i < n; i++) text += String.fromCharCode(65 + plain[i])
  return {
    result: {
      key,
      plugs: Array.from(best),
      score: model.floor[2] + bestValue / count,
      ioc: indexOfCoincidence(plain),
      phase: 'plugboard',
      plaintext: text,
    },
    keys,
  }
}

/* ------------------------------------------------------------------------ */
/* Phase 4: dictionary check                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Phase 4 for one phase-3 result: segments its plaintext into dictionary words; when the text
 * reads partly (exact coverage inside `polishRange`) and `polish` is set, a short plugboard
 * hill climb on quadgram score + dictionary coverage tries to repair broken words (a single
 * wrong plug pair typically breaks many). Ranking score: phase-3 score (n-grams + crib) +
 * WORDS_WEIGHT × exact coverage.
 */
export function runWordsSearch(
  ctx: SearchContext,
  cand: CoreCandidate,
  polish: boolean,
): { result: CoreCandidate; keys: number } {
  const dict = ctx.dictionary
  const model = ctx.ngrams
  if (!dict || !model) throw new Error('the dictionary / n-gram statistics are not loaded')
  const n = ctx.codes.length
  let plugs = Uint8Array.from(cand.plugs)
  let plaintext = cand.plaintext ?? ''
  let ngramScore = cand.score
  let keys = 0
  let improvedByWords = false
  const [lo, hi] = ctx.tuning.polishRange

  if (polish && n >= 4) {
    const start = exactCoverage(plaintext, dict)
    if (start >= lo && start < hi) {
      const c = compiled(ctx, cand.key)
      const tab = buildTable(c)
      const obj: NgramObjective = {
        model,
        order: 4,
        crib: ctx.crib && ctx.crib.positions.length > 0 ? ctx.crib : null,
        cribWeight: CRIB_NGRAM_WEIGHT,
      }
      const count = Math.max(1, n - 3)
      const plain = new Uint8Array(n)
      const ngramOf = (P: Uint8Array): number => model.floor[2] + ngramObjective(ctx.codes, tab, P, obj) / count
      const value = (P: Uint8Array): number =>
        ngramOf(P) + POLISH_WORDS_WEIGHT * exactCoverage(fromCodes(decodeWith(ctx.codes, tab, P, plain)), dict)
      const P = Uint8Array.from(plugs)
      const saved = new Uint8Array(26)
      let best = value(P)
      const initial = best
      let plugCount = countPlugs(P)
      for (let pass = 0; pass < 2; pass++) {
        let improved = false
        for (let a = 0; a < 25; a++) {
          for (let b = a + 1; b < 26; b++) {
            const x = P[a]
            const y = P[b]
            if (x === a && y === b && plugCount >= ctx.maxPlugs) continue
            if (ctx.exactPlugs && x === b) continue
            saved.set(P)
            let delta = 0
            if (x === b) {
              P[a] = a
              P[b] = b
              delta = -1
            } else {
              if (x === a && y === b) delta = 1
              if (x !== a) P[x] = y !== b ? y : x
              if (y !== b) P[y] = x !== a ? x : y
              P[a] = b
              P[b] = a
            }
            keys++
            const v = value(P)
            if (v > best) {
              best = v
              plugCount += delta
              improved = true
            } else {
              P.set(saved)
            }
          }
        }
        if (!improved) break
      }
      if (best > initial) {
        improvedByWords = true
        plugs = P
        plaintext = fromCodes(decodeWith(ctx.codes, tab, P, plain))
        ngramScore = ngramOf(P)
      }
    }
  }

  const words = scoreWords(plaintext, dict, ctx.typoTolerance)
  const { exactCoverage: exact, ...summary } = words
  return {
    result: {
      key: cand.key,
      plugs: Array.from(plugs),
      score: ngramScore + WORDS_WEIGHT * exact,
      ioc: indexOfCoincidence(plaintext),
      phase: improvedByWords ? 'words' : cand.phase,
      plaintext,
      words: summary,
    },
    keys,
  }
}
