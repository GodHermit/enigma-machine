/**
 * Buffer layouts of the WebGPU phase-1 backend (pure; shared by the WebGPU host, the JS
 * emulator in reference.ts and the tests). WGSL has no 8-bit storage, so byte tables are packed
 * four to a u32 (little end first).
 */
import type { CipherLayout } from '../climb'
import type { NgramModel } from '../ngrams'
import type { UnitPlan } from '../search'

/** Workgroup size of both kernels (also the number of cable pairs tried per round). */
export const WG = 64
/** "No value" marker in result buffers. */
export const NONE = 0xffffffff
/** Most stage-B ring variants per start position (26 right rings × 2 + every turnover moment). */
export const MAX_CAND = 96
/** u32 words per stage-A job in the output buffer: value + 7 words of packed plugboard. */
export const SCREEN_STRIDE = 8
/** u32 words per stage-B finalist: r, rm, Σcount², bigram sum, 7 words of plugboard, valid flag. */
export const FINAL_STRIDE = 12
/** u32 words per stage-B job in the input buffer: start position + 7 words of plugboard. */
export const JOB_STRIDE = 8

/** Packs bytes into u32 words, four per word, the first byte in the lowest bits. */
export function packBytes(bytes: ArrayLike<number>, out?: Uint32Array, offset = 0): Uint32Array {
  const words = Math.ceil(bytes.length / 4)
  const target = out ?? new Uint32Array(words)
  for (let w = 0; w < words; w++) {
    let v = 0
    for (let k = 0; k < 4; k++) {
      const i = w * 4 + k
      if (i < bytes.length) v |= (bytes[i] & 0xff) << (k * 8)
    }
    target[offset + w] = v >>> 0
  }
  return target
}

/** Byte i of a packed table starting at word `offset`. */
export function packedByte(words: Uint32Array, offset: number, i: number): number {
  return (words[offset + (i >>> 2)] >>> ((i & 3) * 8)) & 0xff
}

/** Packed plugboard: 26 bytes in 7 words. */
export function packPlugs(P: ArrayLike<number>, out: Uint32Array, offset: number): void {
  packBytes(P, out, offset)
}

export function unpackPlugs(words: Uint32Array, offset: number): Uint8Array {
  const P = new Uint8Array(26)
  for (let a = 0; a < 26; a++) P[a] = packedByte(words, offset, a)
  return P
}

/**
 * Message buffer: [codes n][classStart 27][classRank n][tabMap n·26][classPos n]. tabMap[o] = i | x << 16
 * names the message position i and plugboard-side letter x of class-table byte o
 * (o = classStart[z]·26 + x·count(z) + rank), so a kernel can fill whole packed words.
 */
export interface CipherBuffer {
  data: Uint32Array
  n: number
  classStartOff: number
  classRankOff: number
  tabMapOff: number
  classPosOff: number
}

export function cipherBuffer(layout: CipherLayout): CipherBuffer {
  const { n, codes, classStart, classPos, classRank } = layout
  const classStartOff = n
  const classRankOff = n + 27
  const tabMapOff = n + 27 + n
  const classPosOff = tabMapOff + n * 26
  const data = new Uint32Array(classPosOff + n)
  for (let k = 0; k < n; k++) data[classPosOff + k] = classPos[k]
  for (let i = 0; i < n; i++) data[i] = codes[i]
  for (let z = 0; z < 27; z++) data[classStartOff + z] = classStart[z]
  for (let i = 0; i < n; i++) data[classRankOff + i] = classRank[i]
  for (let z = 0; z < 26; z++) {
    const s = classStart[z]
    const cnt = classStart[z + 1] - s
    for (let j = 0; j < cnt; j++) {
      const i = classPos[s + j]
      for (let x = 0; x < 26; x++) data[tabMapOff + s * 26 + x * cnt + j] = i | (x << 16)
    }
  }
  return { data, n, classStartOff, classRankOff, tabMapOff, classPosOff }
}

/** Word offsets inside the tables buffer (all byte tables packed). */
export const TABLES = {
  inner: 0, // 676·26 bytes = 4394 words
  rf: 4394, // 676 bytes = 169 words
  rb: 4563,
  notchM: 4732, // 26 bytes = 7 words
  notchR: 4739,
  bigram: 4746, // 676 bytes = 169 words
  words: 4915,
} as const

/** Tables buffer of one unit and Greek position (inner changes with the Greek position). */
export function tablesBuffer(plan: UnitPlan, inner: Uint8Array, bigrams: NgramModel | null, out?: Uint32Array): Uint32Array {
  const t = out ?? new Uint32Array(TABLES.words)
  packBytes(inner, t, TABLES.inner)
  packBytes(plan.rf, t, TABLES.rf)
  packBytes(plan.rb, t, TABLES.rb)
  packBytes(plan.notchM, t, TABLES.notchM)
  packBytes(plan.notchR, t, TABLES.notchR)
  if (bigrams) packBytes(bigrams.bi, t, TABLES.bigram)
  return t
}

/**
 * Cable pairs tried by a climb, in the CPU's order: (order[i], order[j]) for i < j < limit,
 * packed a | b << 8.
 */
export function pairList(order: Uint8Array, limit: number): Uint32Array {
  const out: number[] = []
  for (let i = 0; i < limit - 1; i++) for (let j = i + 1; j < limit; j++) out.push(order[i] | (order[j] << 8))
  return Uint32Array.from(out)
}

/** Plan buffer: ring / turnover variants of a unit (see planBuffer). */
export interface PlanBuffer {
  data: Uint32Array
  /** u32 per middle offset in the screen table: count + up to (stride − 1) middle rings. */
  screenStride: number
  allOff: number
  allStride: number
  screenRingsOff: number
  sweepOff: number
  /** Stage-A variants per start position (largest screen list × screen rings). */
  variantsPerPos: number
}

/**
 * [screenRms per oM: count, rm…][allRms per oM: count, rm…][screenRings: count, r…]
 * [sweepRings: count, r…].
 */
export function planBuffer(plan: UnitPlan): PlanBuffer {
  const screenStride = 1 + Math.max(...plan.screenRms.map((l) => l.length))
  const allStride = 1 + Math.max(...plan.allRms.map((l) => l.length))
  const allOff = 26 * screenStride
  const screenRingsOff = allOff + 26 * allStride
  const sweepOff = screenRingsOff + 1 + plan.screenRings.length
  const data = new Uint32Array(sweepOff + 1 + plan.sweepRings.length)
  for (let oM = 0; oM < 26; oM++) {
    const s = plan.screenRms[oM]
    data[oM * screenStride] = s.length
    s.forEach((rm, k) => (data[oM * screenStride + 1 + k] = rm))
    const a = plan.allRms[oM]
    data[allOff + oM * allStride] = a.length
    a.forEach((rm, k) => (data[allOff + oM * allStride + 1 + k] = rm))
  }
  data[screenRingsOff] = plan.screenRings.length
  plan.screenRings.forEach((r, k) => (data[screenRingsOff + 1 + k] = r))
  data[sweepOff] = plan.sweepRings.length
  plan.sweepRings.forEach((r, k) => (data[sweepOff + 1 + k] = r))
  return {
    data,
    screenStride,
    allOff,
    allStride,
    screenRingsOff,
    sweepOff,
    variantsPerPos: (screenStride - 1) * plan.screenRings.length,
  }
}

/** Fields of the kernels' uniform block, in WGSL declaration order (all u32). */
export const PARAM_FIELDS = [
  'n',
  'maxPlugs',
  'jobBase',
  'jobCount',
  'screenPasses',
  'refinePasses',
  'finalPasses',
  'refineKeep',
  'screenBigram',
  'rankBigram',
  'variantsPerPos',
  'nScreenRings',
  'pairsScreenOff',
  'pairsScreenCount',
  'pairsRefineOff',
  'pairsRefineCount',
  'pairsFinalOff',
  'pairsFinalCount',
  'planScreenStride',
  'planAllOff',
  'planAllStride',
  'planScreenRingsOff',
  'planSweepOff',
  'classStartOff',
  'classRankOff',
  'tabMapOff',
  'classPosOff',
  'pad1',
] as const

export type ParamName = (typeof PARAM_FIELDS)[number]
export type Params = Record<ParamName, number>

export function paramsBuffer(p: Params): Uint32Array {
  return Uint32Array.from(PARAM_FIELDS, (f) => p[f])
}

/**
 * Best variant per start position from stage-A results (first best in variant order, like the
 * CPU), as the screen value and plugboard arrays the CPU stage produces.
 */
export function reduceScreen(
  out: Uint32Array,
  variantsPerPos: number,
  screen: Float64Array,
  screenP: Uint8Array,
  firstPos = 0,
  positions = 17576,
): void {
  for (let p = 0; p < positions; p++) {
    const pos = firstPos + p
    let best = -1
    let bestJob = -1
    for (let v = 0; v < variantsPerPos; v++) {
      const job = p * variantsPerPos + v
      const value = out[job * SCREEN_STRIDE]
      if (value === NONE) continue
      if (value > best) {
        best = value
        bestJob = job
      }
    }
    screen[pos] = best
    if (bestJob >= 0) {
      for (let a = 0; a < 26; a++) screenP[pos * 26 + a] = packedByte(out, bestJob * SCREEN_STRIDE + 1, a)
    }
  }
}

/** Stage-B input jobs: start position + its screen plugboard. */
export function refineJobs(selection: Int32Array, screenP: Uint8Array): Uint32Array {
  const jobs = new Uint32Array(selection.length * JOB_STRIDE)
  selection.forEach((idx, k) => {
    jobs[k * JOB_STRIDE] = idx
    packPlugs(screenP.subarray(idx * 26, idx * 26 + 26), jobs, k * JOB_STRIDE + 1)
  })
  return jobs
}
