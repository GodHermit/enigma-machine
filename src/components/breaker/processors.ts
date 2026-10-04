import type { BreakerConfig, WorkEstimate } from '../../lib/breaker/types'
import type { GpuInfo } from './use-gpu-info'
import { safeEstimate } from './safe-engine'

/**
 * How much phase-1 work the GPU worker does compared with one CPU worker, for estimates only.
 * Measured in Chrome on an Apple M3 Pro: the GPU alone ≈ 12,000 start positions/s ≈ 17 CPU
 * workers; slightly conservative because other GPUs (integrated ones especially) are slower.
 */
export const GPU_WORKER_EQUIVALENT = 12

export interface ProcessorPlan {
  /** The GPU joins the search. */
  gpu: boolean
  gpuName: string | null
  /** CPU workers searching (one worker slot drives the GPU when it is used). */
  cpuWorkers: number
  /** "GPU + 10 CPU workers" / "11 CPU workers". */
  label: string
}

const cpuLabel = (n: number): string => `${n} CPU ${n === 1 ? 'worker' : 'workers'}`

export function processorPlan(config: Pick<BreakerConfig, 'workers' | 'backend'>, gpu: GpuInfo): ProcessorPlan {
  const useGpu = (config.backend ?? 'auto') === 'auto' && gpu.state === 'ready'
  const cpuWorkers = useGpu ? Math.max(1, config.workers - 1) : config.workers
  return {
    gpu: useGpu,
    gpuName: useGpu ? gpu.name : null,
    cpuWorkers,
    label: useGpu ? `GPU + ${cpuLabel(cpuWorkers)}` : cpuLabel(cpuWorkers),
  }
}

/** Work estimate for the processors that will run (the GPU counted as GPU_WORKER_EQUIVALENT CPU workers). */
export function processorEstimate(config: BreakerConfig, plan: ProcessorPlan): WorkEstimate | null {
  return safeEstimate(plan.gpu ? { ...config, workers: plan.cpuWorkers + GPU_WORKER_EQUIVALENT } : config)
}
