/**
 * Fast proxy benchmark for phase 1 tuning: runs phases 1 → 2 → 3 on the TRUE rotor order only
 * (one unit instead of all 60), so a tuning change can be judged on many messages in minutes.
 * A message counts as solved when phase 3 recovers ≥ 90% of the plaintext from a phase-1
 * survivor that is close to the true stepping schedule.
 *
 *   BENCH_TUNING='{"refineMode":"sweep"}' BENCH_SHARD=0 BENCH_SHARDS=6 \
 *     yarn vitest run --config scripts/vitest.bench.config.ts scripts/breaker-unit.bench.ts
 *
 *   BENCH_SAMPLES=24   messages (half English, half German; sample 0 is a fixed user report)
 *   BENCH_SHARD / BENCH_SHARDS   split the messages over several processes
 *   BENCH_OUT          file to append one result line per message to
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'vitest'
import { decodeSettings, encryptText } from '../src/lib/enigma'
import type { MachineSettings } from '../src/lib/enigma'
import { parseNgrams } from '../src/lib/breaker/ngrams'
import type { NgramModel } from '../src/lib/breaker/ngrams'
import { sampleChallenge } from '../src/lib/breaker/samples'
import { fillSchedule, keyFromSettings } from '../src/lib/breaker/scrambler'
import type { RotorKey } from '../src/lib/breaker/scrambler'
import { createContext, rotorUnits, runPlugboardSearch, runRingSearch, runRotorUnit } from '../src/lib/breaker/search'
import type { SearchTuning } from '../src/lib/breaker/search'
import { letterAgreement, lettersOnly } from '../src/lib/breaker/text'
import type { BreakerConfig, BreakerLanguage } from '../src/lib/breaker/types'

const env = process.env
const SAMPLES = Number(env.BENCH_SAMPLES ?? 24)
const SHARD = Number(env.BENCH_SHARD ?? 0)
const SHARDS = Number(env.BENCH_SHARDS ?? 1)
const TUNING: Partial<SearchTuning> = env.BENCH_TUNING ? JSON.parse(env.BENCH_TUNING) : {}
const OUT = env.BENCH_OUT
/** Survivors that get phase 2, and phase-2 results that get phase 3 (the real search: all / 100 over 60 units). */
const PHASE2 = Number(env.BENCH_PHASE2 ?? 40)
const PHASE3 = Number(env.BENCH_PHASE3 ?? 8)
/** Optional comma-separated message indexes to run (default: all). */
const ONLY = env.BENCH_ONLY ? new Set(env.BENCH_ONLY.split(',').map(Number)) : null

/** A message a user reported as unbreakable (English, 263 letters, UKW-A, left turnover at 113). */
const USER_REPORT = {
  plain: `A quiet city wakes beneath a pale silver sky, while distant trains hum softly beyond the rooftops. Somewhere, a window opens, coffee begins to brew, and another ordinary morning quietly turns into something unexpected. The streets remain empty, carrying yesterday’s rain and a thousand untold stories toward the horizon.`,
  key: 'I.UKW-A.V-III-IV.SPI.YQB.TO-UH-PM-NY-CA-JB-KS-WX-ZR-VL',
}

const ngramCache = new Map<BreakerLanguage, NgramModel>()
function ngrams(language: BreakerLanguage): NgramModel {
  let model = ngramCache.get(language)
  if (!model) {
    model = parseNgrams(readFileSync(join(__dirname, '..', 'src', 'lib', 'breaker', 'data', `ngrams-${language}.bin`)), language)
    ngramCache.set(language, model)
  }
  return model
}

function message(index: number): { language: BreakerLanguage; settings: MachineSettings; plain: string; cipher: string } {
  if (index === 0) {
    const settings = decodeSettings(USER_REPORT.key)!
    const plain = lettersOnly(USER_REPORT.plain)
    return { language: 'en', settings, plain, cipher: encryptText(settings, plain, { nonLetters: 'remove' }).output }
  }
  const language: BreakerLanguage = index % 2 === 0 ? 'en' : 'de'
  const ch = sampleChallenge({ model: 'I', language, length: 250 + ((index * 13) % 51), seed: index * 7919 })
  return { language, settings: ch.settings, plain: ch.plaintext, cipher: ch.ciphertext }
}

test('phase 1 tuning proxy (true rotor order)', () => {
  const indexes = Array.from({ length: SAMPLES }, (_, i) => i).filter((i) => !ONLY || ONLY.has(i))
  for (let k = SHARD; k < indexes.length; k += SHARDS) {
    const index = indexes[k]
    const { language, settings, plain, cipher } = message(index)
    const truth = keyFromSettings(settings)
    const n = cipher.length
    const tr = new Int32Array(n)
    const ti = new Int32Array(n)
    const r = new Int32Array(n)
    const i2 = new Int32Array(n)
    fillSchedule(truth, n, tr, ti)
    const mismatch = (k: RotorKey): number => {
      fillSchedule(k, n, r, i2)
      let m = 0
      for (let i = 0; i < n; i++) if (r[i] !== tr[i] || i2[i] !== ti[i]) m++
      return m
    }
    const config: BreakerConfig = {
      ciphertext: cipher,
      model: 'I',
      rotors: ['I', 'II', 'III', 'IV', 'V'],
      reflectors: [settings.reflector],
      greekRotors: [],
      ringSearch: 'right-middle',
      maxPlugs: 10,
      language,
      crib: null,
      workers: 1,
    }
    const ctx = createContext(config, ngrams(language), TUNING)
    const unit = rotorUnits(config).find(
      (u) => u.left === settings.left.rotor && u.middle === settings.middle.rotor && u.right === settings.right.rotor,
    )!
    const t0 = performance.now()
    const { survivors } = runRotorUnit(ctx, unit, { keep: 1000 })
    const ms = performance.now() - t0
    const near = survivors.map((c, rank) => ({ c, rank, m: mismatch(c.key) })).filter((x) => x.m <= n * 0.15)
    // Like the real pipeline (on this unit): phase 2 on the best survivors, phase 3 on the best
    // phase-2 results by score.
    const phase2 = survivors.slice(0, PHASE2).flatMap((c) => runRingSearch(ctx, c).results)
    phase2.sort((a, b) => b.score - a.score)
    let solved = false
    for (const res of phase2.slice(0, PHASE3)) {
      const p = runPlugboardSearch(ctx, res, 1)
      if (letterAgreement(p.result.plaintext ?? '', plain) > 0.9) {
        solved = true
        break
      }
    }
    const line = JSON.stringify({
      index,
      language,
      n,
      solved,
      rank: near.length ? near[0].rank : null,
      score: near.length ? Number(near[0].c.score.toFixed(4)) : null,
      top: Number(survivors[0].score.toFixed(4)),
      ms: Math.round(ms),
    })
    if (OUT) appendFileSync(OUT, line + '\n')
    else console.log(line)
  }
})
