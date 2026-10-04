/**
 * Dictionary check (phase 4 'words'): segments a letters-only plaintext into dictionary words
 * by dynamic programming and reports how much of it reads as words, tolerating typos.
 *
 * - Exact words come from a trie walk from every position (2-letter words count only next to
 *   longer words, i.e. between them or between one and the text start / end; 1-letter words
 *   never).
 * - X is accepted as a word separator (Enigma operators wrote X for spaces and full stops); it
 *   counts as covered when it sits between two words.
 * - German: Q is accepted for CH (Kriegsmarine convention), via dictionary variants.
 * - Fuzzy words (only when at least FUZZY_MIN_COVERAGE of the text already reads as exact words,
 *   so random text stays low): a word of length L ≥ 4 may match with edit distance ≤
 *   min(3, floor(L × typoTolerance)) (substitution, insertion, deletion). Candidates come from a
 *   pigeonhole index — a word with k edits keeps one of its k + 1 pieces intact near its place —
 *   and are verified with a Levenshtein DP; only positions next to uncovered letters are probed.
 */
import type { BreakerLanguage, BreakerWords } from './types'

export interface WordsResult extends BreakerWords {
  /** Coverage by exact matches only (no typos allowed). */
  exactCoverage: number
}

export interface WordDictionary {
  language: BreakerLanguage
  /** Number of distinct words (including Q-for-CH variants). */
  size: number
  maxLength: number
  /** Edge hash table: key = node * 32 + letter + 1 (0 = empty), value = child node. */
  edgeKeys: Int32Array
  edgeVals: Int32Array
  edgeMask: number
  /** Word id + 1 ending at a trie node (0 = none). */
  terminal: Int32Array
  words: string[]
  /** Pigeonhole indexes per maximum-edits function (keyed by typo tolerance). */
  fuzzy: Map<number, Map<number, number[]>>
}

export const DEFAULT_TYPO_TOLERANCE = 0.2
export const MAX_TYPO_TOLERANCE = 0.34
const MAX_EDITS = 3
/** Fuzzy matching only repairs text that already mostly reads as words. */
const FUZZY_MIN_COVERAGE = 0.3
const EDIT_PENALTY = 1.5
const SEPARATOR_WEIGHT = 0.2
/** Longest word considered for fuzzy matching. */
const MAX_FUZZY_LENGTH = 24
/** Pieces are compared on at most this many letters (keeps the numeric key below 2^53). */
const MAX_PIECE = 9

/** Numeric key of piece p (letters text[at, at + len)) of words of length L. */
function pieceKey(L: number, p: number, text: string, at: number, len: number): number {
  let code = 0
  const m = len < MAX_PIECE ? len : MAX_PIECE
  for (let i = 0; i < m; i++) code = code * 27 + (text.charCodeAt(at + i) - 64)
  return (L * 4 + p) * 7625597484987 + code
}

function hashEdge(key: number, mask: number): number {
  return Math.imul(key, 0x9e3779b1) >>> 0 & mask
}

/** Builds a dictionary from words (one per line / whitespace separated, any case). */
export function parseDictionary(text: string, language: BreakerLanguage): WordDictionary {
  const set = new Set<string>()
  for (const raw of text.split(/\s+/)) {
    const w = raw.toUpperCase().replace(/[^A-Z]/g, '')
    if (w.length < 2) continue
    set.add(w)
    if (language === 'de' && w.includes('CH')) set.add(w.replace(/CH/g, 'Q'))
  }
  const words = [...set]
  let letters = 0
  let maxLength = 0
  for (const w of words) {
    letters += w.length
    if (w.length > maxLength) maxLength = w.length
  }
  let size = 1
  while (size < letters * 2) size *= 2
  const edgeKeys = new Int32Array(size)
  const edgeVals = new Int32Array(size)
  const mask = size - 1
  const terminal: number[] = [0]
  let nodes = 1
  words.forEach((w, id) => {
    let node = 0
    for (let i = 0; i < w.length; i++) {
      const key = node * 32 + (w.charCodeAt(i) - 64)
      let h = hashEdge(key, mask)
      while (edgeKeys[h] !== 0 && edgeKeys[h] !== key) h = (h + 1) & mask
      if (edgeKeys[h] === 0) {
        edgeKeys[h] = key
        edgeVals[h] = nodes++
        terminal.push(0)
      }
      node = edgeVals[h]
    }
    terminal[node] = id + 1
  })
  return {
    language,
    size: words.length,
    maxLength,
    edgeKeys,
    edgeVals,
    edgeMask: mask,
    terminal: Int32Array.from(terminal),
    words,
    fuzzy: new Map(),
  }
}

function child(d: WordDictionary, node: number, letter: number): number {
  const key = node * 32 + letter + 1
  const mask = d.edgeMask
  let h = hashEdge(key, mask)
  for (;;) {
    const k = d.edgeKeys[h]
    if (k === key) return d.edgeVals[h]
    if (k === 0) return -1
    h = (h + 1) & mask
  }
}

/** Maximum edits allowed for a word of length L. */
export function maxEdits(length: number, tolerance: number): number {
  if (length < 4 || tolerance <= 0) return 0
  return Math.min(MAX_EDITS, Math.floor(length * Math.min(tolerance, MAX_TYPO_TOLERANCE) + 1e-9))
}

/** Piece boundaries of a word of length L split into k + 1 pieces. */
function pieces(length: number, k: number): [number, number][] {
  const out: [number, number][] = []
  for (let p = 0; p <= k; p++) {
    const a = Math.round((p * length) / (k + 1))
    const b = Math.round(((p + 1) * length) / (k + 1))
    out.push([a, b])
  }
  return out
}

function fuzzyIndex(d: WordDictionary, tolerance: number): Map<number, number[]> {
  const key = Math.round(tolerance * 1000)
  let index = d.fuzzy.get(key)
  if (index) return index
  index = new Map()
  d.words.forEach((w, id) => {
    const k = maxEdits(w.length, tolerance)
    if (k === 0 || w.length > MAX_FUZZY_LENGTH) return
    pieces(w.length, k).forEach(([a, b], p) => {
      const pk = pieceKey(w.length, p, w, a, b - a)
      const list = index!.get(pk)
      if (list) list.push(id)
      else index!.set(pk, [id])
    })
  })
  d.fuzzy.set(key, index)
  return index
}

/** DP weight of a word of length L. Longer words are worth more than their letters. */
function weight(length: number): number {
  if (length <= 2) return 1.5
  return length - 0.5 + 0.05 * (length - 3) * (length - 3)
}

interface Match {
  start: number
  end: number
  wordLength: number
  edits: number
}

/** Levenshtein distances between `word` and text[s, s + m) for every m ≤ maxLen (last DP row). */
function distancesFrom(word: string, text: string, s: number, maxLen: number, row: Int32Array, prev: Int32Array): Int32Array {
  for (let m = 0; m <= maxLen; m++) prev[m] = m
  for (let i = 1; i <= word.length; i++) {
    row[0] = i
    const wc = word.charCodeAt(i - 1)
    for (let m = 1; m <= maxLen; m++) {
      const sub = prev[m - 1] + (text.charCodeAt(s + m - 1) === wc ? 0 : 1)
      const del = prev[m] + 1
      const ins = row[m - 1] + 1
      row[m] = sub < del ? (sub < ins ? sub : ins) : del < ins ? del : ins
    }
    for (let m = 0; m <= maxLen; m++) prev[m] = row[m]
  }
  return prev
}

interface Segmentation {
  kind: Uint8Array // per segment end position: 0 skip, 1 word, 2 separator
  from: Int32Array
  matchEdits: Int32Array
}

function segment(text: string, d: WordDictionary, fuzzy: Match[][] | null): Segmentation {
  const n = text.length
  const best = new Float64Array(n + 1).fill(-Infinity)
  const from = new Int32Array(n + 1).fill(-1)
  const kind = new Uint8Array(n + 1)
  const matchEdits = new Int32Array(n + 1)
  best[0] = 0
  const relax = (i: number, j: number, value: number, k: number, edits: number): void => {
    if (value > best[j]) {
      best[j] = value
      from[j] = i
      kind[j] = k
      matchEdits[j] = edits
    }
  }
  for (let i = 0; i < n; i++) {
    const base = best[i]
    relax(i, i + 1, base, 0, 0)
    if (text.charCodeAt(i) === 88) relax(i, i + 1, base + SEPARATOR_WEIGHT, 2, 0)
    let node = 0
    const limit = Math.min(n, i + d.maxLength)
    for (let j = i; j < limit; j++) {
      node = child(d, node, text.charCodeAt(j) - 65)
      if (node < 0) break
      if (d.terminal[node] !== 0) relax(i, j + 1, base + weight(j - i + 1), 1, 0)
    }
    if (fuzzy) {
      for (const m of fuzzy[i]) relax(i, m.end, base + weight(m.end - m.start) - EDIT_PENALTY * m.edits, 1, m.edits)
    }
  }
  return { kind, from, matchEdits }
}

interface Piece {
  start: number
  end: number
  kind: number
  edits: number
}

function piecesOf(seg: Segmentation, n: number): Piece[] {
  const out: Piece[] = []
  for (let j = n; j > 0; ) {
    const i = seg.from[j]
    out.push({ start: i, end: j, kind: seg.kind[j], edits: seg.matchEdits[j] })
    j = i
  }
  return out.reverse()
}

/** Covered letters per piece: words of 3+ letters; 2-letter words and X only between words. */
function coveredFlags(ps: Piece[]): boolean[] {
  const isWord = (p: Piece | undefined): boolean => !!p && p.kind === 1 && p.end - p.start >= 3
  return ps.map((p, i) => {
    if (p.kind === 0) return false
    if (isWord(p)) return true
    // Short word or separator: needs a (long) word or separator chain on both sides.
    let l = i - 1
    while (l >= 0 && ps[l].kind !== 0 && !isWord(ps[l])) l--
    let r = i + 1
    while (r < ps.length && ps[r].kind !== 0 && !isWord(ps[r])) r++
    // The text start / end counts as a word boundary, but not on both sides at once.
    const left = l < 0 || isWord(ps[l])
    const right = r >= ps.length || isWord(ps[r])
    return left && right && (l >= 0 || r < ps.length)
  })
}

function coverageOf(ps: Piece[], flags: boolean[], n: number): number {
  let covered = 0
  ps.forEach((p, i) => {
    if (flags[i]) covered += p.end - p.start
  })
  return n > 0 ? covered / n : 0
}

/** Share of letters covered by exact dictionary words (fast; used inside hill climbs). */
export function exactCoverage(plaintext: string, d: WordDictionary): number {
  const ps = piecesOf(segment(plaintext, d, null), plaintext.length)
  return coverageOf(ps, coveredFlags(ps), plaintext.length)
}

function fuzzyMatches(text: string, d: WordDictionary, tolerance: number, ps: Piece[], flags: boolean[]): Match[][] {
  const n = text.length
  const out: Match[][] = Array.from({ length: n }, () => [])
  const index = fuzzyIndex(d, tolerance)
  // Start positions next to uncovered letters.
  const starts = new Set<number>()
  ps.forEach((p, i) => {
    if (flags[i]) return
    for (let s = Math.max(0, p.start - MAX_EDITS); s < p.end; s++) starts.add(s)
    // A broken word may begin inside the words matched just before the gap.
    for (let back = 1; back <= 2 && i - back >= 0; back++) starts.add(ps[i - back].start)
  })
  const maxLen = MAX_FUZZY_LENGTH + MAX_EDITS
  const row = new Int32Array(maxLen + 1)
  const prev = new Int32Array(maxLen + 1)
  for (const s of starts) {
    const seen = new Set<number>()
    for (let L = 4; L <= Math.min(d.maxLength, MAX_FUZZY_LENGTH); L++) {
      const k = maxEdits(L, tolerance)
      if (k === 0 || s + L - k > n) continue
      const parts = pieces(L, k)
      for (let p = 0; p < parts.length; p++) {
        const [a, b] = parts[p]
        for (let shift = -k; shift <= k; shift++) {
          const at = s + a + shift
          if (at < s || at + (b - a) > n) continue
          const list = index.get(pieceKey(L, p, text, at, b - a))
          if (!list) continue
          for (const id of list) {
            if (seen.has(id)) continue
            seen.add(id)
            const word = d.words[id]
            const span = Math.min(n - s, L + k)
            const dist = distancesFrom(word, text, s, span, row, prev)
            let bestM = -1
            let bestD = k + 1
            for (let m = Math.max(1, L - k); m <= span; m++) {
              if (dist[m] < bestD || (dist[m] === bestD && bestM >= 0 && Math.abs(m - L) < Math.abs(bestM - L))) {
                bestD = dist[m]
                bestM = m
              }
            }
            if (bestM > 0 && bestD >= 1 && bestD <= k) out[s].push({ start: s, end: s + bestM, wordLength: L, edits: bestD })
          }
        }
      }
    }
  }
  return out
}

/**
 * Segments a letters-only plaintext into dictionary words (see the module comment).
 * typoTolerance: allowed edits per letter of a word (0 = exact only, max 0.34).
 */
export function scoreWords(
  plaintext: string,
  dictionary: WordDictionary,
  typoTolerance: number = DEFAULT_TYPO_TOLERANCE,
): WordsResult {
  const text = plaintext.toUpperCase().replace(/[^A-Z]/g, '')
  const n = text.length
  if (n === 0) return { coverage: 0, exactCoverage: 0, segmented: '', matched: 0, typos: 0 }
  const tol = Math.max(0, Math.min(MAX_TYPO_TOLERANCE, Number.isFinite(typoTolerance) ? typoTolerance : 0))
  let ps = piecesOf(segment(text, dictionary, null), n)
  let flags = coveredFlags(ps)
  let coverage = coverageOf(ps, flags, n)
  const exactCoverage = coverage
  if (tol > 0 && coverage >= FUZZY_MIN_COVERAGE && coverage < 1) {
    const fuzzy = fuzzyMatches(text, dictionary, tol, ps, flags)
    ps = piecesOf(segment(text, dictionary, fuzzy), n)
    flags = coveredFlags(ps)
    coverage = coverageOf(ps, flags, n)
  }
  const tokens: string[] = []
  let run = ''
  let matched = 0
  let typos = 0
  ps.forEach((p, i) => {
    const s = text.slice(p.start, p.end)
    if (p.kind === 1 && (flags[i] || p.end - p.start >= 3)) {
      if (run) tokens.push(run)
      run = ''
      tokens.push(s)
      matched++
      typos += p.edits
    } else if (p.kind === 2 && flags[i]) {
      if (run) tokens.push(run)
      run = ''
      tokens.push(s)
    } else {
      run += s
    }
  })
  if (run) tokens.push(run)
  return { coverage, exactCoverage, segmented: tokens.join(' '), matched, typos }
}
