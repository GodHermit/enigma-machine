/**
 * Contract for the Enigma codebreaker (ciphertext-only attack, optionally with a crib).
 *
 * Runtime API exported from `src/lib/breaker/index.ts`:
 *
 *   createBreaker(): Breaker
 *     Owns a pool of Web Workers (one per `config.workers`), runs the phased
 *     search below off the main thread and publishes snapshots.
 *
 *   defaultBreakerConfig(model?: ModelId): BreakerConfig
 *   estimateWork(config: BreakerConfig, keysPerSecondPerWorker?: number): WorkEstimate
 *   sampleChallenge(options: SampleOptions): SampleChallenge
 *     Picks a real plaintext passage (German or English), a random key and
 *     enciphers it — the "Try an example" button.
 *   describeKey(settings: MachineSettings): string
 *     "Enigma I · UKW-B · II IV I · rings 01 14 22 · start ADU · 10 plugs".
 *   lettersOnly(text: string): string   // A–Z only, uppercased
 *
 * Search phases (Gillogly 1995 / Weierud & Sullivan 2005 style):
 *   1. 'rotors'    — every reflector × [Greek wheel × Greek position] × rotor order ×
 *                    26³ start positions, rings AAA, no plugboard; rank by index of
 *                    coincidence (IoC) of the decrypt; keep the best few thousand.
 *   2. 'rings'     — for the survivors, search the right (and middle) ring setting,
 *                    shifting the start position to compensate; rank by IoC.
 *   3. 'plugboard' — hill-climb plugboard pairs on the best survivors (IoC first, then
 *                    n-gram log-likelihood for the chosen language), with restarts.
 *   4. 'words'     — dictionary check of the final candidates: segment the plaintext into
 *                    words (typo-tolerant, X as separator), re-rank by n-grams + coverage and
 *                    polish near-misses (a wrong plug pair shows up as broken words).
 *
 * Also exported: loadDictionary(language): Promise<WordDictionary> (lazy, cached) and the pure
 * scoreWords(plaintext, dictionary, typoTolerance?): WordsResult used by phase 4.
 * A crib (known plaintext), when given, is used to prune and to score.
 */

import type { GreekRotorId, MachineSettings, ModelId, ReflectorId, RotorId } from '../enigma/types'

export type BreakerLanguage = 'de' | 'en'

export type RingSearch = 'none' | 'right' | 'right-middle'

export interface BreakerCrib {
  /** Known plaintext, letters only (e.g. "WETTERBERICHT"). */
  text: string
  /** Letter offset of the crib in the message, or null to try every consistent position. */
  position: number | null
}

export interface BreakerConfig {
  /** Raw ciphertext; only A–Z letters are used (case-insensitive). */
  ciphertext: string
  model: ModelId
  /** Rotors that may be in the left / middle / right slots (subset of the model's rotors). */
  rotors: RotorId[]
  /** Candidate reflectors (subset of the model's reflectors). */
  reflectors: ReflectorId[]
  /** M4 only: candidate Greek wheels. Ignored for other models. */
  greekRotors: GreekRotorId[]
  ringSearch: RingSearch
  /** Maximum number of plugboard cables to look for (0–13). Historically 10. */
  maxPlugs: number
  /**
   * When true the key has EXACTLY `maxPlugs` cables: the climbers never remove a cable, fill up
   * to the count and then only rewire. Default false (any number from 0 to `maxPlugs`).
   */
  exactPlugs?: boolean
  language: BreakerLanguage
  crib: BreakerCrib | null
  /** Web Workers to use (1 … hardwareConcurrency). */
  workers: number
  /**
   * 'auto' (default): run phase 1 on the GPU (WebGPU) as well when available — results are
   * bit-identical to the CPU, only faster. 'cpu': CPU workers only.
   */
  backend?: 'auto' | 'cpu'
  /**
   * Phase-1 engine of the CPU workers: 'wasm' (default) runs the hot loops as WebAssembly with
   * SIMD when the browser supports it, else JavaScript; 'js' always uses the JavaScript reference
   * implementation. Results are bit-identical either way.
   */
  cpuEngine?: 'wasm' | 'js'
  /**
   * Phase 4: allowed edits per letter when matching dictionary words (0–0.34, default 0.2:
   * one edit in words of 5–9 letters, two from 10 letters; words under 4 letters must match
   * exactly).
   */
  typoTolerance?: number
}

/** Dictionary check of a candidate's plaintext (phase 4). */
export interface BreakerWords {
  /** Share (0..1) of the letters covered by dictionary words (typo-tolerant). */
  coverage: number
  /** Readable text: matched words separated by spaces, unmatched runs kept as they are. */
  segmented: string
  /** Words matched. */
  matched: number
  /** Total edits (typos) in the fuzzy matches. */
  typos: number
}

export type BreakerPhase =
  | 'idle'
  | 'loading'
  | 'rotors'
  | 'rings'
  | 'plugboard'
  | 'words'
  | 'done'
  | 'cancelled'
  | 'error'

export interface BreakerCandidate {
  /** Stable id (e.g. encodeSettings of the key). */
  id: string
  /** Full recovered key: model, reflector, rotors, rings, START positions, plugboard. */
  settings: MachineSettings
  /**
   * Final ranking score (higher is better): IoC in phases 1–2, average log10 quadgram
   * probability (+ crib bonus) after phase 3, plus WORDS_WEIGHT × exact dictionary coverage
   * after phase 4.
   */
  score: number
  /** Index of coincidence of `plaintext` (English text ≈ 0.066, German ≈ 0.076, random ≈ 0.0385). */
  ioc: number
  /** Decrypt of the ciphertext letters with this key (letters only). */
  plaintext: string
  /** Phase that last improved this candidate. */
  phase: BreakerPhase
  /** Dictionary check (set once phase 4 ran). */
  words?: BreakerWords
}

export interface BreakerProgress {
  phase: BreakerPhase
  /** 1-based index of the running search phase (1–4), 0 before start. */
  phaseIndex: number
  phaseCount: number
  /** Work units done / total in the current phase (for the progress bar). */
  done: number
  total: number
  /** Keys (machine configurations) evaluated so far, all phases. */
  keysTested: number
  keysPerSecond: number
  elapsedMs: number
  /** Rough time left for the whole search; null when unknown. */
  etaMs: number | null
  workers: number
  /** Name of the GPU running phase 1 alongside the CPU workers, or null (CPU only). */
  gpu?: string | null
  /** Phase-1 rotor units finished by the GPU and by the CPU workers (each unit counted once). */
  unitsByGpu?: number
  unitsByCpu?: number
  /** Engine the CPU workers run phase 1 with: WebAssembly SIMD or JavaScript. */
  cpuEngine?: 'wasm' | 'js'
  /** Human-readable status line, e.g. "Testing rotor order II IV I (12 of 60)". */
  message: string
}

export interface BreakerSnapshot {
  progress: BreakerProgress
  /** Best candidates so far, best first (at most 20). */
  candidates: BreakerCandidate[]
  /** Error message when phase === 'error'. */
  error: string | null
  /** The config of the current / last run, or null before the first start. */
  config: BreakerConfig | null
}

export interface Breaker {
  /** Starts a new search (cancelling any running one). */
  start(config: BreakerConfig): void
  cancel(): void
  getSnapshot(): BreakerSnapshot
  /** useSyncExternalStore-compatible subscription; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
  /** Terminates the workers. */
  dispose(): void
}

export interface WorkEstimate {
  /** Rotor-order × reflector × [Greek] combinations searched in phase 1. */
  orders: number
  /** Keys evaluated in phase 1 (orders × 26³ × Greek positions). */
  keys: number
  /** Rough wall-clock estimate in seconds for the whole search. */
  seconds: number
}

export interface SampleOptions {
  model: ModelId
  language: BreakerLanguage
  /** Number of letters (default ~300). */
  length?: number
  /** Plugboard cables (default 10). */
  plugs?: number
  /** PRNG seed for reproducible samples. */
  seed?: number
  /**
   * Search space the key must lie in (so the example is solvable with that config):
   * rotors, reflectors and Greek wheels to draw from. Defaults to defaultBreakerConfig(model).
   */
  rotors?: RotorId[]
  reflectors?: ReflectorId[]
  greekRotors?: GreekRotorId[]
}

export interface SampleChallenge {
  ciphertext: string
  plaintext: string
  settings: MachineSettings
  /** Where the passage comes from, e.g. "Goethe, Die Leiden des jungen Werthers". */
  source: string
}
