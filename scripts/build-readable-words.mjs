#!/usr/bin/env node
/**
 * Regenerates the word lists of the "Readable" plaintext view:
 *
 *   node scripts/build-readable-words.mjs
 *
 * Downloads the FrequencyWords lists (Hermit Dave, OpenSubtitles 2018, CC BY-SA 4.0; cached
 * under node_modules/.cache/enigma-readable), transliterates them like the codebreaker data
 * (Ä→AE, Ö→OE, Ü→UE, ß→SS, other accents stripped, A–Z only) and merges in the codebreaker's
 * own word lists (words-de.txt / words-en.txt: literary words and the German military
 * vocabulary that subtitles lack). Writes
 *
 *   src/lib/breaker/data/readable-de.txt, readable-en.txt
 *     words, most frequent first, one per line (the rank sets a word's cost when splitting).
 *
 * Subtitles are noisy in short tokens ("uh", "ok", "mm", contraction pieces such as "didn"), so
 * words of up to 3 letters are kept only when the book lists know them too; the only one-letter
 * words are English A and I.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, 'node_modules', '.cache', 'enigma-readable')
const DATA = join(ROOT, 'src', 'lib', 'breaker', 'data')
const SOURCE = (lang) => `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/${lang}/${lang}_50k.txt`

const SINGLE_LETTERS = { en: ['A', 'I'], de: [] }
/** Rank given to the German military vocabulary (MILITARY_DE of build-ngrams.mjs): fairly common in radio traffic. */
const MILITARY_RANK = 3000
/** Subtitle tokenisation splits "don't" into "don" + "'t": rebuild the joined forms Enigma text has. */
const EN_NOT_STEMS = ['DON', 'DIDN', 'DOESN', 'ISN', 'WASN', 'AREN', 'WEREN', 'COULDN', 'WOULDN', 'SHOULDN', 'HAVEN', 'HASN', 'HADN', 'MUSTN', 'NEEDN', 'AIN']
/** Stems that are words on their own. */
const EN_REAL_STEMS = new Set(['DON', 'HAVEN'])
const EN_CONTRACTIONS = { IM: 'I', IVE: 'I', YOURE: 'YOU', THEYRE: 'THEY', THATS: 'THAT', WHATS: 'WHAT', LETS: 'LET' }

function transliterate(word) {
  return word
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
}

async function frequencyWords(lang) {
  const file = join(CACHE, `${lang}_50k.txt`)
  try {
    return await readFile(file, 'utf8')
  } catch {
    const res = await fetch(SOURCE(lang))
    if (!res.ok) throw new Error(`Could not download ${SOURCE(lang)} (HTTP ${res.status})`)
    const text = await res.text()
    await mkdir(CACHE, { recursive: true })
    await writeFile(file, text)
    return text
  }
}

/** The military word list, read from the codebreaker's build script (single source of truth). */
async function militaryWords() {
  const script = await readFile(join(ROOT, 'scripts', 'build-ngrams.mjs'), 'utf8')
  const list = /const MILITARY_DE = `([^`]*)`/.exec(script)?.[1]
  if (!list) throw new Error('MILITARY_DE not found in scripts/build-ngrams.mjs')
  return list.split(/\s+/).filter(Boolean)
}

async function build(lang) {
  const books = (await readFile(join(DATA, `words-${lang}.txt`), 'utf8')).split('\n').filter(Boolean)
  const known = new Set(books)

  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const line of (await frequencyWords(lang)).split('\n')) {
    const [raw, n] = line.trim().split(' ')
    if (!raw || !n) continue
    const word = transliterate(raw)
    if (!/^[A-Z]+$/.test(word)) continue
    if (word.length === 1 ? !SINGLE_LETTERS[lang].includes(word) : word.length <= 3 && !known.has(word)) continue
    counts.set(word, (counts.get(word) ?? 0) + Number(n))
  }

  if (lang === 'en') {
    // Raw stems before the 2–3 letter filter dropped them ("isn" is not in the books).
    const raw = new Map()
    for (const line of (await frequencyWords(lang)).split('\n')) {
      const [w, n] = line.trim().split(' ')
      if (w && n) raw.set(w.toUpperCase(), Number(n))
    }
    for (const stem of EN_NOT_STEMS) {
      const n = raw.get(stem)
      if (!n) continue
      counts.set(`${stem}T`, Math.max(counts.get(`${stem}T`) ?? 0, n))
      // Pieces that are not words on their own ("DIDN", "ISN"; the book lists have them too).
      if (!EN_REAL_STEMS.has(stem)) counts.delete(stem)
    }
    for (const [word, base] of Object.entries(EN_CONTRACTIONS)) {
      const n = raw.get(base.toUpperCase()) ?? counts.get(base)
      if (n) counts.set(word, Math.max(counts.get(word) ?? 0, Math.round(n * 0.05)))
    }
  }

  // Book words the subtitles lack get the count of the subtitle word at the same relative rank.
  const curve = [...counts.values()].sort((a, b) => b - a)
  books.forEach((word, rank) => {
    if (counts.has(word) || (lang === 'en' && EN_NOT_STEMS.includes(word) && !EN_REAL_STEMS.has(word))) return
    const at = Math.min(curve.length - 1, Math.floor((rank / books.length) * curve.length))
    counts.set(word, curve[at])
  })

  // Military radio vocabulary: at least as common as MILITARY_RANK.
  if (lang === 'de') {
    const atRank = curve[Math.min(curve.length - 1, MILITARY_RANK)]
    for (const word of await militaryWords()) counts.set(word, Math.max(counts.get(word) ?? 0, atRank))
  }

  const words = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([w]) => w)
  await writeFile(join(DATA, `readable-${lang}.txt`), words.join('\n') + '\n')
  console.log(`readable-${lang}.txt: ${words.length} words`)
}

for (const lang of ['de', 'en']) await build(lang)
