import { ALPHABET, REFLECTORS, ROTORS } from './constants'
import { mod26, toLetter } from './letters'
import { plugboardMap } from './plugboard'
import type {
  AnyRotorId,
  EncryptOptions,
  EncryptResult,
  KeypressTrace,
  Letter,
  MachineSettings,
  Positions,
  ReflectorId,
  RotorSlot,
  SlotId,
  SteppingInfo,
  TraceStage,
} from './types'

/* ------------------------------------------------------------------------ */
/* Precomputed numeric tables                                                */
/* ------------------------------------------------------------------------ */

interface RotorTable {
  forward: Uint8Array
  backward: Uint8Array
  /** notch[p] === 1 when window letter p is a turnover position. */
  notch: Uint8Array
}

function wiringToArray(wiring: string): Uint8Array {
  const arr = new Uint8Array(26)
  for (let i = 0; i < 26; i++) arr[i] = wiring.charCodeAt(i) - 65
  return arr
}

function invertArray(forward: Uint8Array): Uint8Array {
  const inv = new Uint8Array(26)
  for (let i = 0; i < 26; i++) inv[forward[i]] = i
  return inv
}

const ROTOR_TABLES = {} as Record<AnyRotorId, RotorTable>
for (const id of Object.keys(ROTORS) as AnyRotorId[]) {
  const spec = ROTORS[id]
  const forward = wiringToArray(spec.wiring)
  const notch = new Uint8Array(26)
  for (const ch of spec.notches) notch[ch.charCodeAt(0) - 65] = 1
  ROTOR_TABLES[id] = { forward, backward: invertArray(forward), notch }
}

const REFLECTOR_TABLES = {} as Record<ReflectorId, Uint8Array>
for (const id of Object.keys(REFLECTORS) as ReflectorId[]) {
  REFLECTOR_TABLES[id] = wiringToArray(REFLECTORS[id].wiring)
}

function rotorTable(id: AnyRotorId): RotorTable {
  const t = ROTOR_TABLES[id]
  if (!t) throw new Error(`Unknown rotor "${String(id)}"`)
  return t
}

function reflectorTable(id: ReflectorId): Uint8Array {
  const t = REFLECTOR_TABLES[id]
  if (!t) throw new Error(`Unknown reflector "${String(id)}"`)
  return t
}

/* ------------------------------------------------------------------------ */
/* Visualisation helpers                                                     */
/* ------------------------------------------------------------------------ */

export interface WiringTable {
  /** Forward wiring string (entry side → reflector side), e.g. "EKMFLGDQVZNTOWYHXUSPAIBRCJ". */
  wiring: string
  /** Inverse wiring string (return path). */
  inverse: string
  /** forward[i] = core contact the signal leaves on when entering on core contact i. */
  forward: Letter[]
  /** backward[i] = inverse of forward. */
  backward: Letter[]
  /** Turnover window letters as Letter values ([] for Greek wheels). */
  notches: Letter[]
}

/** Inverts a 26-letter wiring string. */
export function inverseWiring(wiring: string): string {
  const out: string[] = new Array<string>(26).fill('?')
  for (let i = 0; i < 26; i++) out[wiring.charCodeAt(i) - 65] = ALPHABET[i]
  return out.join('')
}

/** Wiring of a rotor (or Greek wheel) in string and numeric form, for visualisation. */
export function wiringTable(rotor: AnyRotorId): WiringTable {
  const spec = ROTORS[rotor]
  if (!spec) throw new Error(`Unknown rotor "${String(rotor)}"`)
  const t = rotorTable(rotor)
  return {
    wiring: spec.wiring,
    inverse: inverseWiring(spec.wiring),
    forward: Array.from(t.forward),
    backward: Array.from(t.backward),
    notches: Array.from(spec.notches, (ch) => ch.charCodeAt(0) - 65),
  }
}

/** Reflector wiring as a 26-length involution of Letters. */
export function reflectorWiring(id: ReflectorId): Letter[] {
  return Array.from(reflectorTable(id))
}

/** Slots that hold a rotor for these settings, ordered left → right ('greek' only when present). */
export function activeSlots(settings: MachineSettings): SlotId[] {
  return settings.greek ? ['greek', 'left', 'middle', 'right'] : ['left', 'middle', 'right']
}

/* ------------------------------------------------------------------------ */
/* Stepping                                                                  */
/* ------------------------------------------------------------------------ */

/** START (Grundstellung) positions from the settings. */
export function startPositions(settings: MachineSettings): Positions {
  return {
    greek: settings.greek ? mod26(settings.greek.position) : null,
    left: mod26(settings.left.position),
    middle: mod26(settings.middle.position),
    right: mod26(settings.right.position),
  }
}

/**
 * Advances the rotors for one key press (the ratchet mechanism).
 * - The right rotor always steps.
 * - The middle rotor steps when the right rotor is at one of its notches, OR when the
 *   middle rotor itself is at one of its notches (double-stepping anomaly).
 * - The left rotor steps when the middle rotor is at one of its notches.
 * - The left rotor's own notch has no effect; the Greek wheel never steps.
 */
export function stepRotors(settings: MachineSettings, positions: Positions): SteppingInfo {
  const right = mod26(positions.right)
  const middle = mod26(positions.middle)
  const left = mod26(positions.left)
  const rightAtNotch = rotorTable(settings.right.rotor).notch[right] === 1
  const middleAtNotch = rotorTable(settings.middle.rotor).notch[middle] === 1
  const stepMiddle = rightAtNotch || middleAtNotch
  const stepLeft = middleAtNotch
  return {
    before: { greek: positions.greek, left, middle, right },
    after: {
      greek: positions.greek,
      left: stepLeft ? mod26(left + 1) : left,
      middle: stepMiddle ? mod26(middle + 1) : middle,
      right: mod26(right + 1),
    },
    stepped: { left: stepLeft, middle: stepMiddle, right: true },
    doubleStep: middleAtNotch,
  }
}

/** Rotor positions after `letterCount` key presses from the START positions. */
export function positionsAfter(settings: MachineSettings, letterCount: number): Positions {
  let pos = startPositions(settings)
  for (let i = 0; i < letterCount; i++) pos = stepRotors(settings, pos).after
  return pos
}

/* ------------------------------------------------------------------------ */
/* Compiled machine                                                          */
/* ------------------------------------------------------------------------ */

const SLOT_NAMES: Record<SlotId, string> = {
  greek: 'greek',
  left: 'left',
  middle: 'middle',
  right: 'right',
}

interface CompiledSlot {
  slot: SlotId
  table: RotorTable
  ring: number
  label: string
}

interface CompiledMachine {
  plug: Uint8Array
  reflector: Uint8Array
  reflectorLabel: string
  /** Slots in forward signal order: right, middle, left, [greek]. */
  forwardSlots: CompiledSlot[]
}

function compileSlot(slot: SlotId, rs: RotorSlot): CompiledSlot {
  const spec = ROTORS[rs.rotor]
  if (!spec) throw new Error(`Unknown rotor "${String(rs.rotor)}"`)
  const label =
    slot === 'greek' ? `Greek wheel ${spec.id}` : `Rotor ${spec.id} (${SLOT_NAMES[slot]})`
  return { slot, table: rotorTable(rs.rotor), ring: mod26(rs.ring), label }
}

function compile(settings: MachineSettings): CompiledMachine {
  const forwardSlots: CompiledSlot[] = [
    compileSlot('right', settings.right),
    compileSlot('middle', settings.middle),
    compileSlot('left', settings.left),
  ]
  if (settings.greek) forwardSlots.push(compileSlot('greek', settings.greek))
  const reflectorSpec = REFLECTORS[settings.reflector]
  if (!reflectorSpec) throw new Error(`Unknown reflector "${String(settings.reflector)}"`)
  return {
    plug: Uint8Array.from(plugboardMap(settings.plugboard)),
    reflector: reflectorTable(settings.reflector),
    reflectorLabel: `Reflector ${reflectorSpec.name}`,
    forwardSlots,
  }
}

function slotPosition(positions: Positions, slot: SlotId): number {
  return slot === 'greek' ? mod26(positions.greek ?? 0) : mod26(positions[slot])
}

/** Enciphers one letter at the given (already stepped) positions without building a trace. */
function encipherFast(m: CompiledMachine, positions: Positions, letter: Letter): Letter {
  const slots = m.forwardSlots
  const n = slots.length
  let c = m.plug[letter]
  for (let i = 0; i < n; i++) {
    const s = slots[i]
    const shift = slotPosition(positions, s.slot) - s.ring + 26
    c = (s.table.forward[(c + shift) % 26] - shift + 52) % 26
  }
  c = m.reflector[c]
  for (let i = n - 1; i >= 0; i--) {
    const s = slots[i]
    const shift = slotPosition(positions, s.slot) - s.ring + 26
    c = (s.table.backward[(c + shift) % 26] - shift + 52) % 26
  }
  return m.plug[c]
}

function traceKeypress(
  m: CompiledMachine,
  stepping: SteppingInfo,
  letter: Letter,
  index: number,
): KeypressTrace {
  const positions = stepping.after
  const slots = m.forwardSlots
  const n = slots.length
  const stages: TraceStage[] = []

  stages.push({
    kind: 'keyboard',
    direction: 'forward',
    component: 'keyboard',
    label: 'Keyboard',
    input: letter,
    output: letter,
  })
  let c = m.plug[letter]
  stages.push({
    kind: 'plugboard',
    direction: 'forward',
    component: 'plugboard',
    label: 'Plugboard',
    input: letter,
    output: c,
  })
  stages.push({
    kind: 'entry',
    direction: 'forward',
    component: 'entry',
    label: 'Entry wheel (ETW)',
    input: c,
    output: c,
  })

  for (let i = 0; i < n; i++) {
    const s = slots[i]
    const offset = mod26(slotPosition(positions, s.slot) - s.ring)
    const coreInput = (c + offset) % 26
    const coreOutput = s.table.forward[coreInput]
    const out = (coreOutput - offset + 26) % 26
    stages.push({
      kind: 'rotor',
      direction: 'forward',
      component: s.slot,
      label: s.label,
      input: c,
      output: out,
      coreInput,
      coreOutput,
      offset,
    })
    c = out
  }

  const reflected = m.reflector[c]
  stages.push({
    kind: 'reflector',
    direction: 'reflect',
    component: 'reflector',
    label: m.reflectorLabel,
    input: c,
    output: reflected,
  })
  c = reflected

  for (let i = n - 1; i >= 0; i--) {
    const s = slots[i]
    const offset = mod26(slotPosition(positions, s.slot) - s.ring)
    const coreInput = (c + offset) % 26
    const coreOutput = s.table.backward[coreInput]
    const out = (coreOutput - offset + 26) % 26
    stages.push({
      kind: 'rotor',
      direction: 'backward',
      component: s.slot,
      label: s.label,
      input: c,
      output: out,
      coreInput,
      coreOutput,
      offset,
    })
    c = out
  }

  stages.push({
    kind: 'entry',
    direction: 'backward',
    component: 'entry',
    label: 'Entry wheel (ETW)',
    input: c,
    output: c,
  })
  const lamp = m.plug[c]
  stages.push({
    kind: 'plugboard',
    direction: 'backward',
    component: 'plugboard',
    label: 'Plugboard',
    input: c,
    output: lamp,
  })
  stages.push({
    kind: 'lamp',
    direction: 'backward',
    component: 'lamp',
    label: 'Lampboard',
    input: lamp,
    output: lamp,
  })

  return { index, input: letter, output: lamp, stepping, stages }
}

/* ------------------------------------------------------------------------ */
/* Public API                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Presses one key: the rotors step first, then the letter is enciphered.
 * Returns the full trace (index 0) and the positions after the key press.
 */
export function pressKey(
  settings: MachineSettings,
  positions: Positions,
  letter: Letter,
): { trace: KeypressTrace; positions: Positions } {
  const m = compile(settings)
  const stepping = stepRotors(settings, positions)
  const trace = traceKeypress(m, stepping, mod26(letter), 0)
  return { trace, positions: stepping.after }
}

/**
 * Enciphers (= deciphers) `text`. Case-insensitive; letters are output uppercase.
 * Non A–Z characters are passed through unchanged without stepping ('keep') or dropped ('remove').
 * `inputToTrace` / `outputToTrace` are indexed by UTF-16 code unit (like `string[i]`).
 */
export function encryptText(
  settings: MachineSettings,
  text: string,
  options: EncryptOptions = { nonLetters: 'keep' },
): EncryptResult {
  const m = compile(settings)
  const keep = options.nonLetters === 'keep'
  const traces: KeypressTrace[] = []
  const inputToTrace: (number | null)[] = new Array<number | null>(text.length)
  const outputToTrace: (number | null)[] = []
  const out: string[] = []
  let pos = startPositions(settings)

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const l = toLetter(ch)
    if (l === null) {
      inputToTrace[i] = null
      if (keep) {
        out.push(ch)
        outputToTrace.push(null)
      }
      continue
    }
    const stepping = stepRotors(settings, pos)
    pos = stepping.after
    const idx = traces.length
    const trace = traceKeypress(m, stepping, l, idx)
    traces.push(trace)
    inputToTrace[i] = idx
    out.push(ALPHABET[trace.output])
    outputToTrace.push(idx)
  }

  return { output: out.join(''), traces, finalPositions: pos, inputToTrace, outputToTrace }
}

/**
 * Fast letters-only encipherment without traces (non-letters are dropped).
 * Useful for bulk work and tests.
 */
export function encryptLetters(settings: MachineSettings, text: string): string {
  const m = compile(settings)
  let pos = startPositions(settings)
  const out: string[] = []
  for (let i = 0; i < text.length; i++) {
    const l = toLetter(text[i])
    if (l === null) continue
    pos = stepRotors(settings, pos).after
    out.push(ALPHABET[encipherFast(m, pos, l)])
  }
  return out.join('')
}
