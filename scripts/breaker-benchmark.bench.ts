/**
 * End-to-end accuracy / speed benchmark of the codebreaker (single-threaded, node):
 *
 *   yarn vitest run --config scripts/vitest.bench.config.ts
 *
 * Environment variables (all optional):
 *   BENCH_LANG=de|en       plaintext language (default de)
 *   BENCH_LEN=250-350      message length, a number or a min-max range (default 250-350)
 *   BENCH_TRIALS=10        number of random messages
 *   BENCH_FIRST=0          index of the first trial (to split a run over several processes)
 *   BENCH_SEED=2024        base PRNG seed
 *   BENCH_PLUGS=10         plugboard cables of the random keys
 *   BENCH_CRIB=0           crib length taken from the plaintext start (0 = no crib)
 *   BENCH_TUNING='{...}'   SearchTuning overrides (JSON)
 *   BENCH_ORDERS=known     diagnostics only: search just the true rotors (6 orders)
 *
 * A trial succeeds when the best candidate's plaintext matches ≥ 90 % of the letters (keys are
 * compared by plaintext since equivalent keys exist). "before" is the ranking after phase 3,
 * "after" the final ranking after phase 4 (dictionary check). cov = dictionary coverage of the
 * correct candidate / of the best wrong one among the checked candidates. The search is the full Enigma I search
 * (rotors I–V, UKW-B, ring search right+middle, 10 plugs); the 8-worker time is the
 * single-thread time divided by 8 (phase 1 splits into 60 independent units).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { encryptText, randomSettings } from '../src/lib/enigma'
import { PASSAGES } from '../src/lib/breaker/data/passages'
import { parseNgrams } from '../src/lib/breaker/ngrams'
import { parseDictionary } from '../src/lib/breaker/words'
import { runSearchSync, rotorKeyId } from '../src/lib/breaker/pipeline'
import { mulberry32 } from '../src/lib/breaker/random'
import { keyFromSettings, plugMap } from '../src/lib/breaker/scrambler'
import { describeKey, lettersOnly, letterAgreement } from '../src/lib/breaker'
import type { BreakerConfig, BreakerLanguage } from '../src/lib/breaker/types'
import type { PlugPair, RotorId } from '../src/lib/enigma/types'

const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const LANG = env('BENCH_LANG', 'de') as BreakerLanguage
const [LEN_MIN, LEN_MAX = LEN_MIN] = env('BENCH_LEN', '250-350').split('-').map(Number)
const TRIALS = Number(env('BENCH_TRIALS', '10'))
const FIRST = Number(env('BENCH_FIRST', '0'))
const SEED = Number(env('BENCH_SEED', '2024'))
const PLUGS = Number(env('BENCH_PLUGS', '10'))
const CRIB = Number(env('BENCH_CRIB', '0'))
const KNOWN_ORDERS = env('BENCH_ORDERS', 'all') === 'known'
const TUNING = JSON.parse(env('BENCH_TUNING', '{}')) as Record<string, unknown>

const dictionary = parseDictionary(
  readFileSync(join(__dirname, '..', 'src', 'lib', 'breaker', 'data', `words-${LANG}.txt`), 'utf8'),
  LANG,
)
const ngrams = parseNgrams(
  readFileSync(join(__dirname, '..', 'src', 'lib', 'breaker', 'data', `ngrams-${LANG}.bin`)),
  LANG,
)

function message(rand: () => number, length: number): string {
  const passages = PASSAGES[LANG]
  let k = Math.floor(rand() * passages.length)
  let text = ''
  while (text.length < length + 200) text += lettersOnly(passages[k++ % passages.length].text)
  const start = Math.floor(rand() * 150)
  return text.slice(start, start + length)
}

function plugs(rand: () => number, count: number): PlugPair[] {
  const letters = Array.from({ length: 26 }, (_, i) => i)
  for (let i = 25; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[letters[i], letters[j]] = [letters[j], letters[i]]
  }
  return Array.from({ length: count }, (_, i) => [letters[2 * i], letters[2 * i + 1]] as PlugPair)
}

test('codebreaker accuracy benchmark', () => {
  let ok = 0
  let okBefore = 0
  const rightCoverages: number[] = []
  const wrongCoverages: number[] = []
  let totalMs = 0
  const lines: string[] = []
  for (let t = FIRST; t < FIRST + TRIALS; t++) {
    const rand = mulberry32(SEED + t * 7919)
    const length = LEN_MIN + Math.floor(rand() * (LEN_MAX - LEN_MIN + 1))
    const settings = { ...randomSettings('I', rand), reflector: 'UKW-B' as const, plugboard: plugs(rand, PLUGS) }
    const plain = message(rand, length)
    const cipher = encryptText(settings, plain, { nonLetters: 'remove' }).output
    const config: BreakerConfig = {
      ciphertext: cipher,
      model: 'I',
      rotors: KNOWN_ORDERS ? [settings.left.rotor, settings.middle.rotor, settings.right.rotor] as RotorId[] : ['I', 'II', 'III', 'IV', 'V'],
      reflectors: ['UKW-B'],
      greekRotors: [],
      ringSearch: 'right-middle',
      maxPlugs: 10,
      language: LANG,
      crib: CRIB > 0 ? { text: plain.slice(0, CRIB), position: null } : null,
      workers: 1,
    }
    const start = performance.now()
    const result = runSearchSync(config, ngrams, TUNING, undefined, dictionary)
    const ms = performance.now() - start
    totalMs += ms
    const best = result.candidates[0]
    const agreement = best?.plaintext ? letterAgreement(best.plaintext, plain) : 0
    const success = agreement >= 0.9
    if (success) ok++
    const before = result.beforeWords[0]?.plaintext ? letterAgreement(result.beforeWords[0].plaintext, plain) : 0
    if (before >= 0.9) okBefore++
    const right = result.candidates.find((c) => letterAgreement(c.plaintext ?? '', plain) >= 0.9)
    const wrong = result.candidates.filter((c) => letterAgreement(c.plaintext ?? '', plain) < 0.9)
    const wrongCov = Math.max(0, ...wrong.map((c) => c.words?.coverage ?? 0))
    if (right?.words) rightCoverages.push(right.words.coverage)
    if (wrong.length > 0) wrongCoverages.push(wrongCov)
    // Diagnostics: did the right rotor order / offsets survive phase 1?
    const truth = keyFromSettings(settings)
    const sameOrder = (k: typeof truth) => k.left === truth.left && k.middle === truth.middle && k.right === truth.right
    const p1 = result.survivors.findIndex((c) => sameOrder(c.key) && (c.key.posR - c.key.ringR - truth.posR + truth.ringR + 52) % 26 === 0)
    const p2 = result.finalists.findIndex((c) => sameOrder(c.key) && (c.key.posR - c.key.ringR - truth.posR + truth.ringR + 52) % 26 === 0)
    const truePlugs = plugMap(settings.plugboard)
    const bestPlugs = best ? best.plugs.filter((p, a) => p > a && truePlugs[a] === p).length : 0
    lines.push(
      `#${t} len=${length} ${success ? 'OK  ' : 'FAIL'} agree=${(agreement * 100).toFixed(1)}% before=${(before * 100).toFixed(1)}% ` +
        `cov=${right?.words ? right.words.coverage.toFixed(2) : '-'}/${wrong.length ? wrongCov.toFixed(2) : '-'} ` +
        `p1rank=${p1} (score ${p1 >= 0 ? result.survivors[p1].score.toFixed(4) : '-'}, cut ${result.survivors[result.survivors.length - 1]?.score.toFixed(4)}) p2rank=${p2} plugsRight=${bestPlugs}/${PLUGS} ` +
        `time=${(ms / 1000).toFixed(1)}s (rotors ${(result.timings.rotors / 1000).toFixed(1)} rings ${(result.timings.rings / 1000).toFixed(1)} plugs ${(result.timings.plugboard / 1000).toFixed(1)} words ${(result.timings.words / 1000).toFixed(1)}) ` +
        `keys/s=${Math.round(result.keysTested / (ms / 1000))} truth=[${describeKey(settings)}] best=${best ? rotorKeyId(best) : '-'}`,
    )
    console.log(lines[lines.length - 1])
  }
  console.log(
    `SUMMARY lang=${LANG} len=${LEN_MIN}-${LEN_MAX} plugs=${PLUGS} crib=${CRIB}: ${ok}/${TRIALS} solved; ` +
      `mean ${(totalMs / TRIALS / 1000).toFixed(1)} s single-thread ≈ ${(totalMs / TRIALS / 8000).toFixed(1)} s with 8 workers`,
  )
  expect(TRIALS).toBeGreaterThan(0)
})
