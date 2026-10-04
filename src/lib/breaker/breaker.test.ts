import { describe, expect, it } from 'vitest'
import { encryptText } from '../enigma/machine'
import { randomSettings } from '../enigma/settings'
import type { MachineSettings } from '../enigma/types'
import { createBreaker } from './breaker'
import { defaultBreakerConfig } from './config'
import { PASSAGES } from './data/passages'
import type { WorkerRequest, WorkerResponse } from './protocol'
import { mulberry32 } from './random'
import { readNgramFile, readWordFile } from './test-data'
import { lettersOnly } from './text'
import type { Breaker, BreakerConfig, BreakerSnapshot } from './types'
import { createWorkerHandler } from './worker-handler'

/** In-thread stand-in for a module Worker: same handler, asynchronous structured-clone messaging. */
class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false
  static created = 0
  static terminatedCount = 0
  private readonly handle = createWorkerHandler((msg) => {
    const copy = structuredClone(msg)
    setTimeout(() => {
      if (!this.terminated) this.onmessage?.({ data: copy } as MessageEvent<WorkerResponse>)
    }, 0)
  })

  constructor() {
    FakeWorker.created++
  }

  postMessage(msg: WorkerRequest): void {
    const copy = structuredClone(msg)
    setTimeout(() => {
      if (!this.terminated) this.handle(copy)
    }, 0)
  }

  terminate(): void {
    if (!this.terminated) FakeWorker.terminatedCount++
    this.terminated = true
  }
}

const loadNgrams = async (language: 'de' | 'en'): Promise<ArrayBuffer> => readNgramFile(language).slice().buffer
const loadWords = async (language: 'de' | 'en'): Promise<string> => readWordFile(language)

function fakeBreaker(): Breaker {
  return createBreaker({
    createWorker: () => new FakeWorker() as unknown as Worker,
    loadNgrams,
    loadWords,
    tuning: { survivors: 40, finalists: 4, wordCandidates: 3 },
  })
}

function settled(b: Breaker): Promise<BreakerSnapshot> {
  return new Promise((resolve) => {
    const check = () => {
      const s = b.getSnapshot()
      if (s.progress.phase === 'done' || s.progress.phase === 'error' || s.progress.phase === 'cancelled') {
        unsubscribe()
        resolve(s)
      }
    }
    const unsubscribe = b.subscribe(check)
    check()
  })
}

function challenge(): { config: BreakerConfig; plain: string; settings: MachineSettings } {
  const settings: MachineSettings = {
    ...randomSettings('I', mulberry32(8)),
    reflector: 'UKW-B',
    left: { rotor: 'II', ring: 0, position: 5 },
    middle: { rotor: 'III', ring: 0, position: 17 },
    right: { rotor: 'I', ring: 0, position: 9 },
  }
  const plain = PASSAGES.de.map((p) => lettersOnly(p.text)).join('').slice(5000, 5260)
  const config: BreakerConfig = {
    ...defaultBreakerConfig('I'),
    ciphertext: encryptText(settings, plain, { nonLetters: 'remove' }).output.toLowerCase(),
    rotors: ['I', 'II', 'III'],
    ringSearch: 'none',
    workers: 2,
  }
  return { config, plain, settings }
}

describe('createBreaker', () => {
  it('starts idle with a stable snapshot', () => {
    const b = createBreaker()
    const s = b.getSnapshot()
    expect(s.progress.phase).toBe('idle')
    expect(s.config).toBeNull()
    expect(b.getSnapshot()).toBe(s)
    b.dispose()
  })

  it('reports an invalid config as an error', () => {
    const b = createBreaker()
    let calls = 0
    b.subscribe(() => calls++)
    b.start({ ...defaultBreakerConfig('I'), ciphertext: 'ABC' })
    const s = b.getSnapshot()
    expect(s.progress.phase).toBe('error')
    expect(s.error).toMatch(/10 letters/)
    expect(s.config?.ciphertext).toBe('ABC')
    expect(calls).toBe(1)
    expect(b.getSnapshot()).toBe(s)
    b.dispose()
  })

  it('needs Web Workers', () => {
    expect(typeof Worker).toBe('undefined')
    const b = createBreaker({ loadNgrams })
    b.start({ ...challenge().config })
    expect(b.getSnapshot().error).toMatch(/Web Workers/)
    b.dispose()
  })

  it('runs all phases on a worker pool and finds the key', async () => {
    const { config, plain } = challenge()
    const b = fakeBreaker()
    const phases: string[] = []
    let emits = 0
    b.subscribe(() => {
      emits++
      const p = b.getSnapshot().progress.phase
      if (phases[phases.length - 1] !== p) phases.push(p)
    })
    const created = FakeWorker.created
    const started = performance.now()
    b.start(config)
    expect(b.getSnapshot().progress.phase).toBe('loading')
    const s = await settled(b)
    const elapsed = performance.now() - started

    expect(phases).toEqual(['loading', 'rotors', 'rings', 'plugboard', 'words', 'done'])
    expect(FakeWorker.created - created).toBe(2)
    expect(s.error).toBeNull()
    expect(s.config).toEqual(config)
    expect(s.progress).toMatchObject({ phase: 'done', phaseIndex: 4, phaseCount: 4, workers: 2, etaMs: 0 })
    expect(s.progress.done).toBe(s.progress.total)
    expect(s.progress.keysTested).toBeGreaterThan(6 * 17576)
    expect(s.progress.keysPerSecond).toBeGreaterThan(0)
    expect(s.candidates.length).toBeGreaterThan(0)
    expect(s.candidates.length).toBeLessThanOrEqual(20)
    const best = s.candidates[0]
    expect(best.plaintext).toBe(plain)
    expect(['plugboard', 'words']).toContain(best.phase)
    expect(best.words?.coverage).toBeGreaterThan(0.85)
    expect(best.words?.segmented.replace(/ /g, '')).toBe(plain)
    expect(s.candidates.length).toBeLessThanOrEqual(3)
    expect(best.id).toMatch(/^I\.UKW-B\.II-III-I\./)
    expect(encryptText(best.settings, config.ciphertext, { nonLetters: 'remove' }).output).toBe(plain)
    // Throttled: about 10 snapshots per second plus the phase changes.
    expect(emits).toBeLessThan(elapsed / 100 + 15)
    expect(b.getSnapshot()).toBe(s)
    b.dispose()
  }, 60_000)

  it('cancels a running search and terminates its workers', async () => {
    const b = fakeBreaker()
    const terminated = FakeWorker.terminatedCount
    b.start(challenge().config)
    await new Promise((r) => setTimeout(r, 30))
    b.cancel()
    const s = b.getSnapshot()
    expect(s.progress.phase).toBe('cancelled')
    expect(FakeWorker.terminatedCount - terminated).toBe(2)
    // Late messages of the cancelled run are ignored.
    await new Promise((r) => setTimeout(r, 50))
    expect(b.getSnapshot()).toBe(s)
    b.dispose()
  })
})

/**
 * Scripted worker for the scheduler: a GPU worker finishes rotor units fast, CPU workers slowly;
 * later phases return nothing. Records which worker ran which unit.
 */
class ScriptedWorker {
  static log: { worker: number; gpu: boolean; unit: string }[] = []
  /** Most rotor units a GPU worker held at the same time. */
  static gpuPeak = 0
  static inits: { worker: number; gpu: boolean }[] = []
  static created = 0
  static terminated = 0
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  private readonly id = ScriptedWorker.created++
  private gpu = false
  private dead = false
  private inFlight = 0

  postMessage(msg: WorkerRequest): void {
    const reply = (data: WorkerResponse, delay: number): void => {
      setTimeout(() => {
        if (!this.dead) this.onmessage?.({ data } as MessageEvent<WorkerResponse>)
      }, delay)
    }
    if (msg.type === 'init') {
      this.gpu = msg.gpu === true
      ScriptedWorker.inits.push({ worker: this.id, gpu: this.gpu })
      reply({ type: 'ready', runId: msg.runId, gpu: this.gpu ? 'test gpu' : null }, 0)
    } else if (msg.type === 'rotors') {
      const u = msg.unit
      ScriptedWorker.log.push({ worker: this.id, gpu: this.gpu, unit: `${u.left}-${u.middle}-${u.right}` })
      this.inFlight++
      if (this.gpu) ScriptedWorker.gpuPeak = Math.max(ScriptedWorker.gpuPeak, this.inFlight)
      setTimeout(() => this.inFlight--, this.gpu ? 2 : 40)
      reply({ type: 'done', runId: msg.runId, task: msg.task, candidates: [], keys: 17576 }, this.gpu ? 2 : 40)
    } else {
      reply({ type: 'done', runId: msg.runId, task: msg.task, candidates: [], keys: 0 }, 0)
    }
  }

  terminate(): void {
    if (!this.dead) ScriptedWorker.terminated++
    this.dead = true
  }
}

describe('GPU + CPU scheduling', () => {
  const withGpu = (present: boolean): void => {
    if (present) Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true })
    else Reflect.deleteProperty(navigator, 'gpu')
  }
  const scripted = (): Breaker =>
    createBreaker({ createWorker: () => new ScriptedWorker() as unknown as Worker, loadNgrams, loadWords })
  const reset = (): void => {
    ScriptedWorker.log = []
    ScriptedWorker.inits = []
    ScriptedWorker.created = 0
    ScriptedWorker.terminated = 0
    ScriptedWorker.gpuPeak = 0
  }

  it('runs one GPU worker beside the CPU workers and counts every rotor unit exactly once', async () => {
    reset()
    withGpu(true)
    try {
      const b = scripted()
      b.start({ ...defaultBreakerConfig('I'), ciphertext: 'A'.repeat(120), workers: 4 })
      const snap = await settled(b)
      expect(snap.progress.phase).toBe('done')
      expect(snap.progress.gpu).toBe('test gpu')
      // 4 workers in total, one of them the GPU worker.
      expect(ScriptedWorker.inits.slice(0, 4).filter((i) => i.gpu)).toHaveLength(1)
      // Every one of the 60 units ran, the GPU ran most of them, and none was counted twice.
      const units = new Set(ScriptedWorker.log.map((l) => l.unit))
      expect(units.size).toBe(60)
      expect(ScriptedWorker.log.filter((l) => l.gpu).length).toBeGreaterThan(30)
      expect(snap.progress.keysTested).toBe(60 * 17576)
      // Every unit is credited to exactly one processor.
      expect((snap.progress.unitsByGpu ?? 0) + (snap.progress.unitsByCpu ?? 0)).toBe(60)
      expect(snap.progress.unitsByGpu).toBeGreaterThan(30)
      // The GPU worker gets two rotor units at a time, so its queue never runs dry.
      expect(ScriptedWorker.gpuPeak).toBe(2)
      b.dispose()
    } finally {
      withGpu(false)
    }
  })

  it('duplicates the last CPU units on the GPU and restarts the CPU workers that lost', async () => {
    reset()
    withGpu(true)
    try {
      const b = scripted()
      b.start({ ...defaultBreakerConfig('I'), ciphertext: 'A'.repeat(120), workers: 4 })
      await settled(b)
      const byUnit = new Map<string, boolean[]>()
      for (const l of ScriptedWorker.log) byUnit.set(l.unit, [...(byUnit.get(l.unit) ?? []), l.gpu])
      const duplicated = [...byUnit.values()].filter((runs) => runs.length > 1)
      expect(duplicated.length).toBeGreaterThan(0)
      for (const runs of duplicated) expect(runs).toEqual([false, true])
      // Each duplicate won by the GPU cost the CPU worker its life (it is restarted).
      expect(ScriptedWorker.terminated).toBeGreaterThanOrEqual(duplicated.length)
      b.dispose()
    } finally {
      withGpu(false)
    }
  })

  it('uses CPU workers only with backend "cpu" or without WebGPU', async () => {
    for (const [gpu, backend] of [[true, 'cpu'], [false, 'auto']] as const) {
      reset()
      withGpu(gpu)
      try {
        const b = scripted()
        b.start({ ...defaultBreakerConfig('I'), ciphertext: 'A'.repeat(120), workers: 3, backend })
        const snap = await settled(b)
        expect(snap.progress.phase).toBe('done')
        expect(snap.progress.gpu ?? null).toBeNull()
        expect(ScriptedWorker.inits.every((i) => !i.gpu)).toBe(true)
        b.dispose()
      } finally {
        withGpu(false)
      }
    }
  })
})
