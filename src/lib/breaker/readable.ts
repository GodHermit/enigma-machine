/**
 * Word splitting for the "Readable" plaintext view (display only; the codebreaker's scoring uses
 * words.ts).
 *
 * The letters are split into the most probable sequence of words, Viterbi-style: a word of
 * frequency rank r costs log((r + 1) · ln N) (Zipf's law, as in Norvig's / wordninja's
 * segmenters), so common words win over rare ones ("PULL A", not "P ULLA"). Unlike the scoring
 * dictionary, one-letter words (English A and I) are allowed. A letter that starts no known word
 * costs a little more than the rarest word and is kept with its unknown neighbours as one
 * fragment. X may stand for a space or full stop (Enigma convention) and is then dropped; German
 * words also match with Q for CH (Kriegsmarine convention).
 *
 * Word lists: src/lib/breaker/data/readable-*.txt (scripts/build-readable-words.mjs).
 */
import type { BreakerLanguage } from './types'

export interface ReadableDictionary {
  language: BreakerLanguage
  /** Cost of each word (A–Z, uppercase). */
  costs: Map<string, number>
  maxLength: number
  /** Cost of one letter that belongs to no word. */
  unknownCost: number
  /** Cost of reading an X as a word separator. */
  separatorCost: number
}

/** Extra cost of a German word written with Q for CH. */
const Q_VARIANT_COST = 1
/** Separator X costs as much as a word of this rank: cheap in German radio traffic, rarer in English. */
const SEPARATOR_RANK: Record<BreakerLanguage, number> = { de: 10, en: 50 }

/** Builds the dictionary from a word list (most frequent first, one word per line). */
export function parseReadableWords(text: string, language: BreakerLanguage): ReadableDictionary {
  const words = text.split('\n').map((w) => w.trim()).filter((w) => /^[A-Z]+$/.test(w))
  const n = Math.max(2, words.length)
  const logN = Math.log(n)
  const rankCost = (rank: number) => Math.log((rank + 1) * logN)
  const costs = new Map<string, number>()
  let maxLength = 1
  const add = (word: string, cost: number) => {
    const known = costs.get(word)
    if (known === undefined || cost < known) costs.set(word, cost)
    if (word.length > maxLength) maxLength = word.length
  }
  words.forEach((word, rank) => {
    const cost = rankCost(rank)
    add(word, cost)
    if (language === 'de' && word.includes('CH')) add(word.replaceAll('CH', 'Q'), cost + Q_VARIANT_COST)
  })
  const unknownCost = rankCost(n) + 1
  return {
    language,
    costs,
    maxLength,
    unknownCost,
    // Always cheaper than an unknown letter, also for small word lists.
    separatorCost: Math.min(rankCost(SEPARATOR_RANK[language]), unknownCost - 1),
  }
}

const WORD = 0
const UNKNOWN = 1
const SEPARATOR = 2

/**
 * Splits letters (A–Z) into words. Returns the tokens in order: words, unknown fragments (runs
 * of letters that form no word) — separator X's are left out.
 */
export function splitReadable(letters: string, dict: ReadableDictionary): string[] {
  const n = letters.length
  const best = new Float64Array(n + 1).fill(Infinity)
  const from = new Int32Array(n + 1)
  const kind = new Uint8Array(n + 1)
  best[0] = 0
  for (let i = 0; i < n; i++) {
    const base = best[i]
    if (base === Infinity) continue
    const relax = (end: number, cost: number, k: number) => {
      if (base + cost < best[end]) {
        best[end] = base + cost
        from[end] = i
        kind[end] = k
      }
    }
    relax(i + 1, dict.unknownCost, UNKNOWN)
    if (letters[i] === 'X') relax(i + 1, dict.separatorCost, SEPARATOR)
    const limit = Math.min(n, i + dict.maxLength)
    for (let end = i + 1; end <= limit; end++) {
      const cost = dict.costs.get(letters.slice(i, end))
      if (cost !== undefined) relax(end, cost, WORD)
    }
  }

  const steps: { start: number; end: number; kind: number }[] = []
  for (let end = n; end > 0; end = from[end]) steps.push({ start: from[end], end, kind: kind[end] })
  steps.reverse()

  const tokens: string[] = []
  let fragment = ''
  const flush = () => {
    if (fragment) tokens.push(fragment)
    fragment = ''
  }
  for (const step of steps) {
    if (step.kind === UNKNOWN) {
      fragment += letters.slice(step.start, step.end)
      continue
    }
    flush()
    if (step.kind === WORD) tokens.push(letters.slice(step.start, step.end))
  }
  flush()
  return tokens
}

/** The letters as readable text: words separated by spaces. */
export function readableText(letters: string, dict: ReadableDictionary): string {
  return splitReadable(letters, dict).join(' ')
}
