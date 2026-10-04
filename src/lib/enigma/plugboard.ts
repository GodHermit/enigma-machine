import { MAX_PLUGS } from './constants'
import { mod26, toChar, toLetter } from './letters'
import type { Letter, PlugPair } from './types'

/**
 * Parses plugboard text such as "AB CD", "ab-cd", "AB,CD" or "AB;CD".
 * Separators are whitespace, ',', ';', '-' and '/'. A token of more than two
 * letters (e.g. "ABCD") is read as consecutive pairs.
 * Invalid / conflicting pairs are skipped and reported in `errors`; the
 * returned pairs are always a valid, conflict-free set of at most MAX_PLUGS.
 */
export function parsePlugboard(text: string): { pairs: PlugPair[]; errors: string[] } {
  const pairs: PlugPair[] = []
  const errors: string[] = []
  const used = new Set<Letter>()
  const tokens = text.split(/[\s,;/-]+/).filter((t) => t.length > 0)

  for (const token of tokens) {
    const letters: Letter[] = []
    let bad = false
    for (const ch of token) {
      const l = toLetter(ch)
      if (l === null) {
        bad = true
        break
      }
      letters.push(l)
    }
    if (bad) {
      errors.push(`"${token}" contains characters other than A–Z.`)
      continue
    }
    if (letters.length % 2 !== 0) {
      errors.push(`"${token.toUpperCase()}" is not a pair of letters.`)
      continue
    }
    for (let i = 0; i < letters.length; i += 2) {
      const a = letters[i]
      const b = letters[i + 1]
      const label = toChar(a) + toChar(b)
      if (a === b) {
        errors.push(`${label}: a letter cannot be plugged to itself.`)
        continue
      }
      if (used.has(a) || used.has(b)) {
        const dup = used.has(a) ? a : b
        errors.push(`${label}: letter ${toChar(dup)} is already plugged.`)
        continue
      }
      if (pairs.length >= MAX_PLUGS) {
        errors.push(`${label}: at most ${MAX_PLUGS} cables are available.`)
        continue
      }
      used.add(a)
      used.add(b)
      pairs.push([a, b])
    }
  }
  return { pairs, errors }
}

/** Formats pairs as "AB CD EF". */
export function formatPlugboard(pairs: readonly PlugPair[]): string {
  return pairs.map(([a, b]) => toChar(a) + toChar(b)).join(' ')
}

/**
 * 26-length involution mapping each letter to its plugged partner (or itself).
 * Pairs that conflict with an earlier pair or connect a letter to itself are ignored,
 * so the result is always a valid involution.
 */
export function plugboardMap(pairs: readonly PlugPair[]): Letter[] {
  const map: Letter[] = Array.from({ length: 26 }, (_, i) => i)
  const used = new Set<Letter>()
  for (const [rawA, rawB] of pairs) {
    const a = mod26(rawA)
    const b = mod26(rawB)
    if (a === b || used.has(a) || used.has(b)) continue
    used.add(a)
    used.add(b)
    map[a] = b
    map[b] = a
  }
  return map
}

/** Returns the letter connected to `l`, or null when `l` is not plugged. */
export function partnerOf(pairs: readonly PlugPair[], l: Letter): Letter | null {
  for (const [a, b] of pairs) {
    if (a === l) return b
    if (b === l) return a
  }
  return null
}

/** Removes the cable plugged into `l` (no-op when unplugged). */
export function unplug(pairs: readonly PlugPair[], l: Letter): PlugPair[] {
  return pairs.filter(([a, b]) => a !== l && b !== l)
}

/**
 * Toggles a cable between a and b:
 * - if a and b are connected to each other → the cable is removed;
 * - if a === b → any cable on a is removed;
 * - otherwise existing cables on a and/or b are removed and a–b is connected.
 * When connecting would exceed MAX_PLUGS cables, the pairs are returned unchanged.
 */
export function togglePlug(pairs: readonly PlugPair[], a: Letter, b: Letter): PlugPair[] {
  if (a === b) return unplug(pairs, a)
  if (partnerOf(pairs, a) === b) return unplug(pairs, a)
  const rest = unplug(unplug(pairs, a), b)
  if (rest.length >= MAX_PLUGS) return pairs.slice()
  return [...rest, [a, b]]
}
