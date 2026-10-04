/**
 * The Breaker: a pool of Web Workers running the four search phases, publishing
 * useSyncExternalStore-friendly snapshots (a new object only when something changed, at most
 * ~10 per second while running).
 */
import { MODELS } from '../enigma/constants'
import deNgramsUrl from './data/ngrams-de.bin?url'
import enNgramsUrl from './data/ngrams-en.bin?url'
import deWordsUrl from './data/words-de.txt?url'
import enWordsUrl from './data/words-en.txt?url'
import { MAX_SHOWN, mergeTop, rankFinal, toBreakerCandidate } from './pipeline'
import type { WorkerRequest, WorkerResponse } from './protocol'
import { DEFAULT_TUNING, rotorUnits, unitKeys } from './search'
import type { CoreCandidate, RotorUnit, SearchTuning } from './search'
import { estimatePhaseSeconds, validateBreakerConfig } from './config'
import { toCodes } from './text'
import { parseDictionary } from './words'
import type { WordDictionary } from './words'
import type {
  Breaker,
  BreakerCandidate,
  BreakerConfig,
  BreakerLanguage,
  BreakerPhase,
  BreakerProgress,
  BreakerSnapshot,
} from './types'

const NGRAM_URLS: Record<BreakerLanguage, string> = { de: deNgramsUrl, en: enNgramsUrl }
const WORD_URLS: Record<BreakerLanguage, string> = { de: deWordsUrl, en: enWordsUrl }
const ngramCache = new Map<BreakerLanguage, Promise<ArrayBuffer>>()
const wordCache = new Map<BreakerLanguage, Promise<string>>()
const dictionaryCache = new Map<BreakerLanguage, Promise<WordDictionary>>()

/** Fetches (once per page) the word list of a language. */
function fetchWords(language: BreakerLanguage): Promise<string> {
  let p = wordCache.get(language)
  if (!p) {
    p = fetch(WORD_URLS[language]).then((res) => {
      if (!res.ok) throw new Error(`Could not load the ${language} dictionary (HTTP ${res.status}).`)
      return res.text()
    })
    p.catch(() => wordCache.delete(language))
    wordCache.set(language, p)
  }
  return p
}

/**
 * The dictionary of a language for scoreWords (fetched lazily, parsed once, cached). The
 * breaker's workers load their own copy; this one is for the UI.
 */
export function loadDictionary(language: BreakerLanguage): Promise<WordDictionary> {
  let p = dictionaryCache.get(language)
  if (!p) {
    p = fetchWords(language).then((text) => parseDictionary(text, language))
    p.catch(() => dictionaryCache.delete(language))
    dictionaryCache.set(language, p)
  }
  return p
}

/** Fetches (once per page) the n-gram statistics of a language. */
function fetchNgrams(language: BreakerLanguage): Promise<ArrayBuffer> {
  let p = ngramCache.get(language)
  if (!p) {
    p = fetch(NGRAM_URLS[language]).then((res) => {
      if (!res.ok) throw new Error(`Could not load the ${language} language statistics (HTTP ${res.status}).`)
      return res.arrayBuffer()
    })
    p.catch(() => ngramCache.delete(language))
    ngramCache.set(language, p)
  }
  return p
}

const PUBLISH_INTERVAL_MS = 100
const PHASE_NUMBER: Record<BreakerPhase, number> = {
  idle: 0,
  loading: 0,
  rotors: 1,
  rings: 2,
  plugboard: 3,
  words: 4,
  done: 4,
  cancelled: 0,
  error: 0,
}

type Task =
  | { kind: 'rotors'; unit: RotorUnit; index: number }
  | { kind: 'rings'; candidates: CoreCandidate[] }
  | { kind: 'plugboard'; candidate: CoreCandidate; seed: number }
  | { kind: 'words'; candidate: CoreCandidate; polish: boolean }

interface Slot {
  worker: Worker
  ready: boolean
  /** Running task ids → when they started (one task per worker; two rotor units on the GPU). */
  tasks: Map<number, number>
  /** Spawned as the GPU worker (phase 1 on WebGPU when available). */
  gpu: boolean
  /** The GPU's name once the worker reported it runs phase 1 there, else null. */
  gpuName: string | null
}

/** Rotor units a GPU worker works on at once (matches the GPU backend's buffer lanes). */
const GPU_UNITS_IN_FLIGHT = 2

/** How many tasks a worker may hold now. */
function capacity(slot: Slot, phase: BreakerPhase): number {
  return slot.gpuName && phase === 'rotors' ? GPU_UNITS_IN_FLIGHT : 1
}

interface Run {
  id: number
  config: BreakerConfig
  tuning: SearchTuning
  cipher: Uint8Array
  started: number
  phase: BreakerPhase
  slots: Slot[]
  queue: Task[]
  running: Map<number, Task>
  nextTask: number
  phaseTotal: number
  phaseDone: number
  phaseStarted: number
  units: RotorUnit[]
  unitKeysDone: Map<number, number>
  rotorKeysTotal: number
  rotorKeysDone: number
  unitsDone: number
  keysTested: number
  survivors: CoreCandidate[]
  ringed: CoreCandidate[]
  results: CoreCandidate[]
  checked: CoreCandidate[]
  /** Candidates currently shown (internal), best first. */
  shown: CoreCandidate[]
  message: string
  /** Data for (re)spawning workers. */
  ngrams: ArrayBuffer | null
  words: string
  /** Rotor units already finished (a duplicate run of one is ignored). */
  doneUnits: Set<number>
  /** Name of the GPU running phase 1, or null. */
  gpuName: string | null
  /** Rotor units finished on the GPU / on CPU workers. */
  unitsByGpu: number
  unitsByCpu: number
  /** Engine the CPU workers reported (WebAssembly SIMD or JavaScript). */
  cpuEngine: 'wasm' | 'js' | null
}

const IDLE_PROGRESS: BreakerProgress = {
  phase: 'idle',
  phaseIndex: 0,
  phaseCount: 4,
  done: 0,
  total: 0,
  keysTested: 0,
  keysPerSecond: 0,
  elapsedMs: 0,
  etaMs: null,
  workers: 0,
  message: '',
}

export interface BreakerOptions {
  /** Search tuning overrides (benchmarks / tests). */
  tuning?: Partial<SearchTuning>
  /** Worker factory (defaults to the bundled module worker). */
  createWorker?: () => Worker
  /** Loader of the raw ngrams-<lang>.bin data (defaults to fetching the bundled asset). */
  loadNgrams?: (language: BreakerLanguage) => Promise<ArrayBuffer>
  /** Loader of the words-<lang>.txt list (defaults to fetching the bundled asset). */
  loadWords?: (language: BreakerLanguage) => Promise<string>
}

/** WebGPU exposed by this browser (a worker still checks for an adapter and falls back). */
function gpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && Boolean((navigator as Navigator & { gpu?: unknown }).gpu)
}

function defaultWorker(): Worker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
}

export function createBreaker(options: BreakerOptions = {}): Breaker {
  const listeners = new Set<() => void>()
  let snapshot: BreakerSnapshot = { progress: IDLE_PROGRESS, candidates: [], error: null, config: null }
  let run: Run | null = null
  let runCounter = 0
  let lastPublish = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let shownCache: { key: string; list: BreakerCandidate[] } = { key: '', list: [] }

  const emit = (): void => {
    for (const l of [...listeners]) l()
  }

  const candidatesOf = (r: Run): BreakerCandidate[] => {
    const key = r.shown.map((c) => `${c.phase}:${c.score}:${c.plugs.join(',')}:${c.key.posL}${c.key.posM}${c.key.posR}${c.key.ringM}${c.key.ringR}`).join('|')
    if (key !== shownCache.key) {
      shownCache = { key, list: r.shown.map((c) => toBreakerCandidate(r.config.model, c, r.cipher)) }
    }
    return shownCache.list
  }

  const etaOf = (r: Run, now: number): number | null => {
    const est = estimatePhaseSeconds(r.config, r.tuning)
    const workers = Math.max(1, r.slots.length)
    const inPhase = (now - r.phaseStarted) / 1000
    const fraction = r.phaseTotal > 0 ? r.phaseDone / r.phaseTotal : 0
    const remainingThis = fraction > 0.02 ? (inPhase / fraction) * (1 - fraction) : null
    if (r.phase === 'loading') return (est.rotors + est.rings + est.plugboard + est.words) * 1000
    if (r.phase === 'rotors') {
      const rest = remainingThis ?? est.rotors * (1 - fraction)
      // Scale the later phases by how fast phase 1 runs compared with its estimate.
      const speed = fraction > 0.02 ? inPhase / fraction / Math.max(0.001, est.rotors) : 1
      return (rest + (est.rings + est.plugboard + est.words) * speed) * 1000
    }
    if (r.phase === 'rings') return ((remainingThis ?? est.rings / workers) + est.plugboard + est.words) * 1000
    if (r.phase === 'plugboard') return ((remainingThis ?? est.plugboard) + est.words) * 1000
    if (r.phase === 'words') return (remainingThis ?? est.words) * 1000
    return null
  }

  const buildSnapshot = (): BreakerSnapshot => {
    const r = run
    if (!r) return snapshot
    const now = performance.now()
    const elapsedMs = now - r.started
    const progress: BreakerProgress = {
      phase: r.phase,
      phaseIndex: PHASE_NUMBER[r.phase],
      phaseCount: 4,
      done: r.phaseDone,
      total: r.phaseTotal,
      keysTested: r.keysTested,
      keysPerSecond: elapsedMs > 0 ? Math.round((r.keysTested / elapsedMs) * 1000) : 0,
      elapsedMs: Math.round(elapsedMs),
      etaMs: (() => {
        const eta = etaOf(r, now)
        return eta === null ? null : Math.max(0, Math.round(eta))
      })(),
      workers: r.slots.length,
      gpu: r.gpuName,
      unitsByGpu: r.unitsByGpu,
      unitsByCpu: r.unitsByCpu,
      ...(r.cpuEngine ? { cpuEngine: r.cpuEngine } : {}),
      message: r.message,
    }
    return { progress, candidates: candidatesOf(r), error: null, config: r.config }
  }

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    lastPublish = performance.now()
    snapshot = buildSnapshot()
    emit()
  }

  const publish = (): void => {
    if (timer !== null) return
    const wait = Math.max(0, PUBLISH_INTERVAL_MS - (performance.now() - lastPublish))
    timer = setTimeout(flush, wait)
  }

  const stopWorkers = (r: Run): void => {
    for (const s of r.slots) s.worker.terminate()
    r.slots = []
  }

  const finish = (r: Run, phase: 'done' | 'cancelled' | 'error', error: string | null = null): void => {
    const workers = r.slots.length
    stopWorkers(r)
    r.phase = phase
    if (phase === 'done') {
      r.message = r.results.length > 0 ? 'Search complete.' : 'Search complete — no candidates found.'
      r.phaseDone = r.phaseTotal
    }
    if (phase === 'cancelled') r.message = 'Search cancelled.'
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    const base = buildSnapshot()
    snapshot = {
      ...base,
      progress: { ...base.progress, phase, etaMs: phase === 'done' ? 0 : null, workers, message: r.message },
      error,
    }
    run = null
    lastPublish = performance.now()
    emit()
  }

  const fail = (r: Run, message: string): void => {
    r.message = message
    finish(r, 'error', message)
  }

  const send = (slot: Slot, msg: WorkerRequest): void => slot.worker.postMessage(msg)

  const dispatch = (r: Run): void => {
    for (const slot of r.slots) {
      while (slot.ready && slot.tasks.size < capacity(slot, r.phase) && r.queue.length > 0) assign(r, slot, r.queue.shift()!)
    }
    if (r.phase === 'rotors' && r.queue.length === 0) duplicateTail(r)
    if (r.queue.length === 0 && r.running.size === 0) advance(r)
  }

  /** Sends a task to a worker. */
  const assign = (r: Run, slot: Slot, task: Task): void => {
      const id = r.nextTask++
      slot.tasks.set(id, performance.now())
      r.running.set(id, task)
      if (task.kind === 'rotors') {
        const threshold =
          r.survivors.length >= r.tuning.survivors ? r.survivors[r.survivors.length - 1].score : -Infinity
        send(slot, { type: 'rotors', runId: r.id, task: id, unit: task.unit, keep: r.tuning.survivors, threshold })
      } else if (task.kind === 'rings') {
        send(slot, { type: 'rings', runId: r.id, task: id, candidates: task.candidates })
      } else if (task.kind === 'plugboard') {
        send(slot, { type: 'plugboard', runId: r.id, task: id, candidate: task.candidate, seed: task.seed })
      } else {
        send(slot, { type: 'words', runId: r.id, task: id, candidate: task.candidate, polish: task.polish })
      }
  }

  /**
   * End of phase 1: an idle GPU worker re-runs the rotor unit a CPU worker started last (results
   * are bit-identical); whichever finishes first counts and the other worker is restarted.
   */
  const duplicateTail = (r: Run): void => {
    for (const slot of r.slots) {
      if (!slot.gpuName) continue
      while (slot.ready && slot.tasks.size < capacity(slot, r.phase)) {
        let pick: { task: Extract<Task, { kind: 'rotors' }>; started: number } | null = null
        for (const other of r.slots) {
          if (other === slot || other.gpuName) continue
          for (const [id, started] of other.tasks) {
            const t = r.running.get(id)
            if (!t || t.kind !== 'rotors' || r.doneUnits.has(t.index)) continue
            const copies = [...r.running.values()].filter((x) => x.kind === 'rotors' && x.index === t.index).length
            if (copies > 1) continue
            if (!pick || started > pick.started) pick = { task: t, started }
          }
        }
        if (!pick) return
        assign(r, slot, pick.task)
      }
    }
  }

  const startPhase = (
    r: Run,
    phase: 'rotors' | 'rings' | 'plugboard' | 'words',
    tasks: Task[],
    total: number,
  ): void => {
    r.phase = phase
    r.queue = tasks
    r.phaseTotal = total
    r.phaseDone = 0
    r.phaseStarted = performance.now()
    flush()
    dispatch(r)
  }

  const advance = (r: Run): void => {
    if (r.phase === 'rotors') {
      const chunk = Math.max(4, Math.ceil(r.survivors.length / (r.slots.length * 8)))
      const tasks: Task[] = []
      for (let i = 0; i < r.survivors.length; i += chunk) {
        tasks.push({ kind: 'rings', candidates: r.survivors.slice(i, i + chunk) })
      }
      r.message = `Searching ring settings of ${r.survivors.length} rotor candidates`
      startPhase(r, 'rings', tasks, r.survivors.length)
    } else if (r.phase === 'rings') {
      const tasks: Task[] = r.ringed.map((candidate, i) => ({ kind: 'plugboard', candidate, seed: i + 1 }))
      r.message = `Solving the plugboard of the best ${r.ringed.length} keys`
      startPhase(r, 'plugboard', tasks, r.ringed.length)
    } else if (r.phase === 'plugboard') {
      const checked = r.results.slice(0, r.tuning.wordCandidates)
      const tasks: Task[] = checked.map((candidate, i) => ({ kind: 'words', candidate, polish: i < r.tuning.wordPolish }))
      r.message = `Dictionary check of the best ${checked.length} keys`
      startPhase(r, 'words', tasks, checked.length)
    } else if (r.phase === 'words') {
      finish(r, 'done')
    }
  }

  const onResult = (r: Run, task: Task, candidates: CoreCandidate[], keys: number): void => {
    r.keysTested += keys
    if (task.kind === 'rotors') {
      r.unitsDone++
      r.rotorKeysDone += unitKeys(task.unit) - (r.unitKeysDone.get(task.index) ?? 0)
      r.unitKeysDone.delete(task.index)
      r.phaseDone = r.rotorKeysDone
      r.survivors = mergeTop(r.survivors, candidates, r.tuning.survivors)
      r.shown = r.survivors.slice(0, MAX_SHOWN)
      const u = task.unit
      const split = r.gpuName ? ` — GPU ${r.unitsByGpu}, CPU ${r.unitsByCpu}` : ''
      r.message = `Testing rotor orders: ${r.unitsDone} of ${r.units.length} done${split} (last ${u.greek ? `${u.greek} ` : ''}${u.left} ${u.middle} ${u.right}, ${u.reflector})`
    } else if (task.kind === 'rings') {
      r.phaseDone += task.candidates.length
      r.ringed = mergeTop(r.ringed, candidates, r.tuning.finalists)
      r.shown = r.ringed.slice(0, MAX_SHOWN)
      r.message = `Searching ring settings: ${r.phaseDone} of ${r.phaseTotal} rotor candidates`
    } else if (task.kind === 'plugboard') {
      r.phaseDone++
      r.results = rankFinal([...r.results, ...candidates])
      r.shown = r.results.slice(0, MAX_SHOWN)
      r.message = `Solving the plugboard: ${r.phaseDone} of ${r.phaseTotal} keys`
    } else {
      r.phaseDone++
      r.checked = rankFinal([...r.checked, ...candidates])
      r.shown = r.checked.slice(0, MAX_SHOWN)
      const coverage = r.checked[0]?.words?.coverage ?? 0
      r.message = `Dictionary check: ${Math.round(coverage * 100)}% of letters form words (${r.phaseDone} of ${r.phaseTotal} keys)`
    }
    publish()
  }

  const onMessage = (r: Run, slot: Slot, msg: WorkerResponse): void => {
    if (run !== r || msg.runId !== r.id) return
    if (msg.type === 'error') {
      fail(r, `Search failed: ${msg.message}`)
      return
    }
    if (msg.type === 'ready') {
      slot.ready = true
      if (msg.engine && !msg.gpu) r.cpuEngine = msg.engine
      if (msg.gpu) {
        slot.gpuName = msg.gpu
        r.gpuName = msg.gpu
        publish()
      }
      dispatch(r)
      return
    }
    const task = r.running.get(msg.task)
    if (!task) return
    if (msg.type === 'progress') {
      if (task.kind === 'rotors') {
        const prev = r.unitKeysDone.get(task.index) ?? 0
        if (msg.keys <= prev || r.doneUnits.has(task.index)) return
        r.unitKeysDone.set(task.index, msg.keys)
        r.rotorKeysDone += msg.keys - prev
        r.keysTested += msg.keys - prev
        r.phaseDone = r.rotorKeysDone
        publish()
      }
      return
    }
    r.running.delete(msg.task)
    slot.tasks.delete(msg.task)
    if (task.kind === 'rotors') {
      if (r.doneUnits.has(task.index)) {
        // A duplicate finished second: its (identical) result was already counted.
        dispatch(r)
        return
      }
      r.doneUnits.add(task.index)
      if (slot.gpuName) r.unitsByGpu++
      else r.unitsByCpu++
      // Progress messages already counted part of this unit's keys.
      r.keysTested -= r.unitKeysDone.get(task.index) ?? 0
      // Restart workers still busy with a copy of this unit, so they are free for new work; any
      // other task such a worker held goes back to the front of the queue.
      for (let k = 0; k < r.slots.length; k++) {
        const other = r.slots[k]
        if (other === slot) continue
        const ids = [...other.tasks.keys()]
        const copy = ids.some((id) => {
          const t = r.running.get(id)
          return t?.kind === 'rotors' && t.index === task.index
        })
        if (!copy) continue
        for (const id of ids) {
          const t = r.running.get(id)
          r.running.delete(id)
          if (t && !(t.kind === 'rotors' && (t.index === task.index || r.doneUnits.has(t.index)))) r.queue.unshift(t)
        }
        other.worker.terminate()
        try {
          r.slots[k] = spawnSlot(r, other.gpu)
        } catch (error) {
          fail(r, `Could not restart a Web Worker: ${error instanceof Error ? error.message : String(error)}`)
          return
        }
      }
    }
    onResult(r, task, msg.candidates, msg.keys)
    if (run === r) dispatch(r)
  }

  /** Starts one worker for the run and sends it the search data. */
  const spawnSlot = (r: Run, gpu: boolean): Slot => {
    const factory = options.createWorker ?? defaultWorker
    const worker = factory()
    const slot: Slot = { worker, ready: false, tasks: new Map(), gpu, gpuName: null }
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => onMessage(r, slot, event.data)
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault()
      if (run === r) fail(r, `A search worker crashed: ${event.message || 'unknown error'}`)
    }
    send(slot, {
      type: 'init',
      runId: r.id,
      config: r.config,
      ngrams: (r.ngrams as ArrayBuffer).slice(0),
      words: r.words,
      tuning: options.tuning ?? {},
      ...(gpu ? { gpu: true } : {}),
    })
    return slot
  }

  const launch = (r: Run, ngrams: ArrayBuffer, words: string): void => {
    r.ngrams = ngrams
    r.words = words
    const count = Math.max(1, Math.min(64, Math.floor(r.config.workers) || 1))
    // One of the workers drives the GPU (when there is one); it replaces a CPU worker so the
    // thread budget stays the same. Without WebGPU it simply works as a CPU worker.
    const withGpu = (r.config.backend ?? 'auto') === 'auto' && gpuAvailable()
    for (let i = 0; i < count; i++) {
      try {
        r.slots.push(spawnSlot(r, withGpu && i === 0))
      } catch (error) {
        fail(r, `Could not start a Web Worker: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
    }
    const tasks: Task[] = r.units.map((unit, index) => ({ kind: 'rotors', unit, index }))
    r.message = `Testing ${r.units.length} rotor orders × ${MODELS[r.config.model].hasGreek ? '26 Greek positions × ' : ''}17,576 start positions`
    startPhase(r, 'rotors', tasks, r.rotorKeysTotal)
  }

  const cancelRun = (): void => {
    if (run) finish(run, 'cancelled')
  }

  return {
    start(config: BreakerConfig) {
      cancelRun()
      const cfg: BreakerConfig = {
        ...config,
        rotors: [...config.rotors],
        reflectors: [...config.reflectors],
        greekRotors: [...config.greekRotors],
        crib: config.crib ? { ...config.crib } : null,
      }
      const issue = validateBreakerConfig(cfg)
      if (issue) {
        snapshot = {
          progress: { ...IDLE_PROGRESS, phase: 'error', message: issue },
          candidates: [],
          error: issue,
          config: cfg,
        }
        emit()
        return
      }
      if (typeof Worker === 'undefined' && !options.createWorker) {
        const message = 'Web Workers are not available in this environment.'
        snapshot = { progress: { ...IDLE_PROGRESS, phase: 'error', message }, candidates: [], error: message, config: cfg }
        emit()
        return
      }
      const tuning = { ...DEFAULT_TUNING, ...options.tuning }
      const units = rotorUnits(cfg)
      const r: Run = {
        id: ++runCounter,
        config: cfg,
        tuning,
        cipher: toCodes(cfg.ciphertext),
        started: performance.now(),
        phase: 'loading',
        slots: [],
        queue: [],
        running: new Map(),
        nextTask: 0,
        phaseTotal: 0,
        phaseDone: 0,
        phaseStarted: performance.now(),
        units,
        unitKeysDone: new Map(),
        rotorKeysTotal: units.reduce((sum, u) => sum + unitKeys(u), 0),
        rotorKeysDone: 0,
        unitsDone: 0,
        keysTested: 0,
        survivors: [],
        ringed: [],
        results: [],
        checked: [],
        shown: [],
        message: `Loading ${cfg.language === 'de' ? 'German' : 'English'} language statistics and dictionary…`,
        ngrams: null,
        words: '',
        doneUnits: new Set(),
        gpuName: null,
        unitsByGpu: 0,
        unitsByCpu: 0,
        cpuEngine: null,
      }
      run = r
      shownCache = { key: '', list: [] }
      flush()
      const loadNgrams = options.loadNgrams ?? fetchNgrams
      const loadWords = options.loadWords ?? fetchWords
      Promise.all([loadNgrams(cfg.language), loadWords(cfg.language)]).then(
        ([buffer, words]) => {
          if (run === r) launch(r, buffer, words)
        },
        (error: unknown) => {
          if (run === r) fail(r, error instanceof Error ? error.message : String(error))
        },
      )
    },
    cancel: cancelRun,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      if (run) {
        const r = run
        stopWorkers(r)
        run = null
      }
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      listeners.clear()
    },
  }
}
