import { DEFAULT_SETTINGS, MAX_PLUGS, HISTORICAL_PLUGS, MODELS, MODEL_ORDER, REFLECTORS, ROTORS } from './constants'
import { mod26, toChar, toLetter } from './letters'
import { formatPlugboard, parsePlugboard } from './plugboard'
import type {
  AnyRotorId,
  GreekRotorId,
  Letter,
  MachineSettings,
  ModelId,
  PlugPair,
  ReflectorId,
  RotorId,
  RotorSlot,
  SlotId,
  ValidationIssue,
} from './types'

const MAIN_SLOTS = ['left', 'middle', 'right'] as const
type MainSlot = (typeof MAIN_SLOTS)[number]

const SLOT_TITLES: Record<SlotId, string> = {
  greek: 'Greek wheel',
  left: 'Left rotor',
  middle: 'Middle rotor',
  right: 'Right rotor',
}

function isIndex(n: unknown): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 25
}

/** Returns every problem with the settings; an empty array means the machine can be used. */
export function validateSettings(s: MachineSettings): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const model = MODELS[s.model]
  if (!model) {
    issues.push({ field: 'model', message: `Unknown model "${String(s.model)}".` })
    return issues
  }

  if (!REFLECTORS[s.reflector]) {
    issues.push({ field: 'reflector', message: `Unknown reflector "${String(s.reflector)}".` })
  } else if (!model.reflectorIds.includes(s.reflector)) {
    issues.push({
      field: 'reflector',
      message: `Reflector ${REFLECTORS[s.reflector].name} cannot be used in the ${model.name}.`,
    })
  }

  if (model.hasGreek) {
    if (!s.greek) {
      issues.push({ field: 'greek', message: `The ${model.name} needs a Greek wheel (Beta or Gamma).` })
    } else if (!model.greekIds.includes(s.greek.rotor as GreekRotorId)) {
      issues.push({
        field: 'greek',
        message: `Rotor ${String(s.greek.rotor)} cannot be used as the Greek wheel.`,
      })
    }
  } else if (s.greek) {
    issues.push({ field: 'greek', message: `The ${model.name} has no Greek wheel.` })
  }

  const seen = new Map<AnyRotorId, SlotId>()
  const slotsToCheck: SlotId[] = s.greek ? ['greek', ...MAIN_SLOTS] : [...MAIN_SLOTS]
  for (const slot of slotsToCheck) {
    const rs = slot === 'greek' ? s.greek : s[slot]
    if (!rs) continue
    if (!ROTORS[rs.rotor]) {
      issues.push({ field: slot, message: `Unknown rotor "${String(rs.rotor)}".` })
      continue
    }
    if (slot !== 'greek' && !model.rotorIds.includes(rs.rotor as RotorId)) {
      issues.push({
        field: slot,
        message: `Rotor ${rs.rotor} cannot be used in the ${model.name} (${SLOT_TITLES[slot].toLowerCase()}).`,
      })
    }
    const prev = seen.get(rs.rotor)
    if (prev) {
      issues.push({
        field: slot,
        message: `Rotor ${rs.rotor} is already in the ${SLOT_TITLES[prev].toLowerCase()} slot.`,
      })
    } else {
      seen.set(rs.rotor, slot)
    }
    if (!isIndex(rs.ring)) {
      issues.push({ field: slot, message: `${SLOT_TITLES[slot]}: ring setting must be 01–26.` })
    }
    if (!isIndex(rs.position)) {
      issues.push({ field: slot, message: `${SLOT_TITLES[slot]}: start position must be A–Z.` })
    }
  }

  if (s.plugboard.length > MAX_PLUGS) {
    issues.push({ field: 'plugboard', message: `At most ${MAX_PLUGS} cables can be plugged.` })
  }
  const used = new Set<Letter>()
  for (const [a, b] of s.plugboard) {
    if (!isIndex(a) || !isIndex(b)) {
      issues.push({ field: 'plugboard', message: 'Plug letters must be A–Z.' })
      continue
    }
    if (a === b) {
      issues.push({ field: 'plugboard', message: `${toChar(a)} cannot be plugged to itself.` })
      continue
    }
    for (const l of [a, b]) {
      if (used.has(l)) {
        issues.push({ field: 'plugboard', message: `Letter ${toChar(l)} is plugged more than once.` })
      }
      used.add(l)
    }
  }
  return issues
}

/** Normalises a ring / position value to 0..25 (non-finite → 0, fractions truncated, wrapped mod 26). */
function normalizeIndex(n: number): number {
  return Number.isFinite(n) ? mod26(Math.trunc(n)) : 0
}

function cloneSlot(rs: RotorSlot): RotorSlot {
  return { rotor: rs.rotor, ring: normalizeIndex(rs.ring), position: normalizeIndex(rs.position) }
}

/** Deep copy of settings. */
export function cloneSettings(s: MachineSettings): MachineSettings {
  return {
    model: s.model,
    reflector: s.reflector,
    greek: s.greek ? cloneSlot(s.greek) : null,
    left: cloneSlot(s.left),
    middle: cloneSlot(s.middle),
    right: cloneSlot(s.right),
    plugboard: s.plugboard.map(([a, b]) => [a, b] as PlugPair),
  }
}

/** Factory defaults for a model: rotors I-II-III, reflector B (thin B + Beta on the M4), rings/positions A, no plugs. */
export function defaultSettings(model: ModelId = 'I'): MachineSettings {
  const base = cloneSettings(DEFAULT_SETTINGS)
  if (model === 'I') return base
  if (model === 'M3') return { ...base, model: 'M3' }
  return { ...base, model: 'M4', reflector: 'UKW-B-thin', greek: { rotor: 'Beta', ring: 0, position: 0 } }
}

const THIN_EQUIVALENT: Partial<Record<ReflectorId, ReflectorId>> = {
  'UKW-A': 'UKW-B-thin',
  'UKW-B': 'UKW-B-thin',
  'UKW-C': 'UKW-C-thin',
}
const THICK_EQUIVALENT: Partial<Record<ReflectorId, ReflectorId>> = {
  'UKW-B-thin': 'UKW-B',
  'UKW-C-thin': 'UKW-C',
}

/**
 * Switches to another model keeping as much of the settings as possible:
 * allowed rotors stay in their slots, others are replaced by unused allowed rotors;
 * the reflector maps thick ↔ thin (B ↔ thin B, C ↔ thin C) when needed;
 * a Greek wheel is added (Beta) for the M4 or removed otherwise. Rings, positions and plugs are kept.
 */
export function coerceToModel(s: MachineSettings, model: ModelId): MachineSettings {
  const spec = MODELS[model]
  const src = cloneSettings(s)

  let reflector: ReflectorId
  if (spec.reflectorIds.includes(src.reflector)) {
    reflector = src.reflector
  } else {
    const mapped = spec.hasGreek ? THIN_EQUIVALENT[src.reflector] : THICK_EQUIVALENT[src.reflector]
    reflector = mapped && spec.reflectorIds.includes(mapped) ? mapped : spec.reflectorIds.includes('UKW-B') ? 'UKW-B' : spec.reflectorIds[0]
  }

  let greek: RotorSlot | null = null
  if (spec.hasGreek) {
    if (src.greek && spec.greekIds.includes(src.greek.rotor as GreekRotorId)) {
      greek = src.greek
    } else {
      const preferred: GreekRotorId = reflector === 'UKW-C-thin' ? 'Gamma' : 'Beta'
      greek = {
        rotor: spec.greekIds.includes(preferred) ? preferred : spec.greekIds[0],
        ring: src.greek?.ring ?? 0,
        position: src.greek?.position ?? 0,
      }
    }
  }

  const used = new Set<AnyRotorId>()
  const keep: Partial<Record<MainSlot, boolean>> = {}
  for (const slot of MAIN_SLOTS) {
    const id = src[slot].rotor
    if (spec.rotorIds.includes(id as RotorId) && !used.has(id)) {
      used.add(id)
      keep[slot] = true
    }
  }
  const result: Record<MainSlot, RotorSlot> = { left: src.left, middle: src.middle, right: src.right }
  for (const slot of MAIN_SLOTS) {
    if (keep[slot]) continue
    const replacement = spec.rotorIds.find((id) => !used.has(id))
    if (!replacement) throw new Error(`Model ${model} has too few rotors.`)
    used.add(replacement)
    result[slot] = { ...src[slot], rotor: replacement }
  }

  const { pairs } = parsePlugboard(formatPlugboard(src.plugboard.filter(([a, b]) => isIndex(a) && isIndex(b))))

  return {
    model,
    reflector,
    greek,
    left: result.left,
    middle: result.middle,
    right: result.right,
    plugboard: pairs,
  }
}

function randomInt(rand: () => number, n: number): number {
  return Math.min(n - 1, Math.floor(rand() * n))
}

function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const arr = items.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(rand, i + 1)
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

/** Random valid settings for a model: distinct rotors, random rings / positions, 10 plugs. */
export function randomSettings(model: ModelId, rand: () => number = Math.random): MachineSettings {
  const spec = MODELS[model]
  const rotors = shuffled(spec.rotorIds, rand)
  const slot = (rotor: AnyRotorId): RotorSlot => ({
    rotor,
    ring: randomInt(rand, 26),
    position: randomInt(rand, 26),
  })
  const letters = shuffled(
    Array.from({ length: 26 }, (_, i) => i),
    rand,
  )
  const plugboard: PlugPair[] = []
  for (let i = 0; i < HISTORICAL_PLUGS; i++) plugboard.push([letters[2 * i], letters[2 * i + 1]])
  return {
    model,
    reflector: spec.reflectorIds[randomInt(rand, spec.reflectorIds.length)],
    greek: spec.hasGreek ? slot(spec.greekIds[randomInt(rand, spec.greekIds.length)]) : null,
    left: slot(rotors[0]),
    middle: slot(rotors[1]),
    right: slot(rotors[2]),
    plugboard,
  }
}

/**
 * Compact URL-safe text form: `model.reflector.rotors.rings.positions.plugs`, e.g.
 * `M4.UKW-B-thin.Beta-II-IV-I.AAAV.VJNA.AT-BL-DF` (rotors / rings / positions left → right,
 * Greek wheel first on the M4; plugs may be empty).
 */
export function encodeSettings(s: MachineSettings): string {
  const slots: RotorSlot[] = s.greek ? [s.greek, s.left, s.middle, s.right] : [s.left, s.middle, s.right]
  const rotors = slots.map((r) => r.rotor).join('-')
  const rings = slots.map((r) => toChar(r.ring)).join('')
  const positions = slots.map((r) => toChar(r.position)).join('')
  const plugs = s.plugboard.map(([a, b]) => toChar(a) + toChar(b)).join('-')
  return [s.model, s.reflector, rotors, rings, positions, plugs].join('.')
}

function findCaseInsensitive<T extends string>(ids: readonly T[], value: string): T | null {
  const v = value.trim().toLowerCase()
  return ids.find((id) => id.toLowerCase() === v) ?? null
}

function parseLetterRun(text: string, count: number): number[] | null {
  if (text.length !== count) return null
  const out: number[] = []
  for (const ch of text) {
    const l = toLetter(ch)
    if (l === null) return null
    out.push(l)
  }
  return out
}

/** Parses the output of `encodeSettings` (case-insensitive). Returns null when malformed or invalid. */
export function decodeSettings(str: string): MachineSettings | null {
  let text: string
  try {
    text = decodeURIComponent(str.trim())
  } catch {
    return null
  }
  const parts = text.split('.')
  if (parts.length !== 5 && parts.length !== 6) return null
  const [modelText, reflectorText, rotorsText, ringsText, positionsText, plugsText = ''] = parts

  const model = findCaseInsensitive(MODEL_ORDER, modelText)
  if (!model) return null
  const spec = MODELS[model]
  const reflector = findCaseInsensitive(Object.keys(REFLECTORS) as ReflectorId[], reflectorText)
  if (!reflector) return null

  const count = spec.hasGreek ? 4 : 3
  const rotorParts = rotorsText.split('-')
  if (rotorParts.length !== count) return null
  const allRotorIds = Object.keys(ROTORS) as AnyRotorId[]
  const rotors: AnyRotorId[] = []
  for (const r of rotorParts) {
    const id = findCaseInsensitive(allRotorIds, r)
    if (!id) return null
    rotors.push(id)
  }
  const rings = parseLetterRun(ringsText, count)
  const positions = parseLetterRun(positionsText, count)
  if (!rings || !positions) return null

  const { pairs, errors } = parsePlugboard(plugsText)
  if (errors.length > 0) return null

  const slots: RotorSlot[] = rotors.map((rotor, i) => ({ rotor, ring: rings[i], position: positions[i] }))
  const offset = spec.hasGreek ? 1 : 0
  const settings: MachineSettings = {
    model,
    reflector,
    greek: spec.hasGreek ? slots[0] : null,
    left: slots[offset],
    middle: slots[offset + 1],
    right: slots[offset + 2],
    plugboard: pairs,
  }
  return validateSettings(settings).length === 0 ? settings : null
}

/** Structural equality of two settings objects. */
export function settingsEqual(a: MachineSettings, b: MachineSettings): boolean {
  return encodeSettings(a) === encodeSettings(b)
}
