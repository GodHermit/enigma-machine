/**
 * Enigma codebreaker: ciphertext-only attack (optionally with a crib) recovering the full key.
 * See types.ts for the contract. Heavy lifting runs in Web Workers (worker.ts); the search
 * phases themselves are pure functions in search.ts.
 */
export type * from './types'
export type { BreakerOptions } from './breaker'
export type { CoreCandidate, RotorUnit, SearchTuning } from './search'
export type { SyncProgress, SyncResult } from './pipeline'
export type { WordDictionary, WordsResult } from './words'

export { createBreaker, loadDictionary } from './breaker'
export {
  KEYS_PER_SECOND_PER_WORKER,
  WASM_KEYS_PER_SECOND_PER_WORKER,
  defaultBreakerConfig,
  estimateWork,
  validateBreakerConfig,
} from './config'
export { describeKey, sampleChallenge } from './samples'
export { indexOfCoincidence, letterAgreement, lettersOnly, transliterate } from './text'
export { normalizeSettings } from './scrambler'
export { runSearchSync } from './pipeline'
export { DEFAULT_TUNING, WORDS_WEIGHT } from './search'
export { DEFAULT_TYPO_TOLERANCE, MAX_TYPO_TOLERANCE, maxEdits, parseDictionary, scoreWords } from './words'
