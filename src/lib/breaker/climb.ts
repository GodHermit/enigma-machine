/**
 * Plugboard hill climbers.
 *
 * Neighbourhood (Weierud & Sullivan style): for every letter pair a < b, "connect a–b"
 * (a former partner x of a and y of b are either freed or, as a second variant, connected
 * to each other) or, when a–b is already connected, "disconnect a–b".
 *
 * - climbIoc works on the input side only: the index of coincidence of the decrypt does not
 *   change when a fixed permutation (the output plugboard) is applied to every letter, so
 *   only the plugboard on the way in matters. Using a class-major scrambler table (positions
 *   grouped by ciphertext letter) a move costs O(occurrences of the touched letters), not O(N).
 * - climbNgram rescores the full decrypt (O(N) per move) with bigram / trigram / quadgram
 *   log-likelihood plus an optional crib term.
 */
import type { NgramModel } from './ngrams'

export interface CipherLayout {
  n: number
  codes: Uint8Array
  /** Positions grouped by ciphertext letter: class z = classPos[classStart[z] .. classStart[z + 1]). */
  classStart: Int32Array
  classPos: Int32Array
  /** Index of each position within its class. */
  classRank: Int32Array
}

export function cipherLayout(codes: Uint8Array): CipherLayout {
  const n = codes.length
  const classStart = new Int32Array(27)
  for (let i = 0; i < n; i++) classStart[codes[i] + 1]++
  for (let z = 0; z < 26; z++) classStart[z + 1] += classStart[z]
  const fill = classStart.slice(0, 26)
  const classPos = new Int32Array(n)
  const classRank = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const k = fill[codes[i]]++
    classPos[k] = i
    classRank[i] = k - classStart[codes[i]]
  }
  return { n, codes, classStart, classPos, classRank }
}

/**
 * Class-major scrambler table: for class z (s = classStart[z], cnt = its size) and input x,
 * out[s * 26 + x * cnt + j] = scrambler output at position classPos[s + j] for input x.
 * rBase / iBase are the schedule in position order (see fillSchedule).
 */
export function buildClassTable(
  layout: CipherLayout,
  inner: Uint8Array,
  rf: Uint8Array,
  rb: Uint8Array,
  rBase: Int32Array,
  iBase: Int32Array,
  out: Uint8Array,
): void {
  const cs = layout.classStart
  const cp = layout.classPos
  for (let z = 0; z < 26; z++) {
    const s = cs[z]
    const cnt = cs[z + 1] - s
    if (cnt === 0) continue
    const base = s * 26
    for (let j = 0; j < cnt; j++) {
      const i = cp[s + j]
      const r = rBase[i]
      const ib = iBase[i]
      let o = base + j
      for (let x = 0; x < 26; x++) {
        out[o] = rb[r + inner[ib + rf[r + x]]]
        o += cnt
      }
    }
  }
}

const T = new Int32Array(26)
const D = new Int32Array(26)

/** Σ count² of the scrambler outputs for the input plugboard P. */
export function sumSquares(layout: CipherLayout, tab: Uint8Array, P: Uint8Array): number {
  const cs = layout.classStart
  T.fill(0)
  for (let z = 0; z < 26; z++) {
    const s = cs[z]
    const cnt = cs[z + 1] - s
    const row = s * 26 + P[z] * cnt
    for (let j = 0; j < cnt; j++) T[tab[row + j]]++
  }
  let sum = 0
  for (let v = 0; v < 26; v++) sum += T[v] * T[v]
  return sum
}

export function iocFromSumSquares(sumSq: number, n: number): number {
  return n < 2 ? 0 : (sumSq - n) / (n * (n - 1))
}

/** Number of cables of a plugboard involution. */
export function countPlugs(P: ArrayLike<number>): number {
  let k = 0
  for (let a = 0; a < 26; a++) if (P[a] > a) k++
  return k
}

const NATURAL = Uint8Array.from({ length: 26 }, (_, i) => i)

/** Letters ordered by how often they occur in the ciphertext (most frequent first). */
export function lettersByFrequency(layout: CipherLayout): Uint8Array {
  const cs = layout.classStart
  return Uint8Array.from(NATURAL).sort((a, b) => cs[b + 1] - cs[b] - (cs[a + 1] - cs[a]) || a - b)
}

/**
 * First-improvement hill climb of the plugboard P (in place, an involution) maximising the
 * index of coincidence of the decrypt. Returns Σ count² of the final decrypt.
 * Only pairs among the first `limit` letters of `order` are tried (the frequent ciphertext
 * letters carry most of the signal); partners outside that set are still handled correctly.
 * With `exact`, cables are never removed (only added up to `maxPlugs` or rewired).
 */
export function climbIoc(
  layout: CipherLayout,
  tab: Uint8Array,
  P: Uint8Array,
  maxPlugs: number,
  maxPasses: number,
  order: Uint8Array = NATURAL,
  limit = 26,
  exact = false,
): number {
  const cs = layout.classStart
  let sumSq = sumSquares(layout, tab, P)
  let plugs = countPlugs(P)
  D.fill(0)

  const move = (z: number, from: number, to: number): void => {
    const s = cs[z]
    const cnt = cs[z + 1] - s
    if (cnt === 0) return
    const base = s * 26
    const o = base + from * cnt
    const w = base + to * cnt
    for (let j = 0; j < cnt; j++) {
      D[tab[o + j]]--
      D[tab[w + j]]++
    }
  }
  const moves = (a: number, b: number, x: number, y: number): void => {
    if (x === b) {
      move(a, b, a)
      move(b, a, b)
    } else {
      move(a, x, b)
      move(b, y, a)
      if (x !== a) move(x, a, y !== b ? y : x)
      if (y !== b) move(y, b, x !== a ? x : y)
    }
  }

  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false
    for (let i = 0; i < limit - 1; i++) {
      const a = order[i]
      for (let j = i + 1; j < limit; j++) {
        const b = order[j]
        const x = P[a]
        const y = P[b]
        if (x === a && y === b && plugs >= maxPlugs) continue
        if (exact && x === b) continue
        moves(a, b, x, y)
        let delta = 0
        for (let v = 0; v < 26; v++) {
          const d = D[v]
          if (d !== 0) {
            delta += d * (2 * T[v] + d)
            D[v] = 0
          }
        }
        if (delta > 0) {
          // Rare: replay the moves to apply them.
          moves(a, b, x, y)
          for (let v = 0; v < 26; v++) {
            T[v] += D[v]
            D[v] = 0
          }
          sumSq += delta
          if (x === b) {
            P[a] = a
            P[b] = b
            plugs--
          } else {
            if (x === a && y === b) plugs++
            if (x !== a) P[x] = y !== b ? y : x
            if (y !== b) P[y] = x !== a ? x : y
            P[a] = b
            P[b] = a
          }
          improved = true
        }
      }
    }
    if (!improved) break
  }
  return sumSq
}

/** Known plaintext at one or more candidate offsets (letter codes). */
export interface CribSpec {
  codes: Uint8Array
  /** Candidate offsets (already filtered for consistency with the ciphertext). */
  positions: Int32Array
}

/** Crib letters matched by `plain` at `position`. */
export function cribMatchesAt(crib: CribSpec, plain: ArrayLike<number>, position: number): number {
  const c = crib.codes
  let m = 0
  for (let j = 0; j < c.length; j++) if (plain[position + j] === c[j]) m++
  return m
}

/** Best crib offset for `plain` and its number of matching letters. */
export function bestCribPosition(crib: CribSpec, plain: ArrayLike<number>): { position: number; matches: number } {
  let best = -1
  let position = crib.positions.length > 0 ? crib.positions[0] : 0
  for (let k = 0; k < crib.positions.length; k++) {
    const m = cribMatchesAt(crib, plain, crib.positions[k])
    if (m > best) {
      best = m
      position = crib.positions[k]
    }
  }
  return { position, matches: Math.max(0, best) }
}

/** Full decrypt (plugboard on both sides) from a class-major scrambler table. */
export function decodeClassTable(
  layout: CipherLayout,
  tab: Uint8Array,
  P: ArrayLike<number>,
  out: Uint8Array,
): Uint8Array {
  const { n, codes, classStart, classRank } = layout
  for (let i = 0; i < n; i++) {
    const z = codes[i]
    const s = classStart[z]
    out[i] = P[tab[s * 26 + P[z] * (classStart[z + 1] - s) + classRank[i]]]
  }
  return out
}

/** Decrypt with plugboard P from a position-major scrambler table. */
export function decodeWith(
  codes: Uint8Array,
  tab: Uint8Array,
  P: ArrayLike<number>,
  out: Uint8Array,
): Uint8Array {
  const n = codes.length
  for (let i = 0; i < n; i++) out[i] = P[tab[i * 26 + P[codes[i]]]]
  return out
}

export interface NgramObjective {
  model: NgramModel
  order: 2 | 3 | 4
  crib: CribSpec | null
  /** Weight of one matching crib letter, in log10 units. */
  cribWeight: number
}

let scratch = new Uint8Array(0)

function decodeScratch(codes: Uint8Array, tab: Uint8Array, P: Uint8Array): Uint8Array {
  if (scratch.length < codes.length) scratch = new Uint8Array(codes.length)
  const out = scratch
  const n = codes.length
  for (let i = 0; i < n; i++) out[i] = P[tab[i * 26 + P[codes[i]]]]
  return out
}

function ngramSumOf(d: Uint8Array, n: number, model: NgramModel, order: 2 | 3 | 4): number {
  let sum = 0
  if (order === 4) {
    const t = model.quad
    if (n < 4) return 0
    let idx = (d[0] * 26 + d[1]) * 26 + d[2]
    for (let i = 3; i < n; i++) {
      idx = (idx % 17576) * 26 + d[i]
      sum += t[idx]
    }
  } else if (order === 3) {
    const t = model.tri
    if (n < 3) return 0
    let idx = d[0] * 26 + d[1]
    for (let i = 2; i < n; i++) {
      idx = (idx % 676) * 26 + d[i]
      sum += t[idx]
    }
  } else {
    const t = model.bi
    for (let i = 1; i < n; i++) sum += t[d[i - 1] * 26 + d[i]]
  }
  return sum
}

/**
 * Objective of a decrypt in log10 units (without the constant floor term): n-gram log-likelihood
 * plus cribWeight per matching crib letter at the fixed offset `cribPos`.
 */
function objective(
  d: Uint8Array,
  n: number,
  obj: NgramObjective,
  cribPos: number,
): number {
  let s = ngramSumOf(d, n, obj.model, obj.order) * obj.model.step[obj.order - 2]
  if (obj.crib && cribPos >= 0) s += obj.cribWeight * cribMatchesAt(obj.crib, d, cribPos)
  return s
}

/** Objective value of plugboard P (see climbNgram), choosing the best crib offset. */
export function ngramObjective(
  codes: Uint8Array,
  tab: Uint8Array,
  P: Uint8Array,
  obj: NgramObjective,
): number {
  const d = decodeScratch(codes, tab, P)
  const pos = obj.crib ? bestCribPosition(obj.crib, d).position : -1
  return objective(d, codes.length, obj, pos)
}

/**
 * First-improvement hill climb of the plugboard P (in place) on n-gram log-likelihood
 * (+ crib). The crib offset is chosen once at the start (best match under the initial P).
 * With `exact`, moves that lower the number of cables are skipped.
 * Returns the final objective value and the number of plugboards evaluated.
 */
export function climbNgram(
  codes: Uint8Array,
  tab: Uint8Array,
  P: Uint8Array,
  maxPlugs: number,
  obj: NgramObjective,
  maxPasses: number,
  exact = false,
): { value: number; trials: number } {
  const n = codes.length
  let d = decodeScratch(codes, tab, P)
  const cribPos = obj.crib ? bestCribPosition(obj.crib, d).position : -1
  let best = objective(d, n, obj, cribPos)
  let plugs = countPlugs(P)
  let trials = 0
  const saved = new Uint8Array(26)

  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false
    for (let a = 0; a < 25; a++) {
      for (let b = a + 1; b < 26; b++) {
        const x = P[a]
        const y = P[b]
        const both = x !== a && y !== b && x !== b
        const variants = both ? 2 : 1
        for (let v = 0; v < variants; v++) {
          if (exact && (x === b || v === 1)) break
          let newPlugs = plugs
          saved.set(P)
          if (x === b) {
            P[a] = a
            P[b] = b
            newPlugs--
          } else {
            if (x === a && y === b) {
              if (plugs >= maxPlugs) break
              newPlugs++
            }
            if (x !== a) P[x] = x
            if (y !== b) P[y] = y
            P[a] = b
            P[b] = a
            if (both) {
              if (v === 0) {
                P[x] = y
                P[y] = x
              } else {
                newPlugs--
              }
            }
          }
          trials++
          d = decodeScratch(codes, tab, P)
          const value = objective(d, n, obj, cribPos)
          if (value > best) {
            best = value
            plugs = newPlugs
            improved = true
            break
          }
          P.set(saved)
        }
      }
    }
    if (!improved) break
  }
  return { value: best, trials }
}

/**
 * Adds cables greedily until P has exactly `count` of them: each time the free pair that gives
 * the best objective. Used in exact-cable mode before the rewiring climbs.
 * Returns the number of plugboards evaluated.
 */
export function fillPlugs(
  codes: Uint8Array,
  tab: Uint8Array,
  P: Uint8Array,
  count: number,
  obj: NgramObjective,
): number {
  const n = codes.length
  let trials = 0
  let plugs = countPlugs(P)
  const cribPos = obj.crib ? bestCribPosition(obj.crib, decodeScratch(codes, tab, P)).position : -1
  while (plugs < count) {
    let bestValue = -Infinity
    let bestA = -1
    let bestB = -1
    for (let a = 0; a < 25; a++) {
      if (P[a] !== a) continue
      for (let b = a + 1; b < 26; b++) {
        if (P[b] !== b) continue
        P[a] = b
        P[b] = a
        trials++
        const value = objective(decodeScratch(codes, tab, P), n, obj, cribPos)
        P[a] = a
        P[b] = b
        if (value > bestValue) {
          bestValue = value
          bestA = a
          bestB = b
        }
      }
    }
    if (bestA < 0) break
    P[bestA] = bestB
    P[bestB] = bestA
    plugs++
  }
  return trials
}
