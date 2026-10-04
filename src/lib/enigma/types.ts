/**
 * Shared contract for the Enigma engine, store and UI.
 * Letters are always represented as numbers 0..25 (A = 0) inside the engine.
 */

export type Letter = number

export type ModelId = 'I' | 'M3' | 'M4'

export type RotorId = 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI' | 'VII' | 'VIII'
export type GreekRotorId = 'Beta' | 'Gamma'
export type AnyRotorId = RotorId | GreekRotorId

export type ReflectorId = 'UKW-A' | 'UKW-B' | 'UKW-C' | 'UKW-B-thin' | 'UKW-C-thin'

/** Slot names, ordered left → right as seen by the operator. */
export type SlotId = 'greek' | 'left' | 'middle' | 'right'

export interface RotorSpec {
  id: AnyRotorId
  /** 26-char forward wiring (right/entry side → left side), e.g. "EKMFLGDQVZNTOWYHXUSPAIBRCJ". */
  wiring: string
  /** Letters visible in the window when the rotor *causes* the next rotor to step (turnover). '' for Greek wheels. */
  notches: string
  kind: 'rotor' | 'greek'
  /** Short historical note shown in tooltips. */
  description: string
}

export interface ReflectorSpec {
  id: ReflectorId
  /** Display name, e.g. "UKW-B" / "UKW-B (thin)". */
  name: string
  wiring: string
  thin: boolean
  description: string
}

export interface ModelSpec {
  id: ModelId
  /** e.g. "Enigma I", "Enigma M3", "Enigma M4". */
  name: string
  description: string
  rotorIds: RotorId[]
  reflectorIds: ReflectorId[]
  /** True when the machine has a fourth, non-stepping Greek wheel (M4). */
  hasGreek: boolean
  greekIds: GreekRotorId[]
}

/** A configured rotor in a slot. ring and position are 0..25 (A/01 = 0). */
export interface RotorSlot {
  rotor: AnyRotorId
  ring: number
  position: number
}

/** A plugboard cable connecting two distinct letters. */
export type PlugPair = [Letter, Letter]

/**
 * The complete daily key + start position. Positions stored here are the
 * START (Grundstellung) positions; the current positions are derived by
 * running the input through the machine.
 */
export interface MachineSettings {
  model: ModelId
  reflector: ReflectorId
  /** M4 only; null on other models. */
  greek: RotorSlot | null
  left: RotorSlot
  middle: RotorSlot
  right: RotorSlot
  plugboard: PlugPair[]
}

export interface Positions {
  greek: number | null
  left: number
  middle: number
  right: number
}

export interface SteppingInfo {
  before: Positions
  after: Positions
  /** Which rotors advanced on this key press. */
  stepped: { left: boolean; middle: boolean; right: boolean }
  /** True when the middle rotor stepped because of its own notch (double-step anomaly). */
  doubleStep: boolean
}

export type StageKind = 'keyboard' | 'plugboard' | 'entry' | 'rotor' | 'reflector' | 'lamp'
export type StageDirection = 'forward' | 'reflect' | 'backward'

/**
 * One hop of the electrical signal. `input`/`output` are ABSOLUTE contact
 * letters (the letter position on the fixed machine frame, i.e. what the
 * next component sees), so stage[n].output === stage[n+1].input.
 */
export interface TraceStage {
  kind: StageKind
  direction: StageDirection
  /** Stable id for the visual column: 'keyboard' | 'plugboard' | 'entry' | 'right' | 'middle' | 'left' | 'greek' | 'reflector' | 'lamp'. */
  component: 'keyboard' | 'plugboard' | 'entry' | SlotId | 'reflector' | 'lamp'
  /** Human label, e.g. "Rotor III (right)", "Plugboard", "Entry wheel (ETW)", "Reflector UKW-B". */
  label: string
  input: Letter
  output: Letter
  /** Rotor stages only: letter in the rotor's own core-wiring coordinates (after position/ring offset). */
  coreInput?: Letter
  coreOutput?: Letter
  /** Rotor stages only: position − ring (mod 26) used for this press. */
  offset?: number
}

export interface KeypressTrace {
  /** Index of this letter within the processed (letters-only) stream. */
  index: number
  input: Letter
  output: Letter
  stepping: SteppingInfo
  /**
   * 'keyboard' → 'plugboard'(fwd) → 'entry'(fwd) → right → middle → left → [greek]
   * → 'reflector' → [greek] → left → middle → right (backward) → 'entry'(bwd)
   * → 'plugboard'(bwd) → 'lamp'.
   */
  stages: TraceStage[]
}

export interface EncryptOptions {
  /** 'keep': non A–Z characters pass through unchanged and do not step rotors. 'remove': they are dropped. */
  nonLetters: 'keep' | 'remove'
}

export interface EncryptResult {
  output: string
  traces: KeypressTrace[]
  finalPositions: Positions
  /**
   * For every character of the *input* string: index into `traces` if it was
   * enciphered, or null if it was a passed-through / removed non-letter.
   */
  inputToTrace: (number | null)[]
  /** For every character of `output`: index into `traces` or null. */
  outputToTrace: (number | null)[]
}

export interface ValidationIssue {
  field: 'model' | 'reflector' | SlotId | 'plugboard'
  message: string
}
