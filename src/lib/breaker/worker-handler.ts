/** Message handler of the codebreaker worker, independent of the Worker global (testable). */
import { createGpuStages } from './gpu/gpu-stages'
import { createWasmStages, loadPhase1Wasm, wasmSimdSupported } from './wasm/wasm-stages'
import type { GpuStages } from './gpu/gpu-stages'
import { parseNgrams } from './ngrams'
import type { WorkerRequest, WorkerResponse } from './protocol'
import { createContext, runPlugboardSearch, runRingSearch, runRotorUnit, runRotorUnitWith, runWordsSearch } from './search'
import type { CoreCandidate, RotorUnitOptions, SearchContext, UnitStages } from './search'
import { parseDictionary } from './words'

const PROGRESS_INTERVAL_MS = 150

/** Returns a function that handles one request, answering through `post`. */
export function createWorkerHandler(post: (message: WorkerResponse) => void): (msg: WorkerRequest) => void {
  let ctx: SearchContext | null = null
  let runId = -1
  /** Phase-1 GPU backend of this worker (null: CPU). Dropped for good after any GPU failure. */
  let gpu: GpuStages | null = null
  /** Phase-1 CPU stages: WebAssembly SIMD, or null for the JavaScript reference. */
  let cpuEngine: UnitStages | null = null

  const dropGpu = (): void => {
    gpu?.dispose()
    gpu = null
  }

  const handle = (msg: WorkerRequest): void => {
    if (msg.type === 'init') {
      runId = msg.runId
      ctx = createContext(
        msg.config,
        parseNgrams(msg.ngrams, msg.config.language),
        msg.tuning,
        parseDictionary(msg.words, msg.config.language),
      )
      dropGpu()
      cpuEngine = null
      const id = runId
      const context = ctx
      // WebAssembly SIMD engine (falls back to JavaScript when unsupported or not loadable).
      const wantWasm = msg.config.cpuEngine !== 'js' && wasmSimdSupported()
      const wasm = wantWasm
        ? loadPhase1Wasm()
            .then((module) => createWasmStages(context, module))
            .catch(() => null)
        : Promise.resolve(null)
      const gpuReady = msg.gpu ? createGpuStages(context).catch(() => null) : Promise.resolve(null)
      Promise.all([wasm, gpuReady]).then(([engine, stages]) => {
        if (id !== runId) {
          stages?.dispose()
          return
        }
        cpuEngine = engine
        gpu = stages
        stages?.lost.then(() => {
          if (gpu === stages) gpu = null
        })
        post({ type: 'ready', runId: id, gpu: stages ? stages.adapter : null, engine: engine ? 'wasm' : 'js' })
      })
      return
    }
    if (!ctx || msg.runId !== runId) return
    const task = msg.task
    if (msg.type === 'rotors') {
      let last = performance.now()
      const options: RotorUnitOptions = {
        keep: msg.keep,
        threshold: msg.threshold,
        onProgress: (keys) => {
          const now = performance.now()
          if (now - last < PROGRESS_INTERVAL_MS) return
          last = now
          post({ type: 'progress', runId, task, keys })
        },
      }
      if (gpu) {
        // Bit-identical to the CPU; on any GPU failure the unit is redone on the CPU.
        const context = ctx
        const id = runId
        runRotorUnitWith(context, msg.unit, options, gpu.stages).then(
          (r) => post({ type: 'done', runId: id, task, candidates: r.survivors, keys: r.keys }),
          () => {
            dropGpu()
            try {
              const r = runRotorUnit(context, msg.unit, options, cpuEngine ?? undefined)
              post({ type: 'done', runId: id, task, candidates: r.survivors, keys: r.keys })
            } catch (error) {
              post({ type: 'error', runId: id, message: error instanceof Error ? error.message : String(error) })
            }
          },
        )
        return
      }
      const r = runRotorUnit(ctx, msg.unit, options, cpuEngine ?? undefined)
      post({ type: 'done', runId, task, candidates: r.survivors, keys: r.keys })
    } else if (msg.type === 'rings') {
      const out: CoreCandidate[] = []
      let keys = 0
      for (const c of msg.candidates) {
        const r = runRingSearch(ctx, c)
        out.push(...r.results)
        keys += r.keys
      }
      post({ type: 'done', runId, task, candidates: out, keys })
    } else if (msg.type === 'plugboard') {
      const r = runPlugboardSearch(ctx, msg.candidate, msg.seed)
      post({ type: 'done', runId, task, candidates: [r.result], keys: r.keys })
    } else {
      const r = runWordsSearch(ctx, msg.candidate, msg.polish)
      post({ type: 'done', runId, task, candidates: [r.result], keys: r.keys })
    }
  }

  return (msg) => {
    try {
      handle(msg)
    } catch (error) {
      post({ type: 'error', runId: msg.runId, message: error instanceof Error ? error.message : String(error) })
    }
  }
}
