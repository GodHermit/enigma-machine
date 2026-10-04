import type { BreakerConfig } from '../../lib/breaker/types'

/*
 * Size of the key space for the codebreaker's settings, and how much of it the
 * search actually visits. Exact counts use BigInt (they reach ~10^23).
 */

export interface KeyspaceFactor {
  id: 'orders' | 'reflectors' | 'greek' | 'positions' | 'rings' | 'plugboard'
  label: string
  /** How the number is made up, e.g. "5 × 4 × 3". */
  formula: string
  count: bigint
}

export interface SearchStage {
  id: 'rotors' | 'rings' | 'plugboard' | 'words'
  label: string
  /** Keys tried in this stage; null when it depends on how many candidates survive. */
  keys: bigint | null
  detail: string
}

export interface Keyspace {
  factors: KeyspaceFactor[]
  /** Every distinct key the selected options allow (product of the factors). */
  total: bigint
  /** Keys tried exhaustively in phase 1 (every rotor order × reflector × Greek × start position). */
  exhaustive: bigint
  stages: SearchStage[]
}

const POSITIONS = 26n ** 3n

function permutations(n: number, k: number): bigint {
  let out = 1n
  for (let i = 0; i < k; i++) out *= BigInt(Math.max(0, n - i))
  return out
}

/** Ways to wire exactly `cables` plugboard cables: 26! / ((26 − 2c)! · c! · 2^c). */
export function plugboardWirings(cables: number): bigint {
  let ways = 1n
  for (let i = 0; i < 2 * cables; i++) ways *= BigInt(26 - i)
  let divisor = 1n
  for (let i = 2; i <= cables; i++) divisor *= BigInt(i)
  return ways / (divisor * 2n ** BigInt(cables))
}

/** Wirings with 0 … `maxCables` cables (the search allows any number up to the maximum). */
export function plugboardWiringsUpTo(maxCables: number): bigint {
  let total = 0n
  for (let c = 0; c <= maxCables; c++) total += plugboardWirings(c)
  return total
}

export function computeKeyspace(
  config: Pick<
    BreakerConfig,
    'model' | 'rotors' | 'reflectors' | 'greekRotors' | 'ringSearch' | 'maxPlugs' | 'exactPlugs' | 'typoTolerance'
  >,
): Keyspace {
  const n = config.rotors.length
  const orders = permutations(n, 3)
  const reflectors = BigInt(config.reflectors.length)
  const isM4 = config.model === 'M4'
  const greekWheels = isM4 ? BigInt(config.greekRotors.length) : 1n
  const greek = greekWheels * (isM4 ? 26n : 1n)
  // The left ring only shifts the left rotor's letters (its notch never matters), so it merges
  // with the start position; the right and middle rings change when rotors turn over.
  const rings = 26n ** 2n
  const exact = config.exactPlugs === true
  const plugs = exact ? plugboardWirings(config.maxPlugs) : plugboardWiringsUpTo(config.maxPlugs)

  const factors: KeyspaceFactor[] = [
    {
      id: 'orders',
      label: 'Rotor orders',
      formula: n >= 3 ? `${n} × ${n - 1} × ${n - 2}` : `${n} rotors (need 3)`,
      count: orders,
    },
    {
      id: 'reflectors',
      label: 'Reflectors',
      formula: config.reflectors.length ? config.reflectors.join(', ') : 'none selected',
      count: reflectors,
    },
  ]
  if (isM4) {
    factors.push({
      id: 'greek',
      label: 'Greek wheel & position',
      formula: `${config.greekRotors.length} × 26`,
      count: greek,
    })
  }
  factors.push(
    { id: 'positions', label: 'Start positions', formula: '26 × 26 × 26', count: POSITIONS },
    { id: 'rings', label: 'Ring settings', formula: '26 × 26 (left ring has no effect)', count: rings },
    {
      id: 'plugboard',
      label: 'Plugboard wirings',
      formula:
        config.maxPlugs === 0
          ? 'no cables'
          : exact
            ? `exactly ${config.maxPlugs} ${config.maxPlugs === 1 ? 'cable' : 'cables'}`
            : `0 to ${config.maxPlugs} cables`,
      count: plugs,
    },
  )

  const total = factors.reduce((acc, f) => acc * f.count, 1n)
  const exhaustive = orders * reflectors * greek * POSITIONS
  const ringTrials =
    config.ringSearch === 'right-middle' || config.ringSearch === 'all' ? 676 : config.ringSearch === 'right' ? 26 : 1
  // 'all' repeats phase 1 through each left ring: 26× the work, the same distinct keys.
  const allRings = config.ringSearch === 'all'

  const stages: SearchStage[] = [
    {
      id: 'rotors',
      label: 'Rotor order & positions',
      keys: allRings ? exhaustive * 26n : exhaustive,
      detail: allRings
        ? 'every combination through each of the 26 left rings (the same keys 26 times), no plugboard'
        : 'every combination, rings at AAA, no plugboard',
    },
    {
      id: 'rings',
      label: 'Ring settings',
      keys: null,
      detail:
        ringTrials === 1
          ? 'skipped (rings assumed AAA)'
          : `${ringTrials} ring settings for each of the best candidates`,
    },
    {
      id: 'plugboard',
      label: 'Plugboard',
      keys: null,
      detail:
        config.maxPlugs === 0
          ? 'skipped (no cables)'
          : exact
            ? `hill-climbing to exactly ${config.maxPlugs} cables, then only rewiring, instead of trying every wiring`
            : 'hill-climbing tries a few thousand wirings per candidate instead of all of them',
    },
    {
      id: 'words',
      label: 'Dictionary check',
      keys: null,
      detail: `the best 20 keys are checked for real words${
        (config.typoTolerance ?? 0.2) > 0 ? ` (up to ${Math.round((config.typoTolerance ?? 0.2) * 100)}% typos per word)` : ''
      } and re-ranked`,
    },
  ]

  return { factors, total, exhaustive, stages }
}

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
}

/** "17,576" up to a trillion, then "1.07 × 10²³". */
export function formatBig(value: bigint): string {
  if (value < 1_000_000_000_000n) return value.toLocaleString('en-US')
  const digits = value.toString()
  const exponent = digits.length - 1
  const mantissa = `${digits[0]}.${digits.slice(1, 3)}`
  const sup = String(exponent).replace(/./g, (d) => SUPERSCRIPT[d] ?? d)
  return `${mantissa} × 10${sup}`
}

/** Approximate base-10 exponent of a / b (for "about 1 in 10^N"). */
export function orderOfMagnitudeRatio(a: bigint, b: bigint): number {
  if (a <= 0n || b <= 0n) return 0
  return a.toString().length - b.toString().length
}
