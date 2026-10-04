import { formatRing, toChar } from '../../lib/enigma'
import type { MachineSettings, RotorSlot } from '../../lib/enigma'

/** "12.4" / "63" / "1.5": one decimal below 100, none above; no trailing ".0". */
function compact(value: number): string {
  const rounded = value < 100 ? Math.round(value * 10) / 10 : Math.round(value)
  return String(rounded)
}

const LONG_UNITS: [number, string][] = [
  [1e12, 'trillion'],
  [1e9, 'billion'],
  [1e6, 'million'],
  [1e3, 'thousand'],
]

const SHORT_UNITS: [number, string][] = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'k'],
]

function withUnit(n: number, units: [number, string][]): string {
  const value = Math.max(0, n)
  for (const [size, unit] of units) {
    if (value >= size) return `${compact(value / size)} ${unit}`
  }
  return String(Math.round(value))
}

/** 63_200_000 → "63.2 million"; 950 → "950". */
export function formatCountLong(n: number): string {
  return withUnit(n, LONG_UNITS)
}

/** 12_400_000 → "12.4 M"; 950 → "950". */
export function formatCountShort(n: number): string {
  return withUnit(n, SHORT_UNITS)
}

/** Seconds → "25 s", "4 min 10 s", "1 h 20 min", "3 d 4 h"; under a second → "< 1 s". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 1) return '< 1 s'
  const s = Math.round(seconds)
  if (s < 60) return `${s} s`
  if (s < 3600) {
    const m = Math.floor(s / 60)
    const rest = s % 60
    return rest === 0 || m >= 10 ? `${Math.round(s / 60)} min` : `${m} min ${rest} s`
  }
  if (s < 86400) {
    const h = Math.floor(s / 3600)
    const m = Math.round((s % 3600) / 60)
    return m === 0 ? `${h} h` : m === 60 ? `${h + 1} h` : `${h} h ${m} min`
  }
  const d = Math.floor(s / 86400)
  const h = Math.round((s % 86400) / 3600)
  return h === 0 ? `${d} d` : `${d} d ${h} h`
}

/** "1 worker" / "11 workers". */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export type PlaintextView = 'readable' | 'fives' | 'raw'

/** Letters in blocks of five, as operators wrote them. */
export function groupInFives(text: string): string {
  return text.replace(/(.{5})(?=.)/g, '$1 ')
}

/**
 * Best-effort readable form: German operators keyed X for a space or full stop,
 * so X becomes a space (runs collapse) and the text is trimmed.
 */
export function readable(text: string): string {
  return text.replace(/X+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Plaintext in the chosen view. "Readable" uses the dictionary segmentation when there is one
 * (words separated by spaces; the operators' X separators dropped), else the X → space heuristic.
 */
export function viewPlaintext(text: string, view: PlaintextView, segmented?: string): string {
  if (view === 'fives') return groupInFives(text)
  if (view === 'readable') {
    if (segmented) return segmented.split(' ').filter((t) => t !== '' && t !== 'X').join(' ')
    return readable(text)
  }
  return text
}

export type Confidence = 'language' | 'partial' | 'wrong'

/**
 * How plausible a decrypt is. With a dictionary check, from the share of letters that form
 * words (correct keys measure 0.85–1.0, the best wrong keys about 0.16–0.28); otherwise from
 * the index of coincidence: language sits around 0.066 (English) – 0.076 (German), random
 * letters around 0.0385.
 */
export function confidenceOf(ioc: number, coverage?: number): Confidence {
  if (coverage !== undefined) {
    if (coverage >= 0.7) return 'language'
    if (coverage >= 0.4) return 'partial'
    return 'wrong'
  }
  if (ioc >= 0.06) return 'language'
  if (ioc >= 0.05) return 'partial'
  return 'wrong'
}

/** "92%" for a 0..1 share. */
export function formatPercent(share: number): string {
  return `${Math.round(share * 100)}%`
}

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  language: 'Looks like language',
  partial: 'Partly readable',
  wrong: 'Probably wrong',
}

/** Final score: whole numbers for large magnitudes, two decimals for small ones. */
export function formatScore(score: number): string {
  if (!Number.isFinite(score)) return '—'
  return Math.abs(score) >= 100 ? Math.round(score).toLocaleString('en-US') : score.toFixed(2)
}

export function formatIoc(ioc: number): string {
  return Number.isFinite(ioc) ? ioc.toFixed(4) : '—'
}

function slotsOf(s: MachineSettings): RotorSlot[] {
  return s.greek ? [s.greek, s.left, s.middle, s.right] : [s.left, s.middle, s.right]
}

/** "Beta II IV I" (left → right). */
export function rotorsLabel(s: MachineSettings): string {
  return slotsOf(s)
    .map((slot) => slot.rotor)
    .join(' ')
}

/** Ring settings as numbers, "01 14 22". */
export function ringsLabel(s: MachineSettings): string {
  return slotsOf(s)
    .map((slot) => formatRing(slot.ring))
    .join(' ')
}

/** Start positions as letters, "ADU". */
export function startLabel(s: MachineSettings): string {
  return slotsOf(s)
    .map((slot) => toChar(slot.position))
    .join('')
}

/** "AB CD EF" or "none". */
export function plugsLabel(s: MachineSettings): string {
  if (s.plugboard.length === 0) return 'none'
  return s.plugboard.map(([a, b]) => toChar(a) + toChar(b)).join(' ')
}

/** Share of positions where two letter strings agree (0–1), over the longer length. */
export function letterAgreement(a: string, b: string): number {
  const length = Math.max(a.length, b.length)
  if (length === 0) return 0
  let same = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] === b[i]) same++
  return same / length
}
