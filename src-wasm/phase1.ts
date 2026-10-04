/**
 * Phase 1 of the Enigma codebreaker (stages A and B of src/lib/breaker/search.ts) in
 * AssemblyScript, bit-identical to the JavaScript implementation. Built by scripts/build-wasm.mjs
 * into src/lib/breaker/wasm/phase1.wasm (SIMD) and phase1-scalar.wasm (same algorithm, no SIMD).
 *
 * All data lives in linear memory at offsets chosen by the JS glue (wasm-stages.ts), which writes
 * a parameter block (layout below) and calls `configure`. Nothing is allocated here.
 *
 * Data structure. The JS climbs keep a class-major scrambler table and add up count changes
 * position by position. Here the table is position-major (TAB: 32 bytes per message position,
 * outputs for the 26 plugboard-side inputs) and every class row is summarised by its histogram:
 * H[z][x][v] = number of positions with ciphertext letter z whose scrambler output for input x
 * is v (i16, 32 lanes per row). Moving class z from input `from` to input `to` changes the output
 * counts by H[z][to] − H[z][from], so the count change of a cable move is a sum of 2–4 row
 * differences — independent of the message length, and four v128 adds per row. The Σcount²
 * change Σ d·(2T + d) is four i32x4.dot_i16x8_s (2T + d < 2^15 needs n ≤ 10922 letters; the JS
 * glue runs longer messages in JavaScript). All of this is exact integer arithmetic, so the
 * result (first improving move, Σcount², plugboard) equals the JS climb's.
 *
 * When the stepping schedule of a variant differs from the previous one only at some positions,
 * only those TAB rows (and their histogram entries) are rewritten — like search.ts planUpdater.
 */

// Parameter block (i32 words at the address passed to configure); wasm-stages.ts PARAMS.
const P_N = 0
const P_MAX_PLUGS = 1
const P_SCREEN_PASSES = 2
const P_REFINE_PASSES = 3
const P_FINAL_PASSES = 4
const P_REFINE_KEEP = 5
const P_SCREEN_BIGRAM = 6
const P_RANK_BIGRAM = 7
const P_SCREEN_PAIR_COUNT = 8
const P_REFINE_PAIR_COUNT = 9
const P_FINAL_PAIR_COUNT = 10
const P_SCREEN_RING_COUNT = 11
const P_SWEEP_RING_COUNT = 12
const P_SCREEN_RMS_STRIDE = 13
const P_ALL_RMS_STRIDE = 14
const P_RF = 15
const P_RB = 16
const P_INNER = 17
const P_NOTCH_M = 18
const P_NOTCH_R = 19
const P_BIGRAM = 20
const P_CODES = 21
const P_PAIRS_SCREEN = 22
const P_PAIRS_REFINE = 23
const P_PAIRS_FINAL = 24
const P_SCREEN_RMS = 25
const P_ALL_RMS = 26
const P_SCREEN_RINGS = 27
const P_SWEEP_RINGS = 28
const P_H = 29
const P_TAB = 30
const P_CUR = 31
const P_PLUGS = 32
const P_BEST_PLUGS = 33
const P_SCRATCH = 34
const P_SCREEN = 35
const P_SCREEN_P = 36
const P_SELECTION = 37
const P_CAND = 38
const P_CAND_CAP = 39
const P_FINALS = 40
const P_NEXT = 41

/** Bytes of one histogram row (32 × i16) and of one TAB row. */
const HROW: i32 = 64
const TROW: i32 = 32
/** Bytes per stage-B finalist: idx, r, rm, Σcount², bigram sum (i32) + 26 plugboard bytes + pad. */
const FINAL_BYTES: i32 = 48

let n: i32 = 0
let maxPlugs: i32 = 0
let screenPasses: i32 = 0
let refinePasses: i32 = 0
let finalPasses: i32 = 0
let refineKeep: i32 = 1
let screenBigram: bool = false
let rankBigram: bool = false
let screenPairCount: i32 = 0
let refinePairCount: i32 = 0
let finalPairCount: i32 = 0
let screenRingCount: i32 = 0
let sweepRingCount: i32 = 0
let screenRmsStride: i32 = 0
let allRmsStride: i32 = 0

let RF: usize = 0
let RB: usize = 0
let INNER: usize = 0
let NOTCH_M: usize = 0
let NOTCH_R: usize = 0
let BIGRAM: usize = 0
let CODES: usize = 0
let PAIRS_SCREEN: usize = 0
let PAIRS_REFINE: usize = 0
let PAIRS_FINAL: usize = 0
let SCREEN_RMS: usize = 0
let ALL_RMS: usize = 0
let SCREEN_RINGS: usize = 0
let SWEEP_RINGS: usize = 0
let H: usize = 0
let TAB: usize = 0
let CUR: usize = 0
let PLUGS: usize = 0
let BEST_PLUGS: usize = 0
let SCRATCH: usize = 0
let SCREEN: usize = 0
let SCREEN_P: usize = 0
let SELECTION: usize = 0
let CAND: usize = 0
let CAND_CAP: i32 = 0
let FINALS: usize = 0
let NEXT: usize = 0

/** First free byte after the module's own data (64-byte aligned): the JS layout starts here. */
export function heapBase(): usize {
  return (__heap_base + 63) & ~(<usize>63)
}

/** True when this build uses SIMD (phase1.wasm) rather than scalar code (phase1-scalar.wasm). */
export function simd(): bool {
  return ASC_FEATURE_SIMD
}

@inline function param(block: usize, k: i32): i32 {
  return load<i32>(block + (<usize>k << 2))
}

/** Reads the parameter block (see the P_ constants). */
export function configure(block: usize): void {
  n = param(block, P_N)
  maxPlugs = param(block, P_MAX_PLUGS)
  screenPasses = param(block, P_SCREEN_PASSES)
  refinePasses = param(block, P_REFINE_PASSES)
  finalPasses = param(block, P_FINAL_PASSES)
  refineKeep = param(block, P_REFINE_KEEP)
  screenBigram = param(block, P_SCREEN_BIGRAM) != 0
  rankBigram = param(block, P_RANK_BIGRAM) != 0
  screenPairCount = param(block, P_SCREEN_PAIR_COUNT)
  refinePairCount = param(block, P_REFINE_PAIR_COUNT)
  finalPairCount = param(block, P_FINAL_PAIR_COUNT)
  screenRingCount = param(block, P_SCREEN_RING_COUNT)
  sweepRingCount = param(block, P_SWEEP_RING_COUNT)
  screenRmsStride = param(block, P_SCREEN_RMS_STRIDE)
  allRmsStride = param(block, P_ALL_RMS_STRIDE)
  RF = <usize>param(block, P_RF)
  RB = <usize>param(block, P_RB)
  INNER = <usize>param(block, P_INNER)
  NOTCH_M = <usize>param(block, P_NOTCH_M)
  NOTCH_R = <usize>param(block, P_NOTCH_R)
  BIGRAM = <usize>param(block, P_BIGRAM)
  CODES = <usize>param(block, P_CODES)
  PAIRS_SCREEN = <usize>param(block, P_PAIRS_SCREEN)
  PAIRS_REFINE = <usize>param(block, P_PAIRS_REFINE)
  PAIRS_FINAL = <usize>param(block, P_PAIRS_FINAL)
  SCREEN_RMS = <usize>param(block, P_SCREEN_RMS)
  ALL_RMS = <usize>param(block, P_ALL_RMS)
  SCREEN_RINGS = <usize>param(block, P_SCREEN_RINGS)
  SWEEP_RINGS = <usize>param(block, P_SWEEP_RINGS)
  H = <usize>param(block, P_H)
  TAB = <usize>param(block, P_TAB)
  CUR = <usize>param(block, P_CUR)
  PLUGS = <usize>param(block, P_PLUGS)
  BEST_PLUGS = <usize>param(block, P_BEST_PLUGS)
  SCRATCH = <usize>param(block, P_SCRATCH)
  SCREEN = <usize>param(block, P_SCREEN)
  SCREEN_P = <usize>param(block, P_SCREEN_P)
  SELECTION = <usize>param(block, P_SELECTION)
  CAND = <usize>param(block, P_CAND)
  CAND_CAP = param(block, P_CAND_CAP)
  FINALS = <usize>param(block, P_FINALS)
  NEXT = <usize>param(block, P_NEXT)
}

/* ------------------------------------------------------------------------ */
/* Scrambler table + histograms                                              */
/* ------------------------------------------------------------------------ */

/** TAB row of one position: out[x] = rb[or][inner[ib][rf[or][x]]] for x < 32 (lanes ≥ 26 unused). */
@inline function computeRow(or: i32, ib: i32, out: usize): void {
  if (ASC_FEATURE_SIMD) rowSimd(or, ib, out)
  else rowScalar(or, ib, out)
}

/** 32-lane lookup in a 32-byte table (t0 = entries 0–15, t1 = 16–31) with i8x16.swizzle. */
@inline function lookup(t0: v128, t1: v128, idx: v128): v128 {
  return v128.or(i8x16.swizzle(t0, idx), i8x16.swizzle(t1, i8x16.sub(idx, i8x16.splat(16))))
}

function rowSimd(or: i32, ib: i32, out: usize): void {
  const rf = RF + (<usize>or << 5)
  const rb = RB + (<usize>or << 5)
  const inner = INNER + (<usize>ib << 5)
  const i0 = v128.load(inner)
  const i1 = v128.load(inner, 16)
  const b0 = v128.load(rb)
  const b1 = v128.load(rb, 16)
  v128.store(out, lookup(b0, b1, lookup(i0, i1, v128.load(rf))))
  v128.store(out, lookup(b0, b1, lookup(i0, i1, v128.load(rf, 16))), 16)
}

function rowScalar(or: i32, ib: i32, out: usize): void {
  const rf = RF + (<usize>or << 5)
  const rb = RB + (<usize>or << 5)
  const inner = INNER + (<usize>ib << 5)
  for (let x: usize = 0; x < 26; x++) {
    store<u8>(out + x, load<u8>(rb + <usize>load<u8>(inner + <usize>load<u8>(rf + x))))
  }
}

@inline function inc26(x: i32): i32 {
  return x == 25 ? 0 : x + 1
}

/**
 * Stepping schedule of a variant (fillScheduleRaw with posM = oM + rm, posR = oR + r, rings rm / r)
 * and the TAB rows + histograms for it. Positions whose (right offset, left·middle offset) did not
 * change since the last call keep their rows; when most changed (or `full`), everything is rebuilt
 * from scratch, which costs half as many histogram updates per position.
 */
function setVariant(pL: i32, oM: i32, oR: i32, rm: i32, r: i32, full: bool): void {
  const next = NEXT
  const curs = CUR
  const tab = TAB
  const codes = CODES
  const hist = H
  const notchM = NOTCH_M
  const notchR = NOTCH_R
  const len = n
  let pl = pL
  let pm = (oM + rm) % 26
  let pr = (oR + r) % 26
  let changed = 0
  for (let i = 0; i < len; i++) {
    if (load<u8>(notchM + <usize>pm) == 1) {
      pl = inc26(pl)
      pm = inc26(pm)
    } else if (load<u8>(notchR + <usize>pr) == 1) {
      pm = inc26(pm)
    }
    pr = inc26(pr)
    let or = pr - r
    if (or < 0) or += 26
    let om = pm - rm
    if (om < 0) om += 26
    const key = or | ((pl * 26 + om) << 8)
    store<i32>(next + (<usize>i << 2), key)
    changed += <i32>(key != load<i32>(curs + (<usize>i << 2)))
  }
  if (full || changed * 5 > len * 3) {
    memory.fill(hist, 0, 676 * HROW)
    for (let i = 0; i < len; i++) {
      const key = load<i32>(next + (<usize>i << 2))
      store<i32>(curs + (<usize>i << 2), key)
      const row = tab + (<usize>i << 5)
      computeRow(key & 0xff, key >> 8, row)
      const hz = hist + <usize>(<i32>load<u8>(codes + <usize>i) * 26 * HROW)
      for (let x: usize = 0; x < 26; x += 2) {
        const h0 = hz + (x << 6) + (<usize>load<u8>(row + x) << 1)
        const h1 = hz + (x << 6) + 64 + (<usize>load<u8>(row + x, 1) << 1)
        store<u16>(h0, load<u16>(h0) + 1)
        store<u16>(h1, load<u16>(h1) + 1)
      }
    }
    return
  }
  if (changed == 0) return
  const scratch = SCRATCH
  for (let i = 0; i < len; i++) {
    const key = load<i32>(next + (<usize>i << 2))
    const cur = curs + (<usize>i << 2)
    if (load<i32>(cur) == key) continue
    store<i32>(cur, key)
    const row = tab + (<usize>i << 5)
    computeRow(key & 0xff, key >> 8, scratch)
    const hz = hist + <usize>(<i32>load<u8>(codes + <usize>i) * 26 * HROW)
    for (let x: usize = 0; x < 26; x += 2) {
      // Old output − 1, new output + 1 (the same entry when unchanged: net 0).
      const h0 = hz + (x << 6)
      const o0 = h0 + (<usize>load<u8>(row + x) << 1)
      const w0 = h0 + (<usize>load<u8>(scratch + x) << 1)
      const o1 = h0 + 64 + (<usize>load<u8>(row + x, 1) << 1)
      const w1 = h0 + 64 + (<usize>load<u8>(scratch + x, 1) << 1)
      store<u16>(o0, load<u16>(o0) - 1)
      store<u16>(o1, load<u16>(o1) - 1)
      store<u16>(w0, load<u16>(w0) + 1)
      store<u16>(w1, load<u16>(w1) + 1)
    }
    store<u64>(row, load<u64>(scratch))
    store<u64>(row, load<u64>(scratch, 8), 8)
    store<u64>(row, load<u64>(scratch, 16), 16)
    store<u64>(row, load<u64>(scratch, 24), 24)
  }
}

/** Bigram sum of the decrypt under PLUGS (decodeClassTable + ngramSum order 2). */
function bigramSum(): i32 {
  const len = n
  if (len < 2) return 0
  const P = PLUGS
  const tab = TAB
  const codes = CODES
  const bigram = BIGRAM
  let prev = <i32>load<u8>(P + <usize>load<u8>(tab + <usize>load<u8>(P + <usize>load<u8>(codes))))
  let sum = 0
  for (let i = 1; i < len; i++) {
    const cur = <i32>load<u8>(P + <usize>load<u8>(tab + (<usize>i << 5) + <usize>load<u8>(P + <usize>load<u8>(codes + <usize>i))))
    sum += <i32>load<u8>(bigram + <usize>(prev * 26 + cur))
    prev = cur
  }
  return sum
}

/* ------------------------------------------------------------------------ */
/* Hill climb (climb.ts climbIoc)                                            */
/* ------------------------------------------------------------------------ */

/** Histogram row (z, x); `h` is H (globals are re-read from memory on every use, locals are not). */
@inline function hrow(h: usize, z: i32, x: i32): usize {
  return h + (<usize>(z * 26 + x) << 6)
}

/**
 * First-improvement IoC climb of PLUGS over `count` cable pairs (u16: a | b << 8) for at most
 * `passes` passes. Returns Σcount² of the final decrypt.
 */
function climb(pairs: usize, count: i32, passes: i32): i32 {
  if (ASC_FEATURE_SIMD) return climbSimd(pairs, count, passes)
  return climbScalar(pairs, count, passes)
}

@inline function hsum(v: v128): i32 {
  const s = i32x4.add(v, i32x4.shuffle(v, v, 2, 3, 0, 1))
  return i32x4.extract_lane(s, 0) + i32x4.extract_lane(s, 1)
}

function climbSimd(pairs: usize, count: i32, passes: i32): i32 {
  const P = PLUGS
  const h = H
  // U = 2T (twice the output counts), 32 i16 lanes; 2T + d ≤ 3n stays below 2^15 for n ≤ 10922.
  let U0 = i16x8.splat(0)
  let U1 = U0
  let U2 = U0
  let U3 = U0
  let plugs = 0
  for (let z = 0; z < 26; z++) {
    const pz = <i32>load<u8>(P + <usize>z)
    if (pz > z) plugs++
    const row = hrow(h, z, pz)
    U0 = i16x8.add(U0, v128.load(row))
    U1 = i16x8.add(U1, v128.load(row, 16))
    U2 = i16x8.add(U2, v128.load(row, 32))
    U3 = i16x8.add(U3, v128.load(row, 48))
  }
  let sum = hsum(
    i32x4.add(
      i32x4.add(i32x4.dot_i16x8_s(U0, U0), i32x4.dot_i16x8_s(U1, U1)),
      i32x4.add(i32x4.dot_i16x8_s(U2, U2), i32x4.dot_i16x8_s(U3, U3)),
    ),
  )
  U0 = i16x8.add(U0, U0)
  U1 = i16x8.add(U1, U1)
  U2 = i16x8.add(U2, U2)
  U3 = i16x8.add(U3, U3)
  const limit = maxPlugs
  for (let pass = 0; pass < passes; pass++) {
    let improved = false
    for (let k = 0; k < count; k++) {
      const pr = <i32>load<u16>(pairs + (<usize>k << 1))
      const a = pr & 0xff
      const b = pr >> 8
      const x = <i32>load<u8>(P + <usize>a)
      const y = <i32>load<u8>(P + <usize>b)
      if (x == a && y == b && plugs >= limit) continue
      // Count change d = Σ (row `to` − row `from`) over the class moves of climb.ts `moves`.
      let p1: usize, m1: usize, p2: usize, m2: usize
      if (x == b) {
        p1 = hrow(h, a, a)
        m1 = hrow(h, a, b)
        p2 = hrow(h, b, b)
        m2 = hrow(h, b, a)
      } else {
        p1 = hrow(h, a, b)
        m1 = hrow(h, a, x)
        p2 = hrow(h, b, a)
        m2 = hrow(h, b, y)
      }
      let D0 = i16x8.sub(i16x8.add(v128.load(p1), v128.load(p2)), i16x8.add(v128.load(m1), v128.load(m2)))
      let D1 = i16x8.sub(i16x8.add(v128.load(p1, 16), v128.load(p2, 16)), i16x8.add(v128.load(m1, 16), v128.load(m2, 16)))
      let D2 = i16x8.sub(i16x8.add(v128.load(p1, 32), v128.load(p2, 32)), i16x8.add(v128.load(m1, 32), v128.load(m2, 32)))
      let D3 = i16x8.sub(i16x8.add(v128.load(p1, 48), v128.load(p2, 48)), i16x8.add(v128.load(m1, 48), v128.load(m2, 48)))
      if (x != b && (x != a || y != b)) {
        // Former partners: x moves from a to y (or to itself), y from b to x (or to itself).
        // An absent move uses the same row twice and cancels.
        let p3 = h
        let m3 = h
        let p4 = h
        let m4 = h
        if (x != a) {
          p3 = hrow(h, x, y != b ? y : x)
          m3 = hrow(h, x, a)
        }
        if (y != b) {
          p4 = hrow(h, y, x != a ? x : y)
          m4 = hrow(h, y, b)
        }
        D0 = i16x8.add(D0, i16x8.sub(i16x8.add(v128.load(p3), v128.load(p4)), i16x8.add(v128.load(m3), v128.load(m4))))
        D1 = i16x8.add(D1, i16x8.sub(i16x8.add(v128.load(p3, 16), v128.load(p4, 16)), i16x8.add(v128.load(m3, 16), v128.load(m4, 16))))
        D2 = i16x8.add(D2, i16x8.sub(i16x8.add(v128.load(p3, 32), v128.load(p4, 32)), i16x8.add(v128.load(m3, 32), v128.load(m4, 32))))
        D3 = i16x8.add(D3, i16x8.sub(i16x8.add(v128.load(p3, 48), v128.load(p4, 48)), i16x8.add(v128.load(m3, 48), v128.load(m4, 48))))
      }
      // Σcount² change Σ d·(2T + d); i32 lanes, exact (the sums wrap only in intermediate lanes).
      const delta = hsum(
        i32x4.add(
          i32x4.add(i32x4.dot_i16x8_s(D0, i16x8.add(U0, D0)), i32x4.dot_i16x8_s(D1, i16x8.add(U1, D1))),
          i32x4.add(i32x4.dot_i16x8_s(D2, i16x8.add(U2, D2)), i32x4.dot_i16x8_s(D3, i16x8.add(U3, D3))),
        ),
      )
      if (delta > 0) {
        U0 = i16x8.add(U0, i16x8.add(D0, D0))
        U1 = i16x8.add(U1, i16x8.add(D1, D1))
        U2 = i16x8.add(U2, i16x8.add(D2, D2))
        U3 = i16x8.add(U3, i16x8.add(D3, D3))
        sum += delta
        plugs = applyMove(a, b, x, y, plugs)
        improved = true
      }
    }
    if (!improved) break
  }
  return sum
}

/** Applies the cable move of pair (a, b) to PLUGS (climbIoc); returns the new number of cables. */
@inline function applyMove(a: i32, b: i32, x: i32, y: i32, plugs: i32): i32 {
  const P = PLUGS
  if (x == b) {
    store<u8>(P + <usize>a, <u8>a)
    store<u8>(P + <usize>b, <u8>b)
    return plugs - 1
  }
  if (x == a && y == b) plugs++
  if (x != a) store<u8>(P + <usize>x, <u8>(y != b ? y : x))
  if (y != b) store<u8>(P + <usize>y, <u8>(x != a ? x : y))
  store<u8>(P + <usize>a, <u8>b)
  store<u8>(P + <usize>b, <u8>a)
  return plugs
}

/** climbSimd with scalar loops over the 26 letters (builds / runtimes without SIMD). T: SCRATCH + 32. */
function climbScalar(pairs: usize, count: i32, passes: i32): i32 {
  const P = PLUGS
  const h = H
  const T = SCRATCH + 32
  for (let v: usize = 0; v < 26; v++) store<i32>(T + (v << 2), 0)
  let plugs = 0
  for (let z = 0; z < 26; z++) {
    const pz = <i32>load<u8>(P + <usize>z)
    if (pz > z) plugs++
    const row = hrow(h, z, pz)
    for (let v: usize = 0; v < 26; v++) {
      store<i32>(T + (v << 2), load<i32>(T + (v << 2)) + <i32>load<i16>(row + (v << 1)))
    }
  }
  let sum = 0
  for (let v: usize = 0; v < 26; v++) {
    const t = load<i32>(T + (v << 2))
    sum += t * t
  }
  const limit = maxPlugs
  for (let pass = 0; pass < passes; pass++) {
    let improved = false
    for (let k = 0; k < count; k++) {
      const pr = <i32>load<u16>(pairs + (<usize>k << 1))
      const a = pr & 0xff
      const b = pr >> 8
      const x = <i32>load<u8>(P + <usize>a)
      const y = <i32>load<u8>(P + <usize>b)
      if (x == a && y == b && plugs >= limit) continue
      let p1: usize, m1: usize, p2: usize, m2: usize
      let p3 = h
      let m3 = h
      let p4 = h
      let m4 = h
      if (x == b) {
        p1 = hrow(h, a, a)
        m1 = hrow(h, a, b)
        p2 = hrow(h, b, b)
        m2 = hrow(h, b, a)
      } else {
        p1 = hrow(h, a, b)
        m1 = hrow(h, a, x)
        p2 = hrow(h, b, a)
        m2 = hrow(h, b, y)
        if (x != a) {
          p3 = hrow(h, x, y != b ? y : x)
          m3 = hrow(h, x, a)
        }
        if (y != b) {
          p4 = hrow(h, y, x != a ? x : y)
          m4 = hrow(h, y, b)
        }
      }
      let delta = 0
      for (let v: usize = 0; v < 52; v += 2) {
        const d =
          <i32>load<i16>(p1 + v) - <i32>load<i16>(m1 + v) + <i32>load<i16>(p2 + v) - <i32>load<i16>(m2 + v) +
          <i32>load<i16>(p3 + v) - <i32>load<i16>(m3 + v) + <i32>load<i16>(p4 + v) - <i32>load<i16>(m4 + v)
        delta += d * (2 * load<i32>(T + (v << 1)) + d)
      }
      if (delta > 0) {
        for (let v: usize = 0; v < 52; v += 2) {
          const d =
            <i32>load<i16>(p1 + v) - <i32>load<i16>(m1 + v) + <i32>load<i16>(p2 + v) - <i32>load<i16>(m2 + v) +
            <i32>load<i16>(p3 + v) - <i32>load<i16>(m3 + v) + <i32>load<i16>(p4 + v) - <i32>load<i16>(m4 + v)
          store<i32>(T + (v << 1), load<i32>(T + (v << 1)) + d)
        }
        sum += delta
        plugs = applyMove(a, b, x, y, plugs)
        improved = true
      }
    }
    if (!improved) break
  }
  return sum
}

/* ------------------------------------------------------------------------ */
/* Stage A                                                                    */
/* ------------------------------------------------------------------------ */

@inline function identityPlugs(): void {
  for (let a: usize = 0; a < 26; a++) store<u8>(PLUGS + a, <u8>a)
}

/**
 * Stage A for the 676 start positions with left offset pL (screenStage): every screen variant
 * (middle ring × right ring) climbs from an empty plugboard; the first best value per position
 * (in the JS variant order) and its plugboard go to SCREEN / SCREEN_P. The variants are visited
 * in an order with fewer schedule changes between neighbours (right rings back and forth, left
 * turnovers from late to early); the tie-break on the JS variant index keeps the JS choice. BEST_PLUGS carries over between positions like the
 * JS (it only matters when there are no variants at all).
 */
export function screen(pL: i32): void {
  const nR = screenRingCount
  for (let oM = 0; oM < 26; oM++) {
    const rms = SCREEN_RMS + <usize>(oM * screenRmsStride * 4)
    const rmCount = load<i32>(rms)
    for (let oR = 0; oR < 26; oR++) {
      let best = -1
      let bestV = 0
      let first = true
      for (let jj = 0; jj < rmCount; jj++) {
        // Middle rings: none first, then the latest left turnover first (each step moves the
        // turnover back a little instead of jumping from "none" to the earliest).
        const j = jj == 0 ? 0 : rmCount - jj
        const rm = load<i32>(rms + 4 + (<usize>j << 2))
        for (let kk = 0; kk < nR; kk++) {
          const k = jj & 1 ? nR - 1 - kk : kk
          const r = load<i32>(SCREEN_RINGS + (<usize>k << 2))
          setVariant(pL, oM, oR, rm, r, first)
          first = false
          identityPlugs()
          let sum = climb(PAIRS_SCREEN, screenPairCount, screenPasses)
          if (screenBigram) sum = bigramSum()
          const v = j * nR + k
          if (sum > best || (sum == best && v < bestV)) {
            best = sum
            bestV = v
            memory.copy(BEST_PLUGS, PLUGS, 26)
          }
        }
      }
      const idx = (pL * 26 + oM) * 26 + oR
      store<i32>(SCREEN + (<usize>idx << 2), best)
      memory.copy(SCREEN_P + <usize>(idx * 26), BEST_PLUGS, 26)
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Stage B                                                                    */
/* ------------------------------------------------------------------------ */

let candN: i32 = 0
let firstVariant: bool = true

/** Candidate list: CAND = sums, + CAND_CAP·4 = right rings, + CAND_CAP·8 = middle rings, + 12 = taken flags. */
function tryVariant(pL: i32, oM: i32, oR: i32, rm: i32, r: i32, start: usize): i32 {
  setVariant(pL, oM, oR, rm, r, firstVariant)
  firstVariant = false
  memory.copy(PLUGS, start, 26)
  let sum = climb(PAIRS_REFINE, refinePairCount, refinePasses)
  if (rankBigram) sum = bigramSum()
  const c = <usize>candN << 2
  const cap = <usize>CAND_CAP << 2
  store<i32>(CAND + c, sum)
  store<i32>(CAND + cap + c, r)
  store<i32>(CAND + cap * 2 + c, rm)
  candN++
  return sum
}

/** Right ring with the best value for middle ring rm (first best in ring order). */
function sweepRight(pL: i32, oM: i32, oR: i32, rm: i32, start: usize): i32 {
  let bestR = 0
  let best = -1
  for (let k = 0; k < sweepRingCount; k++) {
    const r = load<i32>(SWEEP_RINGS + (<usize>k << 2))
    const sum = tryVariant(pL, oM, oR, rm, r, start)
    if (sum > best) {
      best = sum
      bestR = r
    }
  }
  return bestR
}

/**
 * Stage B ('sweep', refineStage) for the `count` start positions in SELECTION: sweep the right
 * ring, then the left-turnover moments, then the right ring again; the best refineKeep variants
 * (stable: ties in the order tried) get finalPasses over all letters. Finalists go to FINALS
 * (FINAL_BYTES each, in the JS order); returns their number.
 */
export function refine(count: i32): i32 {
  const cap = <usize>CAND_CAP << 2
  const taken = CAND + cap * 3
  let out = FINALS
  let finals = 0
  for (let s = 0; s < count; s++) {
    const idx = load<i32>(SELECTION + (<usize>s << 2))
    const oR = idx % 26
    const oM = (idx / 26) % 26
    const pL = idx / 676
    const start = SCREEN_P + <usize>(idx * 26)
    candN = 0
    firstVariant = true
    const rms = ALL_RMS + <usize>(oM * allRmsStride * 4)
    const rmCount = load<i32>(rms)
    const rm0 = load<i32>(rms + 4)
    const r1 = sweepRight(pL, oM, oR, rm0, start)
    let bestRm = rm0
    let best = -1
    for (let c = 0; c < candN; c++) {
      const cc = <usize>c << 2
      if (load<i32>(CAND + cap + cc) == r1 && load<i32>(CAND + cap * 2 + cc) == rm0) best = load<i32>(CAND + cc)
    }
    for (let j = 1; j < rmCount; j++) {
      const rm = load<i32>(rms + 4 + (<usize>j << 2))
      const sum = tryVariant(pL, oM, oR, rm, r1, start)
      if (sum > best) {
        best = sum
        bestRm = rm
      }
    }
    if (bestRm != rm0) sweepRight(pL, oM, oR, bestRm, start)

    // cand.sort((a, b) => b.sum - a.sum).slice(0, keep): repeatedly the first unused maximum.
    const keep = min(refineKeep, candN)
    memory.fill(taken, 0, <usize>candN)
    for (let f = 0; f < keep; f++) {
      let pick = -1
      let pickSum = 0
      for (let c = 0; c < candN; c++) {
        if (load<u8>(taken + <usize>c) != 0) continue
        const v = load<i32>(CAND + (<usize>c << 2))
        if (pick < 0 || v > pickSum) {
          pick = c
          pickSum = v
        }
      }
      store<u8>(taken + <usize>pick, 1)
      const pc = <usize>pick << 2
      const r = load<i32>(CAND + cap + pc)
      const rm = load<i32>(CAND + cap * 2 + pc)
      setVariant(pL, oM, oR, rm, r, false)
      memory.copy(PLUGS, start, 26)
      const sumSq = climb(PAIRS_FINAL, finalPairCount, finalPasses)
      const bsum = rankBigram ? bigramSum() : 0
      store<i32>(out, idx)
      store<i32>(out, r, 4)
      store<i32>(out, rm, 8)
      store<i32>(out, sumSq, 12)
      store<i32>(out, bsum, 16)
      memory.copy(out + 20, PLUGS, 26)
      out += FINAL_BYTES
      finals++
    }
  }
  return finals
}
