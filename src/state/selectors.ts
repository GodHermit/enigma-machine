import { encryptText, validateSettings } from '../lib/enigma'
import type {
  EncryptResult,
  KeypressTrace,
  MachineSettings,
  Positions,
  ValidationIssue,
} from '../lib/enigma'
import type { EnigmaState, NonLettersMode } from './store'

/*
 * Pure, memoised selectors over the store state. Settings objects in the store are
 * immutable (every action produces a new object), so identity comparison is enough
 * to know when the expensive encipherment has to run again.
 */

let lastSettings: MachineSettings | null = null
let lastInput: string | null = null
let lastNonLetters: NonLettersMode | null = null
let lastResult: EncryptResult | null = null

/** `encryptText(settings, input, { nonLetters })`, computed once per distinct argument set. */
export function computeResult(
  settings: MachineSettings,
  input: string,
  nonLetters: NonLettersMode,
): EncryptResult {
  if (
    lastResult !== null &&
    lastSettings === settings &&
    lastInput === input &&
    lastNonLetters === nonLetters
  ) {
    return lastResult
  }
  const result = encryptText(settings, input, { nonLetters })
  lastSettings = settings
  lastInput = input
  lastNonLetters = nonLetters
  lastResult = result
  return result
}

let lastValidated: MachineSettings | null = null
let lastIssues: ValidationIssue[] = []

/** `validateSettings(settings)`, recomputed only when the settings object changes. */
export function computeValidation(settings: MachineSettings): ValidationIssue[] {
  if (lastValidated === settings) return lastIssues
  lastIssues = validateSettings(settings)
  lastValidated = settings
  return lastIssues
}

/** Full encipherment result for the current state. */
export function selectResult(s: EnigmaState): EncryptResult {
  return computeResult(s.settings, s.input, s.options.nonLetters)
}

/** Rotor positions after every key of the input has been pressed (what the windows show). */
export function selectCurrentPositions(s: EnigmaState): Positions {
  return selectResult(s).finalPositions
}

/**
 * Index of the visualised trace: the selected one when it exists, otherwise the most
 * recent key press; null when nothing has been typed yet.
 */
export function selectActiveTraceIndex(s: EnigmaState): number | null {
  const count = selectResult(s).traces.length
  if (count === 0) return null
  if (s.selectedTrace !== null && s.selectedTrace >= 0 && s.selectedTrace < count) {
    return s.selectedTrace
  }
  return count - 1
}

/** The visualised key press trace, or null when nothing has been typed yet. */
export function selectActiveTrace(s: EnigmaState): KeypressTrace | null {
  const index = selectActiveTraceIndex(s)
  return index === null ? null : selectResult(s).traces[index]
}

/** Number of stages of the visualised trace (0 when there is none). */
export function selectStageCount(s: EnigmaState): number {
  return selectActiveTrace(s)?.stages.length ?? 0
}

/** Validation issues of the current settings (stable array while settings are unchanged). */
export function selectValidation(s: EnigmaState): ValidationIssue[] {
  return computeValidation(s.settings)
}
