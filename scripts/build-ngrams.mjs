#!/usr/bin/env node
/**
 * Regenerates the codebreaker's language statistics and sample passages:
 *
 *   node scripts/build-ngrams.mjs
 *
 * Downloads public-domain books from Project Gutenberg (cached under
 * node_modules/.cache/enigma-ngrams), strips the Gutenberg header/footer, transliterates
 * (Ä→AE, Ö→OE, Ü→UE, ß→SS, other accents stripped), keeps A–Z only and writes
 *
 *   src/lib/breaker/data/ngrams-de.bin, ngrams-en.bin
 *     "NGR1" + 6 × float32 (floor, step for bigrams / trigrams / quadgrams)
 *     + 26² + 26³ + 26⁴ Uint8 quantised log10 probabilities (q = round((log10 p − floor) / step)),
 *   src/lib/breaker/data/passages.ts
 *     ~450-letter passages from held-out books (not used for the statistics) for the
 *     "Try an example" button and the accuracy benchmark,
 *   src/lib/breaker/data/words-de.txt, words-en.txt
 *     the WORD_COUNT most frequent words (2+ letters, transliterated, A–Z) of the same
 *     training books, most frequent first, one per line; German adds Enigma / military
 *     vocabulary (MILITARY_DE) that 19th-century novels lack.
 *
 * Military flavour for German: Enigma operators wrote X for a full stop, so sentence ends
 * are written as X in the German training text.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, 'node_modules', '.cache', 'enigma-ngrams')
const OUT = join(ROOT, 'src', 'lib', 'breaker', 'data')

/** role 'train' → n-gram statistics, 'passages' → held-out sample passages. */
const BOOKS = [
  { id: 2407, lang: 'de', role: 'train', source: 'Goethe, Die Leiden des jungen Werther' },
  { id: 2403, lang: 'de', role: 'train', source: 'Goethe, Die Wahlverwandtschaften' },
  { id: 2404, lang: 'de', role: 'train', source: 'Goethe, Italienische Reise' },
  { id: 34811, lang: 'de', role: 'train', source: 'Thomas Mann, Buddenbrooks' },
  { id: 5323, lang: 'de', role: 'train', source: 'Fontane, Effi Briest' },
  { id: 69327, lang: 'de', role: 'train', source: 'Kafka, Der Prozess' },
  { id: 47804, lang: 'de', role: 'train', source: 'Schiller, Die Räuber' },
  { id: 7205, lang: 'de', role: 'train', source: 'Nietzsche, Also sprach Zarathustra' },
  { id: 35312, lang: 'de', role: 'train', source: 'Eichendorff, Aus dem Leben eines Taugenichts' },
  { id: 22367, lang: 'de', role: 'passages', source: 'Kafka, Die Verwandlung' },
  { id: 6640, lang: 'de', role: 'passages', source: 'Hauff, Märchen-Almanach auf das Jahr 1828' },
  { id: 1342, lang: 'en', role: 'train', source: 'Austen, Pride and Prejudice' },
  { id: 1661, lang: 'en', role: 'train', source: 'Doyle, The Adventures of Sherlock Holmes' },
  { id: 98, lang: 'en', role: 'train', source: 'Dickens, A Tale of Two Cities' },
  { id: 2701, lang: 'en', role: 'train', source: 'Melville, Moby Dick' },
  { id: 36, lang: 'en', role: 'train', source: 'Wells, The War of the Worlds' },
  { id: 1946, lang: 'en', role: 'train', source: 'Clausewitz, On War' },
  { id: 345, lang: 'en', role: 'train', source: 'Stoker, Dracula' },
  { id: 2852, lang: 'en', role: 'passages', source: 'Doyle, The Hound of the Baskervilles' },
  { id: 120, lang: 'en', role: 'passages', source: 'Stevenson, Treasure Island' },
]

const MIRRORS = [
  (id) => `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
  (id) => `https://gutenberg.pglaf.org/cache/epub/${id}/pg${id}.txt`,
  (id) => `https://aleph.pglaf.org/cache/epub/${id}/pg${id}.txt`,
]

const WORD_COUNT = 20000
/** Minimum corpus frequency of a listed word (keeps out typos and one-off names). */
const MIN_WORD_COUNT = 3

/** Enigma radio-message vocabulary (German Army / Navy conventions; UBOOT for U-Boot). */
const MILITARY_DE = `
NULL EINS ZWO ZWEI DREI VIER FUENF SECHS SIEBEN ACHT NEUN ZEHN ELF ZWOELF ZWANZIG DREISSIG
VIERZIG FUENFZIG HUNDERT TAUSEND ERSTE ZWEITE DRITTE VIERTE ERSTEN ZWEITEN DRITTEN
OBERKOMMANDO WEHRMACHT HEER KRIEGSMARINE LUFTWAFFE MARINE FUNKSPRUCH FUNKSPRUECHE FUNK FUNKER
FUNKSTELLE FUNKVERKEHR SPRUCH KOMMANDEUR KOMMANDANT KOMMANDO KOMMANDOS BEFEHLSHABER BEFEHL BEFEHLE
ANGRIFF ANGRIFFE GEGENANGRIFF GEGENSTOSS DURCHBRUCH VORMARSCH RUECKZUG ABWEHR VERTEIDIGUNG
DIVISION DIVISIONEN PANZERDIVISION INFANTERIEDIVISION REGIMENT REGIMENTER BATAILLON KOMPANIE
BATTERIE ZUG STAB STAEBE KORPS ARMEEKORPS ARMEE ARMEEN HEERESGRUPPE GRUPPE PANZERGRUPPE FLOTTE
FLOTTILLE UBOOT UBOOTE BOOT BOOTE SCHIFF SCHIFFE ZERSTOERER KREUZER SCHLACHTSCHIFF GELEITZUG
KONVOI DAMPFER TANKER TORPEDO TORPEDOS VERSENKT TONNEN BRT WABO WASSERBOMBEN
WETTER WETTERBERICHT WETTERLAGE BERICHT BERICHTE LAGE LAGEBERICHT MELDUNG MELDUNGEN MELDET
KEINE KEIN BESONDERE BESONDEREN EREIGNISSE EREIGNIS STOP ENDE ANFANG
FEIND FEINDE FEINDLICH FEINDLICHE FEINDLICHEN GEGNER KAMPF KAEMPFE FRONT STELLUNG STELLUNGEN
TRUPPEN TRUPPE PANZER INFANTERIE ARTILLERIE PIONIERE FLAK GESCHUETZ GESCHUETZE MUNITION
VERSORGUNG NACHSCHUB BETRIEBSSTOFF VERLUSTE GEFANGENE GEFALLEN VERWUNDET TOTE ABSCHNITT RAUM
HOEHE BRUECKE BRUECKENKOPF STRASSE BAHNHOF HAFEN FLUGPLATZ FLUGZEUG FLUGZEUGE BOMBER JAEGER
AUFKLAERUNG EINSATZ BEREIT BEREITSCHAFT EINGESCHLOSSEN UMGEHEND SOFORT DRINGEND ERBITTE ERBETEN
GENERAL GENERALOBERST FELDMARSCHALL OBERST OBERSTLEUTNANT MAJOR HAUPTMANN OBERLEUTNANT LEUTNANT
FELDWEBEL UNTEROFFIZIER GEFREITER SOLDAT SOLDATEN OFFIZIER OFFIZIERE KAPITAEN KAPITAENLEUTNANT
ADMIRAL KORVETTENKAPITAEN FREGATTENKAPITAEN FUEHRER FUEHRERHAUPTQUARTIER HAUPTQUARTIER
GEHEIM GEHEIME KOMMANDOSACHE CHEFSACHE SCHLUESSEL SCHLUESSELMASCHINE ENIGMA
NORD SUED OST WEST NORDOST NORDWEST SUEDOST SUEDWEST NORDEN SUEDEN OSTEN WESTEN RICHTUNG
KILOMETER METER SEEMEILEN QUADRAT PLANQUADRAT POSITION STANDORT KURS FAHRT KNOTEN UHR
SICHT WIND WINDSTAERKE STAERKE BEWOELKT BEDECKT REGEN SCHNEE NEBEL SEEGANG DUENUNG TEMPERATUR
GRAD BAROMETER LUFTDRUCK MILLIBAR KLAR HEITER
MORGEN MORGENS ABEND ABENDS NACHT NACHTS TAG TAGE HEUTE GESTERN MONTAG DIENSTAG MITTWOCH
DONNERSTAG FREITAG SAMSTAG SONNABEND SONNTAG JANUAR FEBRUAR MAERZ APRIL MAI JUNI JULI AUGUST
SEPTEMBER OKTOBER NOVEMBER DEZEMBER ANKUNFT ABFAHRT EINGETROFFEN EINGANG AUSGANG
`

const PASSAGES_PER_BOOK = 8
const PASSAGE_LETTERS = 450

async function download(id) {
  const file = join(CACHE, `pg${id}.txt`)
  try {
    return await readFile(file, 'utf8')
  } catch {
    // not cached yet
  }
  const errors = []
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url(id), { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      if (text.length < 10_000) throw new Error('suspiciously short')
      await mkdir(CACHE, { recursive: true })
      await writeFile(file, text)
      console.log(`downloaded ${url(id)} (${text.length} chars)`)
      return text
    } catch (error) {
      errors.push(`${url(id)}: ${error.message}`)
    }
  }
  throw new Error(`could not download book ${id}:\n  ${errors.join('\n  ')}`)
}

function stripGutenberg(raw) {
  const text = raw.replace(/\r/g, '')
  const start = text.search(/\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG E(BOOK|TEXT)[^\n]*\n/i)
  const end = text.search(/\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG E(BOOK|TEXT)/i)
  if (start < 0 || end < 0) throw new Error('Gutenberg header/footer not found')
  const body = text.slice(text.indexOf('\n', start) + 1, end)
  // Drop bracketed transcriber notes / illustrations.
  return body.replace(/\[[^\]]{0,400}\]/g, ' ')
}

/** Ä→AE, Ö→OE, Ü→UE, ß→SS, other accents stripped (keeps punctuation and spacing). */
export function transliterate(text) {
  return text
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'Ae')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'Oe')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

function lettersOf(text) {
  return text.toUpperCase().replace(/[^A-Z]/g, '')
}

/** Training letters of a book; German sentence ends become X (Enigma operators' full stop). */
function trainingLetters(body, lang) {
  let t = transliterate(body)
  if (lang === 'de') t = t.replace(/[.!?]+(?=\s)/g, ' X ')
  return lettersOf(t)
}

function countNgrams(streams) {
  const bi = new Float64Array(26 ** 2)
  const tri = new Float64Array(26 ** 3)
  const quad = new Float64Array(26 ** 4)
  for (const s of streams) {
    const codes = Uint8Array.from(s, (ch) => ch.charCodeAt(0) - 65)
    for (let i = 0; i + 1 < codes.length; i++) {
      const b = codes[i] * 26 + codes[i + 1]
      bi[b]++
      if (i + 2 < codes.length) {
        const t = b * 26 + codes[i + 2]
        tri[t]++
        if (i + 3 < codes.length) quad[t * 26 + codes[i + 3]]++
      }
    }
  }
  return [bi, tri, quad]
}

/**
 * Quantises log10 probabilities to 0..255. Unseen n-grams get log10(0.01 / total) (the floor);
 * the top of the scale is the most frequent n-gram.
 */
function quantise(counts) {
  let total = 0
  let max = 0
  for (const c of counts) {
    total += c
    if (c > max) max = c
  }
  const floor = Math.log10(0.01 / total)
  const top = Math.log10(max / total)
  const step = (top - floor) / 255
  const q = new Uint8Array(counts.length)
  for (let i = 0; i < counts.length; i++) {
    const lp = counts[i] > 0 ? Math.log10(counts[i] / total) : floor
    q[i] = Math.max(0, Math.min(255, Math.round((lp - floor) / step)))
  }
  return { q, floor, step, total }
}

function encodeTables(tables) {
  const header = new ArrayBuffer(4 + 6 * 4)
  const view = new DataView(header)
  'NGR1'.split('').forEach((ch, i) => view.setUint8(i, ch.charCodeAt(0)))
  tables.forEach((t, i) => {
    view.setFloat32(4 + i * 8, t.floor, true)
    view.setFloat32(8 + i * 8, t.step, true)
  })
  return Buffer.concat([Buffer.from(header), ...tables.map((t) => Buffer.from(t.q))])
}

/** Passages of whole sentences, ~PASSAGE_LETTERS letters each, spread evenly over the book. */
function extractPassages(body, source) {
  const paragraphs = transliterate(body)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    // Prose paragraphs only: skip headings, verse and very short lines.
    .filter((p) => lettersOf(p).length >= 120 && !/^[A-Z\s.,;:'"-]+$/.test(p))
  const passages = []
  const stride = Math.floor(paragraphs.length / (PASSAGES_PER_BOOK + 1))
  for (let k = 1; k <= PASSAGES_PER_BOOK; k++) {
    let text = ''
    for (let i = k * stride; i < paragraphs.length && lettersOf(text).length < PASSAGE_LETTERS; i++) {
      const sentences = paragraphs[i].match(/[^.!?]+[.!?]+["'»«”’)]*\s*/g) ?? [paragraphs[i]]
      for (const sentence of sentences) {
        text += sentence
        if (lettersOf(text).length >= PASSAGE_LETTERS) break
      }
      text = text.trimEnd() + ' '
    }
    text = text.trim()
    if (lettersOf(text).length >= PASSAGE_LETTERS * 0.8) passages.push({ source, text })
  }
  return passages
}

const ROMAN = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/

/** Word counts of a book (transliterated, A–Z, 2+ letters, no Roman numerals). */
function countWords(body, counts) {
  for (const raw of transliterate(body).split(/[^A-Za-z]+/)) {
    if (raw.length < 2) continue
    const w = raw.toUpperCase()
    if (ROMAN.test(w) && w.length <= 4) continue
    counts.set(w, (counts.get(w) ?? 0) + 1)
  }
}

function wordList(counts, lang) {
  const words = [...counts.entries()]
    .filter(([, c]) => c >= MIN_WORD_COUNT)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, WORD_COUNT)
    .map(([w]) => w)
  if (lang === 'de') {
    const have = new Set(words)
    for (const w of MILITARY_DE.split(/\s+/)) if (w && !have.has(w)) {
      words.push(w)
      have.add(w)
    }
  }
  return words
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const passages = { de: [], en: [] }
  for (const lang of ['de', 'en']) {
    const streams = []
    const wordCounts = new Map()
    for (const book of BOOKS.filter((b) => b.lang === lang)) {
      const body = stripGutenberg(await download(book.id))
      if (book.role === 'train') {
        const letters = trainingLetters(body, lang)
        streams.push(letters)
        countWords(body, wordCounts)
        console.log(`${lang} ${book.source}: ${letters.length} letters`)
      } else {
        const found = extractPassages(body, book.source)
        passages[lang].push(...found)
        console.log(`${lang} ${book.source}: ${found.length} passages`)
      }
    }
    const words = wordList(wordCounts, lang)
    const wordFile = join(OUT, `words-${lang}.txt`)
    await writeFile(wordFile, words.join('\n') + '\n')
    console.log(`${wordFile}: ${words.length} words`)
    const tables = countNgrams(streams).map(quantise)
    const buffer = encodeTables(tables)
    const file = join(OUT, `ngrams-${lang}.bin`)
    await writeFile(file, buffer)
    console.log(
      `${file}: ${buffer.length} bytes, ${tables[0].total} bigrams counted, floors ${tables
        .map((t) => t.floor.toFixed(2))
        .join(' / ')}`,
    )
  }
  const module = [
    '// Generated by scripts/build-ngrams.mjs — do not edit by hand.',
    '// Public-domain passages (Project Gutenberg) from books NOT used for the n-gram statistics.',
    "import type { BreakerLanguage } from '../types'",
    '',
    'export interface Passage {',
    '  source: string',
    '  text: string',
    '}',
    '',
    `export const PASSAGES: Record<BreakerLanguage, Passage[]> = ${JSON.stringify(passages, null, 2)}`,
    '',
  ].join('\n')
  await writeFile(join(OUT, 'passages.ts'), module)
  console.log(`passages: de ${passages.de.length}, en ${passages.en.length}`)
}

await main()
