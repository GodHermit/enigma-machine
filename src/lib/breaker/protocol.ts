/** Messages between the breaker (main thread) and its Web Workers. */
import type { CoreCandidate, RotorUnit, SearchTuning } from './search'
import type { BreakerConfig } from './types'

export type WorkerRequest =
  | {
      type: 'init'
      runId: number
      config: BreakerConfig
      /** Raw ngrams-<lang>.bin contents. */
      ngrams: ArrayBuffer
      /** words-<lang>.txt contents. */
      words: string
      tuning: Partial<SearchTuning>
      /** Run phase 1 on the GPU (WebGPU) when possible; the worker falls back to the CPU. */
      gpu?: boolean
    }
  | { type: 'rotors'; runId: number; task: number; unit: RotorUnit; keep: number; threshold: number }
  | { type: 'rings'; runId: number; task: number; candidates: CoreCandidate[] }
  | { type: 'plugboard'; runId: number; task: number; candidate: CoreCandidate; seed: number }
  | { type: 'words'; runId: number; task: number; candidate: CoreCandidate; polish: boolean }

export type WorkerResponse =
  /**
   * `gpu`: the adapter's name when this worker runs phase 1 on the GPU, else null.
   * `engine`: the CPU engine this worker runs phase 1 with ('wasm' = WebAssembly SIMD).
   */
  | { type: 'ready'; runId: number; gpu?: string | null; engine?: 'wasm' | 'js' }
  /** Keys tested so far in the running task (phase 1 only). */
  | { type: 'progress'; runId: number; task: number; keys: number }
  | { type: 'done'; runId: number; task: number; candidates: CoreCandidate[]; keys: number }
  | { type: 'error'; runId: number; message: string }
