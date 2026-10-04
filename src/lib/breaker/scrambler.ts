/**
 * Fast numeric model of the Enigma scrambler (everything between the two plugboard passes)
 * for the codebreaker's hot loops. Agrees letter-for-letter with `encryptText` from the
 * simulator engine (see scrambler.test.ts).
 *
 * Normalisation: the left rotor's ring setting only shifts its wiring (its notch never
 * matters), so it is folded into the left start position and kept at ring A; the same holds
 * for the Greek wheel. The middle ring only matters through the left rotor's turnover, the
 * right ring through the middle rotor's turnover.
 */
import { REFLECTORS, ROTORS } from '../enigma/constants'
import type {
  AnyRotorId,
  GreekRotorId,
  MachineSettings,
  PlugPair,
  ReflectorId,
  RotorId,
} from '../enigma/types'

export interface RotorTables {
  /** fwd[o * 26 + x]: contact leaving the rotor (towards the reflector) at offset o (= position − ring). */
  fwd: Uint8Array
  /** bwd[o * 26 + x]: return path (inverse of fwd at the same offset). */
  bwd: Uint8Array
  /** notch[p] === 1 when window letter p is a turnover position. */
  notch: Uint8Array
}

function buildRotorTables(wiring: string, notches: string): RotorTables {
  const w = new Uint8Array(26)
  const inv = new Uint8Array(26)
  for (let i = 0; i < 26; i++) {
    w[i] = wiring.charCodeAt(i) - 65
    inv[w[i]] = i
  }
  const fwd = new Uint8Array(676)
  const bwd = new Uint8Array(676)
  for (let o = 0; o < 26; o++) {
    for (let x = 0; x < 26; x++) {
      fwd[o * 26 + x] = (w[(x + o) % 26] - o + 26) % 26
      bwd[o * 26 + x] = (inv[(x + o) % 26] - o + 26) % 26
    }
  }
  const notch = new Uint8Array(26)
  for (const ch of notches) notch[ch.charCodeAt(0) - 65] = 1
  return { fwd, bwd, notch }
}

const ROTOR_TABLES = new Map<AnyRotorId, RotorTables>()
for (const id of Object.keys(ROTORS) as AnyRotorId[]) {
  ROTOR_TABLES.set(id, buildRotorTables(ROTORS[id].wiring, ROTORS[id].notches))
}

export function rotorTables(id: AnyRotorId): RotorTables {
  const t = ROTOR_TABLES.get(id)
  if (!t) throw new Error(`Unknown rotor "${String(id)}"`)
  return t
}

export function reflectorTable(id: ReflectorId): Uint8Array {
  const spec = REFLECTORS[id]
  if (!spec) throw new Error(`Unknown reflector "${String(id)}"`)
  return Uint8Array.from(spec.wiring, (ch) => ch.charCodeAt(0) - 65)
}

/** The rotor part of a key in normalised form (left and Greek rings folded into the positions). */
export interface RotorKey {
  reflector: ReflectorId
  greek: GreekRotorId | null
  /** Greek wheel position with ring A (0 when there is no Greek wheel). */
  greekPos: number
  left: RotorId
  middle: RotorId
  right: RotorId
  ringM: number
  ringR: number
  /** START positions (the left one with ring A). */
  posL: number
  posM: number
  posR: number
}

const mod = (n: number): number => ((n % 26) + 26) % 26

/** Normalised rotor key of full machine settings (plugboard ignored). */
export function keyFromSettings(s: MachineSettings): RotorKey {
  return {
    reflector: s.reflector,
    greek: s.greek ? (s.greek.rotor as GreekRotorId) : null,
    greekPos: s.greek ? mod(s.greek.position - s.greek.ring) : 0,
    left: s.left.rotor as RotorId,
    middle: s.middle.rotor as RotorId,
    right: s.right.rotor as RotorId,
    ringM: mod(s.middle.ring),
    ringR: mod(s.right.ring),
    posL: mod(s.left.position - s.left.ring),
    posM: mod(s.middle.position),
    posR: mod(s.right.position),
  }
}

/** Plugboard pairs of a 26-letter involution. */
export function plugPairs(plugs: ArrayLike<number>): PlugPair[] {
  const pairs: PlugPair[] = []
  for (let a = 0; a < 26; a++) if (plugs[a] > a) pairs.push([a, plugs[a]])
  return pairs
}

/** 26-letter involution of plugboard pairs. */
export function plugMap(pairs: readonly PlugPair[]): Uint8Array {
  const map = new Uint8Array(26)
  for (let i = 0; i < 26; i++) map[i] = i
  for (const [a, b] of pairs) {
    map[a] = b
    map[b] = a
  }
  return map
}

export function settingsFromKey(
  model: MachineSettings['model'],
  key: RotorKey,
  plugs: ArrayLike<number>,
): MachineSettings {
  return {
    model,
    reflector: key.reflector,
    greek: key.greek ? { rotor: key.greek, ring: 0, position: key.greekPos } : null,
    left: { rotor: key.left, ring: 0, position: key.posL },
    middle: { rotor: key.middle, ring: key.ringM, position: key.posM },
    right: { rotor: key.right, ring: key.ringR, position: key.posR },
    plugboard: plugPairs(plugs),
  }
}

/** Settings with the left (and Greek) ring folded into the position: deciphers identically. */
export function normalizeSettings(s: MachineSettings): MachineSettings {
  return settingsFromKey(s.model, keyFromSettings(s), plugMap(s.plugboard))
}

/** Reflector as seen from the left rotor: thin reflector + Greek wheel at its offset on the M4. */
export function effectiveReflector(
  reflector: ReflectorId,
  greek: GreekRotorId | null,
  greekPos: number,
): Uint8Array {
  const u = reflectorTable(reflector)
  if (!greek) return u
  const g = rotorTables(greek)
  const o = mod(greekPos) * 26
  const out = new Uint8Array(26)
  for (let x = 0; x < 26; x++) out[x] = g.bwd[o + u[g.fwd[o + x]]]
  return out
}

/**
 * inner[(oL * 26 + oM) * 26 + x]: middle → left → reflector → left → middle for every pair of
 * left / middle offsets (the part of the scrambler that changes only on middle-rotor steps).
 */
export function buildInner(ueff: Uint8Array, left: AnyRotorId, middle: AnyRotorId): Uint8Array {
  const L = rotorTables(left)
  const M = rotorTables(middle)
  const out = new Uint8Array(676 * 26)
  for (let oL = 0; oL < 26; oL++) {
    const lb = oL * 26
    for (let oM = 0; oM < 26; oM++) {
      const mb = oM * 26
      const base = (oL * 26 + oM) * 26
      for (let x = 0; x < 26; x++) {
        out[base + x] = M.bwd[mb + L.bwd[lb + ueff[L.fwd[lb + M.fwd[mb + x]]]]]
      }
    }
  }
  return out
}

/**
 * Per-letter offsets of a key for n key presses (the rotors step before each letter):
 * rBase[i] = 26 × right offset, iBase[i] = 26 × (26 × left offset + middle offset).
 */
export function fillSchedule(
  key: RotorKey,
  n: number,
  rBase: Int32Array,
  iBase: Int32Array,
): void {
  const notchM = rotorTables(key.middle).notch
  const notchR = rotorTables(key.right).notch
  fillScheduleRaw(notchM, notchR, key.posL, key.posM, key.posR, key.ringM, key.ringR, n, rBase, iBase)
}

export function fillScheduleRaw(
  notchM: Uint8Array,
  notchR: Uint8Array,
  posL: number,
  posM: number,
  posR: number,
  ringM: number,
  ringR: number,
  n: number,
  rBase: Int32Array,
  iBase: Int32Array,
): void {
  let pL = posL
  let pM = posM
  let pR = posR
  for (let i = 0; i < n; i++) {
    if (notchM[pM] === 1) {
      pL = pL === 25 ? 0 : pL + 1
      pM = pM === 25 ? 0 : pM + 1
    } else if (notchR[pR] === 1) {
      pM = pM === 25 ? 0 : pM + 1
    }
    pR = pR === 25 ? 0 : pR + 1
    let oR = pR - ringR
    if (oR < 0) oR += 26
    let oM = pM - ringM
    if (oM < 0) oM += 26
    rBase[i] = oR * 26
    iBase[i] = (pL * 26 + oM) * 26
  }
}

/** A compiled key: tables needed to evaluate the scrambler at every message position. */
export interface CompiledKey {
  key: RotorKey
  inner: Uint8Array
  rf: Uint8Array
  rb: Uint8Array
  rBase: Int32Array
  iBase: Int32Array
  n: number
}

export function compileKey(key: RotorKey, n: number, inner?: Uint8Array): CompiledKey {
  const R = rotorTables(key.right)
  const rBase = new Int32Array(n)
  const iBase = new Int32Array(n)
  fillSchedule(key, n, rBase, iBase)
  return {
    key,
    inner: inner ?? buildInner(effectiveReflector(key.reflector, key.greek, key.greekPos), key.left, key.middle),
    rf: R.fwd,
    rb: R.bwd,
    rBase,
    iBase,
    n,
  }
}

/** Position-major scrambler table: out[i * 26 + x] = scrambler output at position i for input x. */
export function buildTable(c: CompiledKey, out: Uint8Array = new Uint8Array(c.n * 26)): Uint8Array {
  const { inner, rf, rb, rBase, iBase, n } = c
  for (let i = 0; i < n; i++) {
    const r = rBase[i]
    const ib = iBase[i]
    const o = i * 26
    for (let x = 0; x < 26; x++) out[o + x] = rb[r + inner[ib + rf[r + x]]]
  }
  return out
}

/** Deciphers letter codes with a rotor key and plugboard involution (letters only). */
export function decipherCodes(
  key: RotorKey,
  plugs: ArrayLike<number>,
  cipher: Uint8Array,
): Uint8Array {
  const c = compileKey(key, cipher.length)
  const out = new Uint8Array(cipher.length)
  for (let i = 0; i < cipher.length; i++) {
    const r = c.rBase[i]
    out[i] = plugs[c.rb[r + c.inner[c.iBase[i] + c.rf[r + plugs[cipher[i]]]]]]
  }
  return out
}

/**
 * Signature of everything that determines the scrambler at each of the n positions: two keys
 * with equal signatures decipher identically under any plugboard.
 */
export function scheduleSignature(c: CompiledKey): string {
  let h = 0x811c9dc5
  for (let i = 0; i < c.n; i++) {
    h = Math.imul(h ^ c.rBase[i], 0x01000193)
    h = Math.imul(h ^ c.iBase[i], 0x01000193)
  }
  const k = c.key
  return `${k.reflector}/${k.greek ?? '-'}${k.greekPos}/${k.left}-${k.middle}-${k.right}/${(h >>> 0).toString(36)}`
}
