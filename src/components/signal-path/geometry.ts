import {
  REFLECTORS,
  ROTORS,
  mod26,
  plugboardMap,
  reflectorWiring,
  ringLabel,
  startPositions,
  toChar,
  wiringTable,
} from '../../lib/enigma'
import type {
  AnyRotorId,
  KeypressTrace,
  Letter,
  MachineSettings,
  Positions,
  SlotId,
  SteppingInfo,
  TraceStage,
} from '../../lib/enigma'

/*
 * Pure geometry of the wiring diagram. Columns run LEFT → RIGHT:
 * Reflector │ [Greek] │ Left │ Middle │ Right │ ETW │ Plugboard │ Keys/Lamps,
 * and the 26 rows are the absolute contacts A–Z of the fixed machine frame.
 * The coloured signal path is built ONLY from `trace.stages` (input/output of
 * every stage), each segment tagged with the stage index that reveals it.
 */

export const ROW_COUNT = 26
export const ROW_HEIGHT = 20
export const HEADER_HEIGHT = 92
export const GUTTER = 28
export const GAP = 40
/** Width of the alphabet-ring letter strip on the right inner edge of every drum. */
export const RING_STRIP = 16
/** Distance from the keys column's left edge to the key/lamp dot. */
export const KEY_DOT_OFFSET = 22
export const KEY_DOT_RADIUS = 5

export type ColumnId = 'reflector' | SlotId | 'entry' | 'plugboard' | 'keys'
export type ColumnKind = 'reflector' | 'rotor' | 'entry' | 'plugboard' | 'keys'

export const COLUMN_WIDTH: Record<ColumnId, number> = {
  reflector: 72,
  greek: 104,
  left: 130,
  middle: 130,
  right: 130,
  entry: 44,
  plugboard: 84,
  keys: 68,
}

export interface Column {
  id: ColumnId
  kind: ColumnKind
  /** Left edge. */
  x0: number
  /** Right edge. */
  x1: number
  /** Horizontal centre. */
  cx: number
}

export interface DiagramLayout {
  width: number
  height: number
  hasGreek: boolean
  columns: Column[]
  /** Top / bottom of the column bodies. */
  bodyTop: number
  bodyBottom: number
  /** x of the key/lamp dots. */
  keyDotX: number
}

export interface Point {
  x: number
  y: number
}

/** 'in' = towards the reflector (orange), 'out' = back to the lamps (blue). */
export type SignalTone = 'in' | 'out'

export interface PathSegment {
  /** Stable id within one trace: `${stageIndex}-${order}`. */
  id: string
  /** Index into trace.stages; visible when stageIndex < stageCursor (or cursor null). */
  stageIndex: number
  /** Drawing order within the stage (0, 1, …). */
  order: number
  /** 'wire' runs inside a component, 'connector' crosses the gap to the next column. */
  kind: 'wire' | 'connector'
  tone: SignalTone
  d: string
  from: Point
  to: Point
}

export interface PathBadge {
  id: string
  stageIndex: number
  tone: SignalTone
  letter: string
  x: number
  y: number
}

export interface ActivePath {
  segments: PathSegment[]
  badges: PathBadge[]
  /** Pressed key and lit lamp (rows). */
  key: Letter
  lamp: Letter
  /** Stage indices of the keyboard and lamp stages. */
  keyStage: number
  lampStage: number
}

export interface RingLetter {
  row: number
  letter: string
  /** The letter showing in the rotor window. */
  window: boolean
  /** A turnover notch letter of this rotor. */
  notch: boolean
}

export interface StepBadge {
  text: string
  emphasis: 'outline' | 'solid' | 'muted'
}

export interface DrumModel {
  slot: SlotId
  column: Column
  rotor: AnyRotorId
  caption: string
  name: string
  detail: string
  windowLetter: string
  offset: number
  /** All 26 internal wires (one path, faint). */
  wires: string
  ringLetters: RingLetter[]
  badge: StepBadge | null
}

export interface StaticDiagram {
  layout: DiagramLayout
  drums: DrumModel[]
  reflector: { column: Column; name: string; caption: string; detail: string; arcs: string }
  entry: { column: Column; wires: string }
  plugboard: { column: Column; plain: string; plugged: string; detail: string }
  keys: { column: Column }
  /** Faint straight frame connections across every gap. */
  frame: string
  /** Contact ticks on every column edge. */
  contacts: string
}

/* ------------------------------------------------------------------------ */
/* Basics                                                                    */
/* ------------------------------------------------------------------------ */

const SLOT_CAPTION: Record<SlotId, string> = {
  greek: 'Greek',
  left: 'Left',
  middle: 'Middle',
  right: 'Right',
}

function r1(n: number): number {
  return Math.round(n * 10) / 10
}

/** y of the centre of a contact row (0 = A). */
export function rowY(row: number): number {
  return HEADER_HEIGHT + row * ROW_HEIGHT + ROW_HEIGHT / 2
}

/** Column order (left → right) for a 3- or 4-rotor machine. */
export function columnOrder(hasGreek: boolean): ColumnId[] {
  return [
    'reflector',
    ...(hasGreek ? (['greek'] as const) : []),
    'left',
    'middle',
    'right',
    'entry',
    'plugboard',
    'keys',
  ]
}

function kindOf(id: ColumnId): ColumnKind {
  if (id === 'reflector' || id === 'entry' || id === 'plugboard' || id === 'keys') return id
  return 'rotor'
}

/** Column positions for a 3- or 4-rotor machine. */
export function buildLayout(hasGreek: boolean): DiagramLayout {
  const columns: Column[] = []
  let x = GUTTER
  for (const id of columnOrder(hasGreek)) {
    const w = COLUMN_WIDTH[id]
    columns.push({ id, kind: kindOf(id), x0: x, x1: x + w, cx: x + w / 2 })
    x += w + GAP
  }
  const last = columns[columns.length - 1]
  const bodyTop = HEADER_HEIGHT - 6
  const bodyBottom = HEADER_HEIGHT + ROW_COUNT * ROW_HEIGHT + 6
  return {
    width: last.x1 + GUTTER,
    height: bodyBottom + 10,
    hasGreek,
    columns,
    bodyTop,
    bodyBottom,
    keyDotX: last.x0 + KEY_DOT_OFFSET,
  }
}

const LAYOUTS = { 3: buildLayout(false), 4: buildLayout(true) }

/** Shared (cached) layout instance. */
export function layoutFor(hasGreek: boolean): DiagramLayout {
  return hasGreek ? LAYOUTS[4] : LAYOUTS[3]
}

/** The column with this id; throws when it is not part of the layout. */
export function columnOf(layout: DiagramLayout, id: ColumnId): Column {
  const col = layout.columns.find((c) => c.id === id)
  if (!col) throw new Error(`Column "${id}" is not part of this layout`)
  return col
}

/** Column that draws a trace stage (keyboard and lamp share the keys column). */
export function columnIdOf(stage: TraceStage): ColumnId {
  return stage.component === 'keyboard' || stage.component === 'lamp' ? 'keys' : stage.component
}

/** Where a rotor's right-side (entry) contact `c` leaves on its left side for `offset`. */
export function rotorForward(rotor: AnyRotorId, offset: number, c: Letter): Letter {
  const { forward } = wiringTable(rotor)
  return mod26(forward[mod26(c + offset)] - offset)
}

/** Path commands (without the initial move) of a wire from a to b. */
function wireTail(a: Point, b: Point): string {
  if (a.y === b.y) return `H${r1(b.x)}`
  const dx = (b.x - a.x) * 0.45
  return `C${r1(a.x + dx)} ${r1(a.y)} ${r1(b.x - dx)} ${r1(b.y)} ${r1(b.x)} ${r1(b.y)}`
}

/** Smooth wire between two contacts (straight when on the same row). */
export function wirePath(a: Point, b: Point): string {
  return `M${r1(a.x)} ${r1(a.y)}${wireTail(a, b)}`
}

/** Control points of the reflector arc between rows a and b on the column's right edge. */
function reflectorArc(col: Column, a: Letter, b: Letter): [Point, Point, Point, Point] {
  const span = Math.abs(a - b)
  const maxDepth = (col.x1 - col.x0 - 8) / 0.75
  const depth = 14 + (span / 25) * (maxDepth - 14)
  const ya = rowY(a)
  const yb = rowY(b)
  return [
    { x: col.x1, y: ya },
    { x: col.x1 - depth, y: ya },
    { x: col.x1 - depth, y: yb },
    { x: col.x1, y: yb },
  ]
}

function cubic(p: [Point, Point, Point, Point], move = true): string {
  const [a, b, c, d] = p
  return `${move ? `M${r1(a.x)} ${r1(a.y)}` : ''}C${r1(b.x)} ${r1(b.y)} ${r1(c.x)} ${r1(c.y)} ${r1(d.x)} ${r1(d.y)}`
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** Splits a cubic Bézier at t = 0.5 (de Casteljau). */
export function splitCubic(
  p: [Point, Point, Point, Point],
): [[Point, Point, Point, Point], [Point, Point, Point, Point]] {
  const [p0, p1, p2, p3] = p
  const p01 = mid(p0, p1)
  const p12 = mid(p1, p2)
  const p23 = mid(p2, p3)
  const p012 = mid(p01, p12)
  const p123 = mid(p12, p23)
  const m = mid(p012, p123)
  return [
    [p0, p01, p012, m],
    [m, p123, p23, p3],
  ]
}

/** Positions used for the drawing: the trace's (after stepping) or the START positions. */
export function diagramPositions(settings: MachineSettings, trace: KeypressTrace | null): Positions {
  return trace ? trace.stepping.after : startPositions(settings)
}

function slotOf(settings: MachineSettings, slot: SlotId) {
  return slot === 'greek' ? settings.greek : settings[slot]
}

function positionOf(positions: Positions, slot: SlotId): number {
  return slot === 'greek' ? mod26(positions.greek ?? 0) : mod26(positions[slot])
}

/** Rotor offset (position − ring) per slot; trace stage offsets win when available. */
export function slotOffsets(
  settings: MachineSettings,
  trace: KeypressTrace | null,
): Partial<Record<SlotId, number>> {
  const out: Partial<Record<SlotId, number>> = {}
  const positions = diagramPositions(settings, trace)
  for (const slot of ['greek', 'left', 'middle', 'right'] as const) {
    const s = slotOf(settings, slot)
    if (s) out[slot] = mod26(positionOf(positions, slot) - s.ring)
  }
  if (trace) {
    for (const stage of trace.stages) {
      if (stage.kind === 'rotor' && stage.offset !== undefined) {
        out[stage.component as SlotId] = stage.offset
      }
    }
  }
  return out
}

/* ------------------------------------------------------------------------ */
/* Static (faint) wiring                                                     */
/* ------------------------------------------------------------------------ */

function stepBadge(slot: SlotId, stepping: SteppingInfo | null): StepBadge | null {
  if (slot === 'greek') return { text: 'fixed', emphasis: 'muted' }
  if (!stepping || !stepping.stepped[slot]) return null
  const from = toChar(stepping.before[slot])
  const to = toChar(stepping.after[slot])
  if (slot === 'middle' && stepping.doubleStep) {
    return { text: `double step ${from}→${to}`, emphasis: 'solid' }
  }
  return { text: `stepped ${from}→${to}`, emphasis: 'outline' }
}

/**
 * Everything that does not change while playback runs: column bodies, the 26 faint
 * wires of every component for the current offsets, ring letters and headers.
 */
export function buildStaticDiagram(
  settings: MachineSettings,
  trace: KeypressTrace | null,
  ringDisplay: 'number' | 'letter' = 'number',
): StaticDiagram {
  const layout = layoutFor(settings.greek !== null)
  const positions = diagramPositions(settings, trace)
  const offsets = slotOffsets(settings, trace)
  const stepping = trace ? trace.stepping : null

  const drums: DrumModel[] = []
  for (const col of layout.columns) {
    if (col.kind !== 'rotor') continue
    const slot = col.id as SlotId
    const rs = slotOf(settings, slot)
    if (!rs) continue
    const offset = offsets[slot] ?? 0
    const position = positionOf(positions, slot)
    const table = wiringTable(rs.rotor)
    const notches = new Set(table.notches)
    let wires = ''
    const ringLetters: RingLetter[] = []
    for (let c = 0; c < ROW_COUNT; c++) {
      const out = mod26(table.forward[mod26(c + offset)] - offset)
      wires += wirePath({ x: col.x1 - RING_STRIP, y: rowY(c) }, { x: col.x0, y: rowY(out) })
      const letter = mod26(c + position)
      ringLetters.push({ row: c, letter: toChar(letter), window: c === 0, notch: notches.has(letter) })
    }
    drums.push({
      slot,
      column: col,
      rotor: rs.rotor,
      caption: SLOT_CAPTION[slot],
      name: ROTORS[rs.rotor].id,
      detail: `Pos ${toChar(position)} · Ring ${ringLabel(rs.ring, ringDisplay)}`,
      windowLetter: toChar(position),
      offset,
      wires,
      ringLetters,
      badge: stepBadge(slot, stepping),
    })
  }

  const refCol = columnOf(layout, 'reflector')
  const refl = reflectorWiring(settings.reflector)
  let arcs = ''
  for (let a = 0; a < ROW_COUNT; a++) {
    const b = refl[a]
    if (b > a) arcs += cubic(reflectorArc(refCol, a, b))
  }
  const refSpec = REFLECTORS[settings.reflector]

  const entryCol = columnOf(layout, 'entry')
  let entryWires = ''
  for (let c = 0; c < ROW_COUNT; c++) {
    entryWires += `M${entryCol.x0} ${rowY(c)}H${entryCol.x1}`
  }

  const plugCol = columnOf(layout, 'plugboard')
  const map = plugboardMap(settings.plugboard)
  let plain = ''
  let plugged = ''
  for (let c = 0; c < ROW_COUNT; c++) {
    const d = wirePath({ x: plugCol.x1, y: rowY(c) }, { x: plugCol.x0, y: rowY(map[c]) })
    if (map[c] === c) plain += d
    else plugged += d
  }
  const pairCount = settings.plugboard.length

  let frame = ''
  for (let i = 0; i < layout.columns.length - 1; i++) {
    const a = layout.columns[i].x1
    const b = layout.columns[i + 1].x0
    for (let c = 0; c < ROW_COUNT; c++) frame += `M${a} ${rowY(c)}H${b}`
  }

  let contacts = ''
  for (const col of layout.columns) {
    if (col.kind === 'keys') continue
    const edges = col.kind === 'reflector' ? [col.x1] : [col.x0, col.x1]
    for (const x of edges) {
      for (let c = 0; c < ROW_COUNT; c++) contacts += `M${x - 2.5} ${rowY(c)}h5`
    }
  }

  return {
    layout,
    drums,
    reflector: {
      column: refCol,
      name: refSpec.name.replace(' (thin)', ''),
      caption: 'Reflector',
      detail: refSpec.thin ? 'thin' : 'fixed',
      arcs,
    },
    entry: { column: entryCol, wires: entryWires },
    plugboard: {
      column: plugCol,
      plain,
      plugged,
      detail: pairCount === 0 ? 'no cables' : `${pairCount} ${pairCount === 1 ? 'cable' : 'cables'}`,
    },
    keys: { column: columnOf(layout, 'keys') },
    frame,
    contacts,
  }
}

/* ------------------------------------------------------------------------ */
/* Active path                                                               */
/* ------------------------------------------------------------------------ */

/** Colour of the signal while it travels through a (non-reflector) stage. */
export function stageTone(stage: TraceStage): SignalTone {
  return stage.direction === 'forward' ? 'in' : 'out'
}

/** x where the signal enters a stage's column. */
function entryX(layout: DiagramLayout, stage: TraceStage): number {
  const col = columnOf(layout, columnIdOf(stage))
  switch (stage.kind) {
    case 'keyboard':
      return layout.keyDotX - KEY_DOT_RADIUS - 2
    case 'lamp':
      return col.x0
    case 'reflector':
      return col.x1
    default:
      return stage.direction === 'forward' ? col.x1 : col.x0
  }
}

/** x where the signal leaves a stage's column. */
function exitX(layout: DiagramLayout, stage: TraceStage): number {
  const col = columnOf(layout, columnIdOf(stage))
  switch (stage.kind) {
    case 'keyboard':
      return col.x0
    case 'lamp':
      return layout.keyDotX - KEY_DOT_RADIUS - 2
    case 'reflector':
      return col.x1
    default:
      return stage.direction === 'forward' ? col.x0 : col.x1
  }
}

interface WireDraft {
  tone: SignalTone
  d: string
  from: Point
  to: Point
}

function stageWires(layout: DiagramLayout, stage: TraceStage): WireDraft[] {
  const col = columnOf(layout, columnIdOf(stage))
  const yIn = rowY(stage.input)
  const yOut = rowY(stage.output)
  const from = { x: entryX(layout, stage), y: yIn }
  const to = { x: exitX(layout, stage), y: yOut }
  const tone = stageTone(stage)

  if (stage.kind === 'reflector') {
    const [first, second] = splitCubic(reflectorArc(col, stage.input, stage.output))
    return [
      { tone: 'in', d: cubic(first), from: first[0], to: first[3] },
      { tone: 'out', d: cubic(second), from: second[0], to: second[3] },
    ]
  }

  if (stage.kind === 'rotor') {
    const strip = col.x1 - RING_STRIP
    if (stage.direction === 'forward') {
      const d = `M${r1(from.x)} ${r1(yIn)}H${r1(strip)}${wireTail({ x: strip, y: yIn }, to)}`
      return [{ tone, d, from, to }]
    }
    const d = `${wirePath(from, { x: strip, y: yOut })}H${r1(to.x)}`
    return [{ tone, d, from, to }]
  }

  return [{ tone, d: wirePath(from, to), from, to }]
}

/**
 * Turns a key-press trace into drawable segments. For every stage: its wire(s) inside
 * the component, then a connector across the gap to the next stage's column, carrying
 * a letter badge. Segment n+1 always starts where segment n ended.
 */
export function buildActivePath(layout: DiagramLayout, trace: KeypressTrace): ActivePath {
  const segments: PathSegment[] = []
  const badges: PathBadge[] = []
  const stages = trace.stages
  let keyStage = 0
  let lampStage = stages.length - 1

  stages.forEach((stage, i) => {
    if (stage.kind === 'keyboard') keyStage = i
    if (stage.kind === 'lamp') lampStage = i
    let order = 0
    for (const w of stageWires(layout, stage)) {
      segments.push({ id: `${i}-${order}`, stageIndex: i, order, kind: 'wire', ...w })
      order++
    }
    const next = stages[i + 1]
    if (!next) return
    const y = rowY(stage.output)
    const from = { x: exitX(layout, stage), y }
    const to = { x: entryX(layout, next), y }
    const tone: SignalTone = stage.kind === 'reflector' ? 'out' : stageTone(stage)
    segments.push({
      id: `${i}-${order}`,
      stageIndex: i,
      order,
      kind: 'connector',
      tone,
      d: wirePath(from, to),
      from,
      to,
    })
    badges.push({
      id: `b${i}`,
      stageIndex: i,
      tone,
      letter: toChar(stage.output),
      x: (from.x + to.x) / 2,
      y,
    })
  })

  return {
    segments,
    badges,
    key: trace.input,
    lamp: trace.output,
    keyStage,
    lampStage,
  }
}

/* ------------------------------------------------------------------------ */
/* Text helpers (trace list / summary / hints)                               */
/* ------------------------------------------------------------------------ */

/** Short label of a stage for the trace chips, e.g. "Plugboard", "ETW", "III", "UKW-B", "Lamp". */
export function shortStageLabel(stage: TraceStage, settings: MachineSettings): string {
  switch (stage.kind) {
    case 'keyboard':
      return 'Key'
    case 'lamp':
      return 'Lamp'
    case 'plugboard':
      return 'Plugboard'
    case 'entry':
      return 'ETW'
    case 'reflector':
      return REFLECTORS[settings.reflector].name.replace(' (thin)', '')
    case 'rotor': {
      const rs = slotOf(settings, stage.component as SlotId)
      return rs ? ROTORS[rs.rotor].id : stage.label
    }
  }
}

/** Explanation of one stage (tooltip text). */
export function stageExplanation(
  stage: TraceStage,
  trace: KeypressTrace,
  settings: MachineSettings,
  ringDisplay: 'number' | 'letter' = 'number',
): string {
  const a = toChar(stage.input)
  const b = toChar(stage.output)
  switch (stage.kind) {
    case 'keyboard':
      return `Key ${a} is pressed; the rotors step first, then current flows.`
    case 'lamp':
      return `Lamp ${b} lights up.`
    case 'entry':
      return `Entry wheel (ETW): identity wiring, ${a} stays ${b}.`
    case 'plugboard':
      return a === b
        ? `${a} has no cable on the plugboard and passes straight through.`
        : `Plugboard cable ${a} ↔ ${b} swaps the letters.`
    case 'reflector':
      return `${stage.label} pairs ${a} ↔ ${b} and sends the signal back.`
    case 'rotor': {
      const slot = stage.component as SlotId
      const rs = slotOf(settings, slot)
      const pos = positionOf(trace.stepping.after, slot)
      const ring = rs ? rs.ring : 0
      const offset = stage.offset ?? mod26(pos - ring)
      const coreIn = toChar(stage.coreInput ?? mod26(stage.input + offset))
      const coreOut = toChar(stage.coreOutput ?? mod26(stage.output + offset))
      const way = stage.direction === 'forward' ? 'forward' : 'return'
      return `${stage.label}, ${way}: offset = position − ring = ${toChar(pos)} − ${ringLabel(ring, ringDisplay)} = ${offset}; ${a} + ${offset} → core in ${coreIn} → core out ${coreOut} − ${offset} → ${b}.`
    }
  }
}

/** "Right rotor stepped C → D; middle rotor stepped E → F (double step)." */
export function steppingSentence(stepping: SteppingInfo): string {
  const parts: string[] = []
  for (const slot of ['right', 'middle', 'left'] as const) {
    if (!stepping.stepped[slot]) continue
    const from = toChar(stepping.before[slot])
    const to = toChar(stepping.after[slot])
    const extra = slot === 'middle' && stepping.doubleStep ? ' (double step)' : ''
    parts.push(`${slot} rotor stepped ${from} → ${to}${extra}`)
  }
  if (parts.length === 0) return ''
  const text = parts.join('; ')
  return `${text[0].toUpperCase()}${text.slice(1)}.`
}
