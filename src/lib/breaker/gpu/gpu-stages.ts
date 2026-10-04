/**
 * WebGPU backend of phase 1: runs stages A (screen) and B (refine) of search.ts on the GPU,
 * bit-identical to the CPU (same candidates, same integer scores, same tie-breaking). Everything
 * runs on the user's own GPU; nothing leaves the device.
 */
import { refineSelection } from '../search'
import type { RefineFinal, ScreenResult, SearchContext, UnitPlan, UnitStages } from '../search'
import shaderTemplate from './phase1.wgsl?raw'
import {
  FINAL_STRIDE,
  MAX_CAND,
  SCREEN_STRIDE,
  TABLES,
  cipherBuffer,
  pairList,
  paramsBuffer,
  planBuffer,
  reduceScreen,
  refineJobs,
  tablesBuffer,
  unpackPlugs,
} from './layout'
import type { Params } from './layout'

/** WebGPU flag values (fixed by the spec; lib.dom only declares their types). */
const SHADER_COMPUTE = 0x4
const BUFFER = { MAP_READ: 0x1, COPY_SRC: 0x4, COPY_DST: 0x8, UNIFORM: 0x40, STORAGE: 0x80 } as const
const MAP_READ_MODE = 0x1

/** Threads per workgroup (= cable pairs tested per round of a climb). */
export const WORKGROUP_SIZE = 32
/** Compute class-table entries on the fly instead of storing them in workgroup memory. */
export const ON_THE_FLY = true
/** On-the-fly mode: keep the right rotor's tables in workgroup memory. */
export const ROTOR_SHARED = true

/** Which climb kernel to use: 'auto' picks subgroups when the GPU has fixed 32-lane subgroups. */
export type ClimbKernel = 'auto' | 'subgroup' | 'workgroup'

/** Keeps the selected climb block of the shader (//#SG-… or //#BARRIER-…) and drops the other. */
export function shaderSource(
  template: string,
  opts: { nmax: number; workgroupSize: number; onTheFly: boolean; rotorShared: boolean; subgroups: boolean },
): string {
  const drop = opts.subgroups ? 'BARRIER' : 'SG'
  const stripped = template.replace(new RegExp(`//#${drop}-BEGIN[\\s\\S]*?//#${drop}-END\\n`), '').replace(/\/\/#(SG|BARRIER)-(BEGIN|END)\n/g, '')
  return stripped
    .replace('__HEADER__', opts.subgroups ? 'enable subgroups;\ndiagnostic(off, subgroup_uniformity);' : '')
    .replaceAll('__NMAX__', String(opts.nmax))
    .replaceAll('__WG__', String(opts.workgroupSize))
    .replaceAll('__ONFLY__', String(opts.onTheFly))
    .replaceAll('__RSHARED__', String(opts.rotorShared))
    .replaceAll('__SG__', String(opts.subgroups))
}

/** Workgroups per dispatch: keeps every submission short (GPU watchdogs, responsiveness). */
const CHUNK_SCREEN = 4096
const CHUNK_REFINE = 256
/** Rotor units the GPU backend works on at once (each with its own buffers). */
export const LANES = 2
/** Wait for the GPU (and report progress) after this many screen dispatches. */
const SYNC_EVERY = 4

export interface GpuStages {
  stages: UnitStages
  /** Stage A alone (parity tests). */
  screen(plan: UnitPlan, inner: Uint8Array): Promise<ScreenResult>
  /** Human description of the adapter, e.g. "apple metal-3". */
  adapter: string
  /** The climb kernel in use. */
  kernel: 'subgroup' | 'workgroup'
  /** Resolves with a reason when the device is lost (driver reset, tab in background …). */
  lost: Promise<string>
  dispose(): void
}

/** Why the GPU backend cannot run this search (null when it can). */
export function gpuUnsupportedReason(ctx: SearchContext): string | null {
  const t = ctx.tuning
  if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) return 'WebGPU is not available'
  if (t.refineMode !== 'sweep') return 'only the sweep refine mode runs on the GPU'
  if (Math.max(1, t.refineKeep) > 4) return 'refineKeep above 4 is CPU-only'
  if (ctx.layout.n < 2) return 'message too short'
  return null
}

/** Workgroup memory (bytes) the kernels need for messages up to nmax letters. */
export function workgroupBytes(nmax: number): number {
  const tabWords = Math.ceil((nmax * 26) / 4)
  // tab + sched + cs + P/startP/T + scalars + candidates + finals
  return 4 * (tabWords + nmax + 27 + 26 * 3 + 11 + MAX_CAND * 3 + 8 + 1)
}

/** Creates the backend for a search context; null when WebGPU (or enough GPU memory) is missing. */
export async function createGpuStages(
  ctx: SearchContext,
  workgroupSize = WORKGROUP_SIZE,
  onTheFly = ON_THE_FLY,
  rotorShared = ROTOR_SHARED,
  climbKernel: ClimbKernel = 'auto',
): Promise<GpuStages | null> {
  if (gpuUnsupportedReason(ctx)) return null
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) return null
  const n = ctx.layout.n
  const nmax = Math.max(32, Math.ceil(n / 32) * 32)
  // The estimate ignores the compiler's alignment padding, so keep a margin and ask for all the
  // workgroup memory the adapter has.
  const available = adapter.limits.maxComputeWorkgroupStorageSize
  if ((onTheFly ? workgroupBytes(1) + nmax * 4 : workgroupBytes(nmax)) + 1024 > available) return null
  // Subgroup climbs need the 'subgroups' feature and exactly one 32-lane subgroup per workgroup.
  const info0 = adapter.info as GPUAdapterInfo & { subgroupMinSize?: number; subgroupMaxSize?: number }
  const subgroupsOk =
    workgroupSize === 32 &&
    adapter.features.has('subgroups') &&
    info0.subgroupMinSize === 32 &&
    info0.subgroupMaxSize === 32
  if (climbKernel === 'subgroup' && !subgroupsOk) return null
  const subgroups = climbKernel !== 'workgroup' && subgroupsOk
  const device = await adapter.requestDevice({
    requiredLimits: { maxComputeWorkgroupStorageSize: available },
    requiredFeatures: subgroups ? ['subgroups' as GPUFeatureName] : [],
  })
  const lost = device.lost.then((info) => info.message || info.reason || 'device lost')

  const module = device.createShaderModule({
    code: shaderSource(shaderTemplate, { nmax, workgroupSize, onTheFly, rotorShared, subgroups }),
  })
  const compile = await module.getCompilationInfo()
  const errors = compile.messages.filter((m) => m.type === 'error')
  if (errors.length > 0) {
    device.destroy()
    throw new Error(`GPU shader failed to compile: ${errors.map((e) => `${e.lineNum}:${e.linePos} ${e.message}`).join('; ')}`)
  }

  const storage = (type: GPUBufferBindingType): GPUBindGroupLayoutEntry['buffer'] => ({ type })
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: SHADER_COMPUTE, buffer: storage('uniform') },
      ...[1, 2, 3, 4, 5].map((binding) => ({ binding, visibility: SHADER_COMPUTE, buffer: storage('read-only-storage') })),
      { binding: 6, visibility: SHADER_COMPUTE, buffer: storage('storage') },
    ],
  })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const [screenPipeline, refinePipeline] = await Promise.all([
    device.createComputePipelineAsync({ layout: pipelineLayout, compute: { module, entryPoint: 'screen' } }),
    device.createComputePipelineAsync({ layout: pipelineLayout, compute: { module, entryPoint: 'refine' } }),
  ])

  const buffers: GPUBuffer[] = []
  const makeBuffer = (size: number, usage: number): GPUBuffer => {
    const b = device.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage })
    buffers.push(b)
    return b
  }
  const upload = (data: Uint32Array, usage = BUFFER.STORAGE): GPUBuffer => {
    const b = makeBuffer(data.byteLength, usage | BUFFER.COPY_DST)
    device.queue.writeBuffer(b, 0, data)
    return b
  }

  // Per-search buffers.
  const cipher = cipherBuffer(ctx.layout)
  const t = ctx.tuning
  const screenPairs = pairList(ctx.order, t.screenLetters)
  const refinePairs = pairList(ctx.order, t.refineLetters)
  const finalPairs = pairList(ctx.order, 26)
  const allPairs = new Uint32Array(screenPairs.length + refinePairs.length + finalPairs.length)
  allPairs.set(screenPairs, 0)
  allPairs.set(refinePairs, screenPairs.length)
  allPairs.set(finalPairs, screenPairs.length + refinePairs.length)
  const cipherGpu = upload(cipher.data)
  const pairsGpu = upload(allPairs)
  const keep = Math.max(1, t.refineKeep)

  /**
   * A lane: the per-unit buffers of one rotor unit in flight. Two lanes let the worker submit the
   * next unit's GPU work while it reads back and post-processes the previous one, so the GPU's
   * queue never runs dry between units.
   */
  interface Lane {
    tablesGpu: GPUBuffer
    paramsGpu: GPUBuffer
    tables: Uint32Array
    resultsGpu: GPUBuffer | null
    readGpu: GPUBuffer | null
    jobsGpu: GPUBuffer | null
    planGpu: GPUBuffer | null
    planFor: UnitPlan | null
    planLayout: ReturnType<typeof planBuffer> | null
  }
  const makeLane = (): Lane => ({
    tablesGpu: makeBuffer(TABLES.words * 4, BUFFER.STORAGE | BUFFER.COPY_DST),
    paramsGpu: makeBuffer(paramsBuffer({} as Params).byteLength, BUFFER.UNIFORM | BUFFER.COPY_DST),
    tables: new Uint32Array(TABLES.words),
    resultsGpu: null,
    readGpu: null,
    jobsGpu: null,
    planGpu: null,
    planFor: null,
    planLayout: null,
  })
  const free: Lane[] = Array.from({ length: LANES }, makeLane)
  const waiting: ((lane: Lane) => void)[] = []
  const acquire = (): Promise<Lane> => {
    const lane = free.pop()
    return lane ? Promise.resolve(lane) : new Promise((resolve) => waiting.push(resolve))
  }
  const release = (lane: Lane): void => {
    const next = waiting.shift()
    if (next) next(lane)
    else free.push(lane)
  }

  const ensureResults = (lane: Lane, bytes: number): void => {
    if (lane.resultsGpu && lane.resultsGpu.size >= bytes) return
    lane.resultsGpu?.destroy()
    lane.readGpu?.destroy()
    lane.resultsGpu = makeBuffer(bytes, BUFFER.STORAGE | BUFFER.COPY_SRC)
    lane.readGpu = makeBuffer(bytes, BUFFER.MAP_READ | BUFFER.COPY_DST)
  }
  const ensureJobs = (lane: Lane, data: Uint32Array): void => {
    if (!lane.jobsGpu || lane.jobsGpu.size < data.byteLength) {
      lane.jobsGpu?.destroy()
      lane.jobsGpu = makeBuffer(Math.max(data.byteLength, 4096), BUFFER.STORAGE | BUFFER.COPY_DST)
    }
    device.queue.writeBuffer(lane.jobsGpu, 0, data)
  }
  const planBufferFor = (lane: Lane, plan: UnitPlan): ReturnType<typeof planBuffer> => {
    if (lane.planFor !== plan || !lane.planLayout) {
      lane.planLayout = planBuffer(plan)
      lane.planGpu?.destroy()
      lane.planGpu = upload(lane.planLayout.data)
      lane.planFor = plan
    }
    return lane.planLayout
  }

  const baseParams = (pl: ReturnType<typeof planBuffer>, plan: UnitPlan): Params => ({
    n,
    maxPlugs: ctx.maxPlugs,
    jobBase: 0,
    jobCount: 0,
    screenPasses: t.screenPasses,
    refinePasses: t.refinePasses,
    finalPasses: t.finalPasses,
    refineKeep: keep,
    screenBigram: t.screenRankBy === 'bigram' ? 1 : 0,
    rankBigram: t.rankBy === 'bigram' ? 1 : 0,
    variantsPerPos: pl.variantsPerPos,
    nScreenRings: plan.screenRings.length,
    pairsScreenOff: 0,
    pairsScreenCount: screenPairs.length,
    pairsRefineOff: screenPairs.length,
    pairsRefineCount: refinePairs.length,
    pairsFinalOff: screenPairs.length + refinePairs.length,
    pairsFinalCount: finalPairs.length,
    planScreenStride: pl.screenStride,
    planAllOff: pl.allOff,
    planAllStride: pl.allStride,
    planScreenRingsOff: pl.screenRingsOff,
    planSweepOff: pl.sweepOff,
    classStartOff: cipher.classStartOff,
    classRankOff: cipher.classRankOff,
    tabMapOff: cipher.tabMapOff,
    classPosOff: cipher.classPosOff,
    pad1: 0,
  })

  const bindGroup = (lane: Lane): GPUBindGroup =>
    device.createBindGroup({
      layout,
      entries: [lane.paramsGpu, cipherGpu, lane.tablesGpu, pairsGpu, lane.planGpu!, lane.jobsGpu ?? pairsGpu, lane.resultsGpu!].map(
        (buffer, binding) => ({ binding, resource: { buffer } }),
      ),
    })

  /** Runs `total` workgroups of a pipeline in chunks on a lane, then reads `words` u32 back. */
  const run = async (
    lane: Lane,
    pipeline: GPUComputePipeline,
    params: Params,
    total: number,
    chunk: number,
    words: number,
    onChunk?: (done: number) => void,
  ): Promise<Uint32Array> => {
    ensureResults(lane, words * 4)
    const group = bindGroup(lane)
    let sinceSync = 0
    for (let base = 0; base < total; base += chunk) {
      device.queue.writeBuffer(lane.paramsGpu, 0, paramsBuffer({ ...params, jobBase: base, jobCount: total }))
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginComputePass()
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, group)
      pass.dispatchWorkgroups(Math.min(chunk, total - base))
      pass.end()
      device.queue.submit([encoder.finish()])
      if (++sinceSync >= SYNC_EVERY || base + chunk >= total) {
        sinceSync = 0
        await device.queue.onSubmittedWorkDone()
        onChunk?.(Math.min(total, base + chunk))
      }
    }
    const read = lane.readGpu!
    const encoder = device.createCommandEncoder()
    encoder.copyBufferToBuffer(lane.resultsGpu!, 0, read, 0, words * 4)
    device.queue.submit([encoder.finish()])
    await read.mapAsync(MAP_READ_MODE, 0, words * 4)
    const out = new Uint32Array(read.getMappedRange(0, words * 4).slice(0))
    read.unmap()
    return out
  }

  const screenOn = async (
    lane: Lane,
    plan: UnitPlan,
    inner: Uint8Array,
    onProgress?: (positions: number) => void,
  ): Promise<ScreenResult> => {
    tablesBuffer(plan, inner, ctx.ngrams, lane.tables)
    device.queue.writeBuffer(lane.tablesGpu, 0, lane.tables)
    const pl = planBufferFor(lane, plan)
    const total = 17576 * pl.variantsPerPos
    const out = await run(lane, screenPipeline, baseParams(pl, plan), total, CHUNK_SCREEN, total * SCREEN_STRIDE, (done) =>
      onProgress?.(Math.floor(done / pl.variantsPerPos)),
    )
    const result: ScreenResult = { screen: new Float64Array(17576), screenP: new Uint8Array(17576 * 26) }
    reduceScreen(out, pl.variantsPerPos, result.screen, result.screenP)
    return result
  }

  const withLane = async <T>(work: (lane: Lane) => Promise<T>): Promise<T> => {
    const lane = await acquire()
    try {
      return await work(lane)
    } finally {
      release(lane)
    }
  }

  const stages: UnitStages = (plan, _g, inner, onProgress) =>
    withLane(async (lane) => {
      const sc = await screenOn(lane, plan, inner, onProgress)
      const selection = refineSelection(ctx, sc.screen)
      const pl = planBufferFor(lane, plan)
      ensureJobs(lane, refineJobs(selection, sc.screenP))
      const out = await run(lane, refinePipeline, baseParams(pl, plan), selection.length, CHUNK_REFINE, selection.length * keep * FINAL_STRIDE)
      const finals: RefineFinal[] = []
      for (let k = 0; k < selection.length; k++) {
        for (let f = 0; f < keep; f++) {
          const o = (k * keep + f) * FINAL_STRIDE
          if (out[o + 11] !== 1) continue
          finals.push({ idx: selection[k], r: out[o], rm: out[o + 1], sumSq: out[o + 2], bigramSum: out[o + 3], P: unpackPlugs(out, o + 4) })
        }
      }
      return finals
    })

  const info = adapter.info
  return {
    stages,
    screen: (plan, inner) => withLane((lane) => screenOn(lane, plan, inner)),
    adapter: [info?.vendor, info?.architecture || info?.description].filter(Boolean).join(' ') || 'GPU',
    kernel: subgroups ? 'subgroup' : 'workgroup',
    lost,
    dispose() {
      for (const b of buffers) b.destroy()
      device.destroy()
    },
  }
}
