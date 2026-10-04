/**
 * Orchestration shared by the Web Worker pool and the synchronous pipeline (tests, benchmark):
 * merging phase results, choosing what goes into the next phase and turning internal
 * candidates into the public BreakerCandidate shape.
 */
import { encodeSettings } from '../enigma/settings'
import type { NgramModel } from './ngrams'
import {
  createContext,
  rotorUnits,
  runPlugboardSearch,
  runRingSearch,
  runRotorUnit,
  runWordsSearch,
} from './search'
import type { CoreCandidate, SearchTuning } from './search'
import { decipherCodes, settingsFromKey } from './scrambler'
import { fromCodes, indexOfCoincidence, toCodes } from './text'
import type { BreakerCandidate, BreakerConfig } from './types'
import type { WordDictionary } from './words'

/** Candidates shown in snapshots. */
export const MAX_SHOWN = 20

/** Equivalence class of a rotor key (same key ⇒ same id regardless of the plugboard). */
export function rotorKeyId(c: CoreCandidate): string {
  const k = c.key
  return `${k.reflector}.${k.greek ?? '-'}${k.greekPos}.${k.left}-${k.middle}-${k.right}.${k.ringM}.${k.ringR}.${k.posL}.${k.posM}.${k.posR}`
}

/** Best `limit` candidates (by score) of `current` ∪ `incoming`, one per rotor key. */
export function mergeTop(current: CoreCandidate[], incoming: CoreCandidate[], limit: number): CoreCandidate[] {
  const byKey = new Map<string, CoreCandidate>()
  for (const c of current) byKey.set(rotorKeyId(c), c)
  for (const c of incoming) {
    const id = rotorKeyId(c)
    const prev = byKey.get(id)
    if (!prev || c.score > prev.score) byKey.set(id, c)
  }
  return [...byKey.values()].sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Final ranking: best first, one entry per distinct plaintext. */
export function rankFinal(results: CoreCandidate[]): CoreCandidate[] {
  const byText = new Map<string, CoreCandidate>()
  for (const c of results) {
    const text = c.plaintext ?? rotorKeyId(c)
    const prev = byText.get(text)
    if (!prev || c.score > prev.score) byText.set(text, c)
  }
  return [...byText.values()].sort((a, b) => b.score - a.score)
}

/** Public shape of an internal candidate (deciphers the message when phase 3 did not). */
export function toBreakerCandidate(
  model: BreakerConfig['model'],
  c: CoreCandidate,
  cipher: Uint8Array,
): BreakerCandidate {
  const settings = settingsFromKey(model, c.key, c.plugs)
  const plaintext = c.plaintext ?? fromCodes(decipherCodes(c.key, c.plugs, cipher))
  return {
    id: encodeSettings(settings),
    settings,
    score: c.score,
    ioc: c.plaintext ? c.ioc : indexOfCoincidence(plaintext),
    plaintext,
    phase: c.phase,
    ...(c.words ? { words: { ...c.words } } : {}),
  }
}

export interface SyncProgress {
  phase: 'rotors' | 'rings' | 'plugboard' | 'words'
  done: number
  total: number
  keys: number
}

export interface SyncResult {
  /** Final candidates, best first. */
  candidates: CoreCandidate[]
  keysTested: number
  /** Phase-3 ranking (before the dictionary check), best first. */
  beforeWords: CoreCandidate[]
  /** Wall-clock milliseconds per phase. */
  timings: { rotors: number; rings: number; plugboard: number; words: number }
  /** Survivors of phase 1 and phase 2 (for diagnostics). */
  survivors: CoreCandidate[]
  finalists: CoreCandidate[]
}

/**
 * Runs the whole search synchronously in the calling thread (tests, benchmarks); phase 4 runs
 * when a dictionary is given. The worker
 * pool in index.ts runs exactly the same phase functions, only spread over threads.
 */
export function runSearchSync(
  config: BreakerConfig,
  ngrams: NgramModel,
  tuning: Partial<SearchTuning> = {},
  onProgress?: (p: SyncProgress) => void,
  dictionary: WordDictionary | null = null,
): SyncResult {
  const ctx = createContext(config, ngrams, tuning, dictionary)
  const t = ctx.tuning
  let keysTested = 0

  const t0 = performance.now()
  const units = rotorUnits(config)
  let survivors: CoreCandidate[] = []
  units.forEach((unit, i) => {
    const threshold = survivors.length >= t.survivors ? survivors[survivors.length - 1].score : -Infinity
    const r = runRotorUnit(ctx, unit, { keep: t.survivors, threshold })
    keysTested += r.keys
    survivors = mergeTop(survivors, r.survivors, t.survivors)
    onProgress?.({ phase: 'rotors', done: i + 1, total: units.length, keys: keysTested })
  })

  const t1 = performance.now()
  let ringed: CoreCandidate[] = []
  survivors.forEach((s, i) => {
    const r = runRingSearch(ctx, s)
    keysTested += r.keys
    ringed = mergeTop(ringed, r.results, t.finalists)
    if (i % 50 === 49 || i === survivors.length - 1) onProgress?.({ phase: 'rings', done: i + 1, total: survivors.length, keys: keysTested })
  })

  const t2 = performance.now()
  const results: CoreCandidate[] = []
  ringed.forEach((c, i) => {
    const r = runPlugboardSearch(ctx, c, 1 + i)
    keysTested += r.keys
    results.push(r.result)
    onProgress?.({ phase: 'plugboard', done: i + 1, total: ringed.length, keys: keysTested })
  })
  const t3 = performance.now()

  const beforeWords = rankFinal(results)
  let candidates = beforeWords
  if (dictionary) {
    const checked = beforeWords.slice(0, t.wordCandidates)
    const words: CoreCandidate[] = checked.map((c, i) => {
      const r = runWordsSearch(ctx, c, i < t.wordPolish)
      keysTested += r.keys
      onProgress?.({ phase: 'words', done: i + 1, total: checked.length, keys: keysTested })
      return r.result
    })
    candidates = rankFinal(words)
  }
  const t4 = performance.now()

  return {
    candidates,
    beforeWords,
    keysTested,
    timings: { rotors: t1 - t0, rings: t2 - t1, plugboard: t3 - t2, words: t4 - t3 },
    survivors,
    finalists: ringed,
  }
}

/** Letters of the ciphertext as codes (re-exported for the worker pool). */
export const cipherCodes = (config: BreakerConfig): Uint8Array => toCodes(config.ciphertext)
