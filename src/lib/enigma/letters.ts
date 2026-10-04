import type { Letter } from './types'

const CODE_A = 65
const CODE_Z = 90
const CODE_LOWER_A = 97
const CODE_LOWER_Z = 122

/** Euclidean modulo 26 (always returns 0..25, also for negative input). */
export function mod26(n: number): number {
  return ((n % 26) + 26) % 26
}

/**
 * Converts a single character (A–Z, case-insensitive) to a Letter (A = 0).
 * Returns null for anything else, including multi-character strings such as "Enter".
 */
export function toLetter(ch: string): Letter | null {
  if (ch.length !== 1) return null
  const code = ch.charCodeAt(0)
  if (code >= CODE_A && code <= CODE_Z) return code - CODE_A
  if (code >= CODE_LOWER_A && code <= CODE_LOWER_Z) return code - CODE_LOWER_A
  return null
}

/** Converts a Letter (0..25, wrapped with mod 26) to its uppercase character. */
export function toChar(l: Letter): string {
  return String.fromCharCode(CODE_A + mod26(l))
}

/** Converts a string of letters to Letter values, skipping every non A–Z character. */
export function lettersOf(text: string): Letter[] {
  const out: Letter[] = []
  for (let i = 0; i < text.length; i++) {
    const l = toLetter(text[i])
    if (l !== null) out.push(l)
  }
  return out
}

/** Converts Letter values back to an uppercase string. */
export function lettersToString(letters: readonly Letter[]): string {
  let s = ''
  for (const l of letters) s += toChar(l)
  return s
}

/** Formats a ring setting (0..25) as a two-digit number "01".."26". */
export function formatRing(n: number): string {
  return String(mod26(n) + 1).padStart(2, '0')
}

/** Formats a ring setting either as "01".."26" or as a letter "A".."Z". */
export function ringLabel(n: number, mode: 'number' | 'letter'): string {
  return mode === 'number' ? formatRing(n) : toChar(n)
}
