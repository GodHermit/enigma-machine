import { KEYS_PER_SECOND_PER_WORKER, WASM_KEYS_PER_SECOND_PER_WORKER } from '../../lib/breaker/config'
import type { BreakerConfig, WorkEstimate } from '../../lib/breaker/types'
import type { GpuInfo } from './use-gpu-info'
import { safeEstimate } from './safe-engine'
import { wasmSimdAvailable } from './wasm-support'

/**
 * Start positions per second the GPU worker searches in phase 1, for estimates only. Measured in
 * Chrome on an Apple M3 Pro GPU (≈ 21,000); kept a bit lower because other GPUs are slower.
 */
export const GPU_KEYS_PER_SECOND = 18000

export type CpuEngine = 'wasm' | 'js'

export interface ProcessorPlan {
  /** The GPU joins the search. */
  gpu: boolean
  gpuName: string | null
  /** CPU workers searching (one worker slot drives the GPU when it is used). */
  cpuWorkers: number
  /** Engine the CPU workers will actually use (WebAssembly needs SIMD support). */
  engine: CpuEngine
  /** "GPU + 10 CPU workers" / "11 CPU workers". */
  label: string
}

const cpuLabel = (n: number): string => `${n} CPU ${n === 1 ? 'worker' : 'workers'}`

export function processorPlan(config: Pick<BreakerConfig, 'workers' | 'backend' | 'cpuEngine'>, gpu: GpuInfo): ProcessorPlan {
  const useGpu = (config.backend ?? 'auto') === 'auto' && gpu.state === 'ready'
  const cpuWorkers = useGpu ? Math.max(1, config.workers - 1) : config.workers
  return {
    gpu: useGpu,
    gpuName: useGpu ? gpu.name : null,
    cpuWorkers,
    engine: config.cpuEngine !== 'js' && wasmSimdAvailable() ? 'wasm' : 'js',
    label: useGpu ? `GPU + ${cpuLabel(cpuWorkers)}` : cpuLabel(cpuWorkers),
  }
}

/** Start positions per second of one CPU worker with this engine. */
export function cpuKeysPerSecond(engine: CpuEngine): number {
  return engine === 'wasm' ? WASM_KEYS_PER_SECOND_PER_WORKER : KEYS_PER_SECOND_PER_WORKER
}

/** Work estimate for the processors that will run: CPU workers (by engine) plus the GPU. */
export function processorEstimate(config: BreakerConfig, plan: ProcessorPlan): WorkEstimate | null {
  const threads = plan.cpuWorkers + (plan.gpu ? 1 : 0)
  const rate = plan.cpuWorkers * cpuKeysPerSecond(plan.engine) + (plan.gpu ? GPU_KEYS_PER_SECOND : 0)
  return safeEstimate({ ...config, workers: threads }, rate / threads)
}

/** The same search on the CPU workers alone (for comparison). */
export function cpuOnlyEstimate(config: BreakerConfig, plan: ProcessorPlan): WorkEstimate | null {
  return safeEstimate(config, cpuKeysPerSecond(plan.engine))
}
