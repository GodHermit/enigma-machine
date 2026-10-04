/**
 * Browser parity check of the WebGPU phase-1 backend against the CPU (dev only, not bundled):
 * open /tests/gpu/parity.html on the Vite dev server (scripts/gpu-parity.mjs drives it in Chrome).
 * Results land in window.__parity.
 */
import { decodeSettings, encryptText } from '../../src/lib/enigma'
import deUrl from '../../src/lib/breaker/data/ngrams-de.bin?url'
import enUrl from '../../src/lib/breaker/data/ngrams-en.bin?url'
import { createGpuStages } from '../../src/lib/breaker/gpu/gpu-stages'
import { parseNgrams } from '../../src/lib/breaker/ngrams'
import {
  createContext,
  innerFor,
  planUnit,
  refineSelection,
  refineStage,
  rotorUnits,
  runRotorUnit,
  runRotorUnitWith,
  screenStage,
} from '../../src/lib/breaker/search'
import type { BreakerConfig } from '../../src/lib/breaker/types'
import { CASES } from '../../scripts/breaker-cases'

interface CaseReport {
  case: string
  unit: string
  screenEqual: boolean
  screenPEqual: boolean
  finalsEqual: boolean
  survivorsEqual: boolean
  cpu: { screenMs: number; refineMs: number; unitMs: number }
  gpu: { screenMs: number; unitMs: number }
  firstDiff?: string
}

const log = (line: string): void => {
  const el = document.getElementById('log')!
  el.textContent = (el.textContent === 'running…' ? '' : el.textContent + '\n') + line
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search)
  const caseIds = (params.get('cases') ?? '0,3').split(',').map(Number)
  /** Optional search tuning overrides (JSON), applied to both backends. */
  const tuning = JSON.parse(params.get('tuning') ?? '{}')
  /** Only time the GPU (skip the slow CPU runs and the comparison). */
  const gpuOnly = params.get('gpuOnly') === '1'
  const reports: CaseReport[] = []
  let adapter = ''
  for (const ci of caseIds) {
    const c = CASES[ci]
    const settings = decodeSettings(c.key)!
    const cipher = encryptText(settings, c.plain, { nonLetters: 'remove' }).output
    const config: BreakerConfig = {
      ciphertext: cipher,
      model: 'I',
      rotors: ['I', 'II', 'III', 'IV', 'V'],
      reflectors: [settings.reflector],
      greekRotors: [],
      ringSearch: 'right-middle',
      maxPlugs: 10,
      language: c.language,
      crib: ci === 3 ? { text: c.plain.slice(20, 32), position: null } : null,
      workers: 1,
    }
    const bytes = await (await fetch(c.language === 'de' ? deUrl : enUrl)).arrayBuffer()
    const ctx = createContext(config, parseNgrams(bytes, c.language), tuning)
    const gpu = await createGpuStages(
      ctx,
      Number(params.get('wg') ?? 32),
      params.get('onfly') !== '0',
      params.get('rshared') !== '0',
      (params.get('kernel') ?? 'auto') as 'auto' | 'subgroup' | 'workgroup',
      (params.get('hist') ?? 'auto') as 'auto' | 'on' | 'off',
    )
    if (!gpu) throw new Error('WebGPU backend unavailable')
    adapter = `${gpu.adapter} (${gpu.kernel} climb)`
    const units = rotorUnits(config)
    const truth = units.findIndex((u) => u.left === settings.left.rotor && u.middle === settings.middle.rotor && u.right === settings.right.rotor)
    for (const unit of [units[truth], units[(truth + 17) % units.length]]) {
      const plan = planUnit(ctx, unit)
      const inner = innerFor(ctx, unit.reflector, unit.greek, 0, unit.left, unit.middle)
      if (gpuOnly) {
        let g = performance.now()
        await gpu.screen(plan, inner)
        const screenMs = performance.now() - g
        g = performance.now()
        await gpu.stages(plan, 0, inner)
        log(JSON.stringify({ unit: `${unit.left}-${unit.middle}-${unit.right}`, gpuScreenMs: Math.round(screenMs), gpuUnitMs: Math.round(performance.now() - g) }))
        reports.push({ case: c.name, unit: unit.left, screenEqual: true, screenPEqual: true, finalsEqual: true, survivorsEqual: true, cpu: { screenMs: 0, refineMs: 0, unitMs: 0 }, gpu: { screenMs: Math.round(screenMs), unitMs: Math.round(performance.now() - g) } })
        continue
      }
      let t = performance.now()
      const cpuScreen = screenStage(ctx, plan, inner)
      const cpuScreenMs = performance.now() - t
      t = performance.now()
      const cpuFinals = refineStage(ctx, plan, inner, cpuScreen, refineSelection(ctx, cpuScreen.screen))
      const cpuRefineMs = performance.now() - t
      t = performance.now()
      const gpuScreen = await gpu.screen(plan, inner)
      const gpuScreenMs = performance.now() - t
      t = performance.now()
      const gpuFinals = await gpu.stages(plan, 0, inner)
      const gpuUnitMs = performance.now() - t

      let firstDiff: string | undefined
      const screenEqual = cpuScreen.screen.every((v, i) => {
        if (v === gpuScreen.screen[i]) return true
        firstDiff ??= `screen[${i}] cpu ${v} gpu ${gpuScreen.screen[i]}`
        return false
      })
      const screenPEqual = cpuScreen.screenP.every((v, i) => {
        if (v === gpuScreen.screenP[i]) return true
        firstDiff ??= `screenP[${i}] cpu ${v} gpu ${gpuScreen.screenP[i]}`
        return false
      })
      const key = (f: { idx: number; r: number; rm: number; sumSq: number; bigramSum: number; P: Uint8Array }) =>
        `${f.idx}/${f.r}/${f.rm}/${f.sumSq}/${f.bigramSum}/${Array.from(f.P).join(',')}`
      const a = cpuFinals.map(key)
      const b = (gpuFinals as typeof cpuFinals).map(key)
      const finalsEqual = a.length === b.length && a.every((v, i) => v === b[i])
      if (!finalsEqual) {
        const i = a.findIndex((v, k) => v !== b[k])
        firstDiff ??= `finals[${i}] (cpu ${a.length}, gpu ${b.length}) cpu ${a[i]} gpu ${b[i]}`
      }

      t = performance.now()
      const cpuUnit = runRotorUnit(ctx, unit, { keep: 200 })
      const cpuUnitMs = performance.now() - t
      const gpuUnit = await runRotorUnitWith(ctx, unit, { keep: 200 }, gpu.stages)
      const sv = (r: typeof cpuUnit) => r.survivors.map((s) => `${s.key.posL},${s.key.posM},${s.key.posR},${s.key.ringM},${s.key.ringR}:${s.score}:${s.plugs.join('')}`).join('|')
      const survivorsEqual = sv(cpuUnit) === sv(gpuUnit)

      const report: CaseReport = {
        case: c.name,
        unit: `${unit.reflector} ${unit.left}-${unit.middle}-${unit.right}`,
        screenEqual,
        screenPEqual,
        finalsEqual,
        survivorsEqual,
        cpu: { screenMs: Math.round(cpuScreenMs), refineMs: Math.round(cpuRefineMs), unitMs: Math.round(cpuUnitMs) },
        gpu: { screenMs: Math.round(gpuScreenMs), unitMs: Math.round(gpuUnitMs) },
        ...(firstDiff ? { firstDiff } : {}),
      }
      reports.push(report)
      log(JSON.stringify(report))
    }
    gpu.dispose()
  }
  ;(window as unknown as { __parity: unknown }).__parity = { adapter, reports }
}

main().catch((error) => {
  log(`ERROR ${error instanceof Error ? error.stack : String(error)}`)
  ;(window as unknown as { __parity: unknown }).__parity = { error: String(error) }
})
