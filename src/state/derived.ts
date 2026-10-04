import { useEnigmaStore } from './store'
import {
  selectActiveTrace,
  selectActiveTraceIndex,
  selectCurrentPositions,
  selectResult,
  selectStageCount,
  selectValidation,
} from './selectors'
import type { EncryptResult, KeypressTrace, Positions, ValidationIssue } from '../lib/enigma'

/*
 * Derived-state hooks. Every selector returns a value that is referentially stable
 * while its inputs are unchanged (module-level memoisation in ./selectors), so
 * components only re-render when the derived value really changes.
 */

/** Memoised `encryptText(settings, input, { nonLetters })`. */
export function useEnigmaResult(): EncryptResult {
  return useEnigmaStore(selectResult)
}

/** Rotor positions after the whole input has been typed (what the rotor windows show). */
export function useCurrentPositions(): Positions {
  return useEnigmaStore(selectCurrentPositions)
}

/** Index of the visualised trace (selected, else most recent); null when nothing is typed. */
export function useActiveTraceIndex(): number | null {
  return useEnigmaStore(selectActiveTraceIndex)
}

/** The visualised key press trace (selected, else most recent); null when nothing is typed. */
export function useActiveTrace(): KeypressTrace | null {
  return useEnigmaStore(selectActiveTrace)
}

/** Number of stages in the visualised trace (0 when none). */
export function useStageCount(): number {
  return useEnigmaStore(selectStageCount)
}

/** Validation issues of the current settings. */
export function useValidation(): ValidationIssue[] {
  return useEnigmaStore(selectValidation)
}
