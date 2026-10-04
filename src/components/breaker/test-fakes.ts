/**
 * Test double for the codebreaker engine (`src/lib/breaker`): a controllable Breaker plus
 * deterministic versions of the helper functions. Tests install it with
 * `vi.mock('../../lib/breaker', async () => (await import('./test-fakes')).fakeBreakerModule)`.
 */
import { vi } from 'vitest'
import { MODELS, defaultSettings, encodeSettings } from '../../lib/enigma'
import type { MachineSettings, ModelId } from '../../lib/enigma'
import type {
  Breaker,
  BreakerCandidate,
  BreakerConfig,
  BreakerProgress,
  BreakerSnapshot,
  SampleChallenge,
  SampleOptions,
  WorkEstimate,
} from '../../lib/breaker/types'

const IDLE: BreakerSnapshot = {
  progress: {
    phase: 'idle',
    phaseIndex: 0,
    phaseCount: 3,
    done: 0,
    total: 0,
    keysTested: 0,
    keysPerSecond: 0,
    elapsedMs: 0,
    etaMs: null,
    workers: 0,
    message: '',
  },
  candidates: [],
  error: null,
  config: null,
}

export interface SnapshotPatch extends Partial<Omit<BreakerSnapshot, 'progress'>> {
  progress?: Partial<BreakerProgress>
}

export class FakeBreaker implements Breaker {
  snapshot: BreakerSnapshot = IDLE
  readonly starts: BreakerConfig[] = []
  cancels = 0
  disposed = false
  private readonly listeners = new Set<() => void>()

  start(config: BreakerConfig): void {
    this.starts.push(config)
    this.emit({
      config,
      candidates: [],
      error: null,
      progress: { ...IDLE.progress, phase: 'loading', workers: config.workers, message: 'Starting workers…' },
    })
  }

  cancel(): void {
    this.cancels++
    this.emit({ progress: { phase: 'cancelled', message: 'Search stopped.' } })
  }

  getSnapshot(): BreakerSnapshot {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispose(): void {
    this.disposed = true
  }

  /** Publishes a new snapshot (merged into the current one) and notifies subscribers. */
  emit(patch: SnapshotPatch): void {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      progress: { ...this.snapshot.progress, ...patch.progress },
    }
    for (const listener of this.listeners) listener()
  }
}

/** Every breaker the page created, oldest first. */
export const fakeBreakers: FakeBreaker[] = []

export function lastBreaker(): FakeBreaker {
  const b = fakeBreakers.at(-1)
  if (!b) throw new Error('no breaker was created')
  return b
}

function lettersOnly(text: string): string {
  return text.toUpperCase().replace(/[^A-Z]/g, '')
}

function defaultBreakerConfig(model: ModelId = 'I'): BreakerConfig {
  const spec = MODELS[model]
  return {
    ciphertext: '',
    model,
    rotors: [...spec.rotorIds],
    reflectors: model === 'M4' ? ['UKW-B-thin'] : ['UKW-B'],
    greekRotors: [...spec.greekIds],
    ringSearch: 'right-middle',
    maxPlugs: 10,
    language: 'de',
    crib: null,
    workers: 3,
  }
}

/** 60 orders × 17,576 positions per reflector, at 100k keys/s per worker. */
function estimateWork(config: BreakerConfig): WorkEstimate {
  const n = config.rotors.length
  const orders = n * (n - 1) * (n - 2) * config.reflectors.length
  const keys = orders * 17576
  return { orders, keys, seconds: keys / (100000 * config.workers) }
}

export const SAMPLE_SETTINGS: MachineSettings = {
  ...defaultSettings('I'),
  left: { rotor: 'II', ring: 0, position: 0 },
  middle: { rotor: 'IV', ring: 13, position: 3 },
  right: { rotor: 'I', ring: 21, position: 20 },
  plugboard: [
    [0, 1],
    [2, 3],
  ],
}

export const SAMPLE_PLAINTEXT = 'DASOBERKOMMANDODERWEHRMACHTGIBTBEKANNT'.repeat(4)

export const SAMPLE: SampleChallenge = {
  ciphertext: 'QWERT ZUIOP ASDFG HJKLY XCVBN MQWER TZUIO PASDF GHJKL YXCVB NM'.repeat(3),
  plaintext: SAMPLE_PLAINTEXT,
  settings: SAMPLE_SETTINGS,
  source: 'Wehrmachtbericht, 1941',
}

export const fakeBreakerModule = {
  createBreaker: (): Breaker => {
    const b = new FakeBreaker()
    fakeBreakers.push(b)
    return b
  },
  defaultBreakerConfig,
  estimateWork,
  sampleChallenge: vi.fn((options: SampleOptions): SampleChallenge => ({
    ...SAMPLE,
    settings: { ...SAMPLE.settings, model: options.model },
  })),
  describeKey: (settings: MachineSettings) => `KEY ${encodeSettings(settings)}`,
  lettersOnly,
}

/** A candidate whose plaintext and key are distinguishable by `rank` (1-based). */
export function makeCandidate(rank: number, overrides: Partial<BreakerCandidate> = {}): BreakerCandidate {
  const settings: MachineSettings = {
    ...SAMPLE_SETTINGS,
    right: { ...SAMPLE_SETTINGS.right, position: rank },
  }
  return {
    id: `cand-${rank}`,
    settings,
    score: 1000 - rank * 100,
    ioc: rank === 1 ? 0.072 : 0.041,
    plaintext: rank === 1 ? SAMPLE_PLAINTEXT : 'XQZVJ'.repeat(30).slice(0, SAMPLE_PLAINTEXT.length),
    phase: 'plugboard',
    ...overrides,
  }
}
