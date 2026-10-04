import { MODELS } from '../enigma/constants'
import type { ModelId } from '../enigma/types'
import { DEFAULT_TUNING, cribPositions, rotorUnits, unitKeys } from './search'
import type { SearchTuning } from './search'
import { lettersOnly, toCodes } from './text'
import { DEFAULT_TYPO_TOLERANCE, MAX_TYPO_TOLERANCE } from './words'
import type { BreakerConfig, RingSearch, WorkEstimate } from './types'

/**
 * Phase-1 throughput of one CPU worker (start positions per second, ring search 'right-middle',
 * ~260 letters), measured in Chrome with 11 workers on an Apple M3 Pro (6 performance + 6
 * efficiency cores): 60 rotor orders in ≈ 135 s. A lone performance core in node does ≈ 1,100.
 */
export const KEYS_PER_SECOND_PER_WORKER = 700

/** Phase-2 seconds per survivor and phase-3 seconds per finalist (same machine, ~300 letters). */
const RING_SECONDS_PER_SURVIVOR = 0.0035
const PLUG_SECONDS_PER_FINALIST = 0.02
/** Phase-4 seconds per checked candidate (dictionary check, polish included on average). */
const WORDS_SECONDS_PER_CANDIDATE = 0.02

/** Relative phase-1 cost of the ring-search options. */
const RING_SEARCH_COST: Record<RingSearch, number> = { none: 0.3, right: 0.6, 'right-middle': 1 }

/** Message length the throughput figures refer to; the cost grows about linearly with it. */
const REFERENCE_LETTERS = 300
/** Below ~100 letters the per-key overheads dominate. */
const MIN_COST_LETTERS = 100

function hardwareThreads(): number {
  const n = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : 4
}

/** Defaults for a model: all its rotors, reflector B (thin B on the M4), both Greek wheels, 10 plugs, typo tolerance 0.2. */
export function defaultBreakerConfig(model: ModelId = 'I'): BreakerConfig {
  const spec = MODELS[model]
  return {
    ciphertext: '',
    model,
    rotors: [...spec.rotorIds],
    reflectors: [model === 'M4' ? 'UKW-B-thin' : 'UKW-B'],
    greekRotors: [...spec.greekIds],
    ringSearch: 'right-middle',
    maxPlugs: 10,
    exactPlugs: false,
    backend: 'auto',
    cpuEngine: 'wasm',
    language: 'de',
    crib: null,
    workers: Math.max(1, hardwareThreads() - 1),
    typoTolerance: DEFAULT_TYPO_TOLERANCE,
  }
}

/** Seconds per phase on `config.workers` workers (rough). */
export function estimatePhaseSeconds(
  config: BreakerConfig,
  tuning: SearchTuning = DEFAULT_TUNING,
  keysPerSecondPerWorker: number = KEYS_PER_SECOND_PER_WORKER,
): { rotors: number; rings: number; plugboard: number; words: number; keys: number; orders: number } {
  const units = rotorUnits(config)
  const keys = units.reduce((sum, u) => sum + unitKeys(u), 0)
  const letters = lettersOnly(config.ciphertext ?? '').length || REFERENCE_LETTERS
  const scale = Math.max(MIN_COST_LETTERS, letters) / REFERENCE_LETTERS
  const workers = Math.max(1, Math.floor(config.workers) || 1)
  const kps = keysPerSecondPerWorker > 0 ? keysPerSecondPerWorker : KEYS_PER_SECOND_PER_WORKER
  const ringCost = RING_SEARCH_COST[config.ringSearch] ?? 1
  const survivors = Math.min(tuning.survivors, keys)
  return {
    rotors: units.length === 0 ? 0 : (keys * scale * ringCost) / kps / Math.min(workers, units.length),
    rings: (survivors * RING_SECONDS_PER_SURVIVOR * scale) / workers,
    plugboard: (Math.min(tuning.finalists, survivors * tuning.ringKeep) * PLUG_SECONDS_PER_FINALIST * scale) / workers,
    words: (Math.min(tuning.wordCandidates, survivors) * WORDS_SECONDS_PER_CANDIDATE * scale) / workers,
    keys,
    orders: units.length,
  }
}

/** Size of the search and a rough wall-clock estimate for `config.workers` workers. */
export function estimateWork(config: BreakerConfig, keysPerSecondPerWorker?: number): WorkEstimate {
  const e = estimatePhaseSeconds(config, DEFAULT_TUNING, keysPerSecondPerWorker)
  return { orders: e.orders, keys: e.keys, seconds: e.rotors + e.rings + e.plugboard + e.words }
}

/** First problem that prevents a search, or null when the config can be run. */
export function validateBreakerConfig(config: BreakerConfig): string | null {
  const spec = MODELS[config.model]
  if (!spec) return `Unknown Enigma model "${String(config.model)}".`
  const letters = toCodes(config.ciphertext ?? '')
  if (letters.length < 10) return 'Enter at least 10 letters of ciphertext.'
  if (config.language !== 'de' && config.language !== 'en') return `Unknown language "${String(config.language)}".`
  if (!['none', 'right', 'right-middle'].includes(config.ringSearch)) return `Unknown ring search "${String(config.ringSearch)}".`
  if (!Number.isFinite(config.maxPlugs) || config.maxPlugs < 0 || config.maxPlugs > 13) {
    return 'The number of plugs must be between 0 and 13.'
  }
  if (config.exactPlugs !== undefined && typeof config.exactPlugs !== 'boolean') {
    return 'exactPlugs must be true or false.'
  }
  if (config.backend !== undefined && config.backend !== 'auto' && config.backend !== 'cpu') {
    return 'backend must be "auto" or "cpu".'
  }
  if (config.cpuEngine !== undefined && config.cpuEngine !== 'wasm' && config.cpuEngine !== 'js') {
    return 'cpuEngine must be "wasm" or "js".'
  }
  const tol = config.typoTolerance
  if (tol !== undefined && (typeof tol !== 'number' || !Number.isFinite(tol) || tol < 0 || tol > MAX_TYPO_TOLERANCE)) {
    return `The typo tolerance must be between 0 and ${MAX_TYPO_TOLERANCE}.`
  }
  const rotors = new Set(config.rotors.filter((r) => spec.rotorIds.includes(r)))
  if (rotors.size < 3) return `Choose at least three rotors of the ${spec.name}.`
  if (!config.reflectors.some((r) => spec.reflectorIds.includes(r))) {
    return `Choose at least one reflector of the ${spec.name}.`
  }
  if (spec.hasGreek && !config.greekRotors.some((g) => spec.greekIds.includes(g))) {
    return 'Choose at least one Greek wheel.'
  }
  if (config.crib && lettersOnly(config.crib.text).length > 0) {
    const crib = toCodes(config.crib.text)
    if (crib.length > letters.length) return 'The crib is longer than the ciphertext.'
    const pos = config.crib.position
    if (pos !== null && (!Number.isInteger(pos) || pos < 0 || pos + crib.length > letters.length)) {
      return 'The crib position lies outside the ciphertext.'
    }
    if (cribPositions(letters, crib, pos).length === 0) {
      return pos === null
        ? 'The crib fits nowhere: at every offset some crib letter equals the ciphertext letter (Enigma never enciphers a letter to itself).'
        : 'The crib cannot sit at that position: a crib letter equals the ciphertext letter there (Enigma never enciphers a letter to itself).'
    }
  }
  return null
}
