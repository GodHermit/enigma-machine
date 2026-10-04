import { MODELS, MODEL_ORDER } from '../../lib/enigma'
import type { GreekRotorId, ModelId, ReflectorId, RotorId } from '../../lib/enigma'
import type { BreakerConfig, BreakerLanguage, RingSearch } from '../../lib/breaker/types'
import { hardwareThreads, letters, safeDefaults } from './safe-engine'

/** Versioned localStorage key of the codebreaker form (results are never stored). */
export const FORM_STORAGE_KEY = 'enigma-tools:breaker:v1'

/** Longer ciphertexts are not persisted (keeps localStorage small). */
const MAX_STORED_CIPHERTEXT = 20000

/** Fewer letters than this cannot be attacked meaningfully. */
export const MIN_LETTERS = 30
/** Below this many letters a "short message" hint is shown. */
export const SHORT_LETTERS = 150
export const MIN_ROTORS = 3
export const MAX_CABLES = 13

const LANGUAGES: readonly BreakerLanguage[] = ['de', 'en']
const RING_SEARCHES: readonly RingSearch[] = ['right-middle', 'right', 'none']

/** Dictionary-check typo tolerance (share of a word's letters that may be wrong); mirrors the engine's limits. */
export const DEFAULT_TYPO_TOLERANCE = 0.2
export const MAX_TYPO_TOLERANCE = 0.34

export interface BreakerForm {
  ciphertext: string
  model: ModelId
  language: BreakerLanguage
  rotors: RotorId[]
  reflectors: ReflectorId[]
  greekRotors: GreekRotorId[]
  ringSearch: RingSearch
  maxPlugs: number
  /** true: exactly `maxPlugs` cables; false: any number up to it. */
  exactPlugs: boolean
  /** Known plaintext as typed (only its letters are used). */
  cribText: string
  /** 1-based letter number where the crib starts, as typed; '' = anywhere. */
  cribPosition: string
  /** 0 … MAX_TYPO_TOLERANCE: share of a dictionary word's letters that may be wrong. */
  typoTolerance: number
  workers: number
  /** 'auto': GPU (WebGPU) + CPU workers when a GPU is available; 'cpu': CPU workers only. */
  backend: 'auto' | 'cpu'
  /** CPU workers' phase-1 engine: WebAssembly SIMD (when supported) or the JavaScript reference. */
  cpuEngine: 'wasm' | 'js'
}

/** Workers the search may use: every CPU thread but one, which is always kept free for the page. */
export function maxWorkers(): number {
  return Math.max(1, hardwareThreads() - 1)
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** Model-dependent choices reset to the engine defaults for `model`. */
function modelChoices(model: ModelId): Pick<BreakerForm, 'model' | 'rotors' | 'reflectors' | 'greekRotors'> {
  const d = safeDefaults(model)
  return {
    model,
    rotors: [...d.rotors],
    reflectors: [...d.reflectors],
    greekRotors: [...d.greekRotors],
  }
}

export function defaultForm(model: ModelId = 'I'): BreakerForm {
  const d = safeDefaults(model)
  return {
    ciphertext: '',
    ...modelChoices(model),
    language: d.language,
    ringSearch: d.ringSearch,
    maxPlugs: clamp(d.maxPlugs, 0, MAX_CABLES),
    exactPlugs: false,
    cribText: '',
    cribPosition: '',
    typoTolerance: DEFAULT_TYPO_TOLERANCE,
    workers: maxWorkers(),
    backend: 'auto',
    cpuEngine: 'wasm',
  }
}

/** Switches the model; rotors, reflectors and Greek wheels go back to that model's defaults. */
export function withModel(form: BreakerForm, model: ModelId): BreakerForm {
  return model === form.model ? form : { ...form, ...modelChoices(model) }
}

/** Keeps the items of `wanted` that are in `allowed`, in `allowed` order. */
function subset<T extends string>(wanted: unknown, allowed: readonly T[]): T[] | null {
  if (!Array.isArray(wanted)) return null
  return allowed.filter((id) => wanted.includes(id))
}

/** Rebuilds a form from untrusted stored data; anything invalid falls back to the defaults. */
export function sanitizeForm(raw: unknown): BreakerForm {
  if (raw === null || typeof raw !== 'object') return defaultForm()
  const r = raw as Record<string, unknown>
  const model = MODEL_ORDER.find((id) => id === r.model) ?? 'I'
  const spec = MODELS[model]
  const base = defaultForm(model)
  const rotors = subset(r.rotors, spec.rotorIds)
  const reflectors = subset(r.reflectors, spec.reflectorIds)
  const greek = subset(r.greekRotors, spec.greekIds)
  return {
    ciphertext: typeof r.ciphertext === 'string' ? r.ciphertext : '',
    model,
    language: LANGUAGES.find((l) => l === r.language) ?? base.language,
    rotors: rotors ?? base.rotors,
    reflectors: reflectors ?? base.reflectors,
    greekRotors: greek ?? base.greekRotors,
    ringSearch: RING_SEARCHES.find((s) => s === r.ringSearch) ?? base.ringSearch,
    maxPlugs: typeof r.maxPlugs === 'number' ? clamp(r.maxPlugs, 0, MAX_CABLES) : base.maxPlugs,
    exactPlugs: typeof r.exactPlugs === 'boolean' ? r.exactPlugs : base.exactPlugs,
    cribText: typeof r.cribText === 'string' ? r.cribText : '',
    cribPosition: typeof r.cribPosition === 'string' ? r.cribPosition : '',
    typoTolerance:
      typeof r.typoTolerance === 'number' && Number.isFinite(r.typoTolerance)
        ? Math.min(MAX_TYPO_TOLERANCE, Math.max(0, r.typoTolerance))
        : base.typoTolerance,
    workers: typeof r.workers === 'number' ? clamp(r.workers, 1, maxWorkers()) : base.workers,
    backend: r.backend === 'cpu' ? 'cpu' : 'auto',
    cpuEngine: r.cpuEngine === 'js' ? 'js' : 'wasm',
  }
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function loadForm(): BreakerForm {
  try {
    const text = storage()?.getItem(FORM_STORAGE_KEY)
    return text ? sanitizeForm(JSON.parse(text)) : defaultForm()
  } catch {
    return defaultForm()
  }
}

export function saveForm(form: BreakerForm): void {
  try {
    const stored =
      form.ciphertext.length > MAX_STORED_CIPHERTEXT ? { ...form, ciphertext: '' } : form
    storage()?.setItem(FORM_STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // Storage full or blocked: the form simply is not remembered.
  }
}

/* ------------------------------------------------------------------ */
/* Validation and the engine config                                    */
/* ------------------------------------------------------------------ */

export interface FormIssues {
  ciphertext?: string
  rotors?: string
  reflectors?: string
  greekRotors?: string
  crib?: string
}

interface ParsedCrib {
  text: string
  /** 0-based offset, null = anywhere. */
  position: number | null
  error?: string
}

function parseCrib(form: BreakerForm, cipher: string): ParsedCrib {
  const text = letters(form.cribText)
  const typed = form.cribPosition.trim()
  if (text === '') return { text, position: null }
  if (text.length > cipher.length && cipher.length > 0) {
    return { text, position: null, error: 'The crib is longer than the message.' }
  }
  if (typed === '') return { text, position: null }
  const number = /^\d+$/.test(typed) ? Number(typed) : NaN
  const last = cipher.length - text.length + 1
  if (!Number.isInteger(number) || number < 1 || (cipher.length > 0 && number > last)) {
    return {
      text,
      position: null,
      error:
        cipher.length > 0
          ? `Position must be a letter number from 1 to ${Math.max(1, last)}, or blank for anywhere.`
          : 'Position must be a letter number (1 = first letter), or blank for anywhere.',
    }
  }
  const position = number - 1
  for (let i = 0; i < text.length && position + i < cipher.length; i++) {
    if (text[i] === cipher[position + i]) {
      return {
        text,
        position,
        error: `The crib cannot start at letter ${number}: its ${text[i]} would sit on a ciphertext ${text[i]}, and Enigma never encrypts a letter to itself.`,
      }
    }
  }
  return { text, position }
}

export function validateForm(form: BreakerForm): FormIssues {
  const cipher = letters(form.ciphertext)
  const issues: FormIssues = {}
  if (cipher.length < MIN_LETTERS) {
    issues.ciphertext =
      cipher.length === 0
        ? `Paste a ciphertext of at least ${MIN_LETTERS} letters.`
        : `At least ${MIN_LETTERS} letters are needed (${cipher.length} so far).`
  }
  if (form.rotors.length < MIN_ROTORS) issues.rotors = `Pick at least ${MIN_ROTORS} rotors.`
  if (form.reflectors.length === 0) issues.reflectors = 'Pick at least one reflector.'
  if (MODELS[form.model].hasGreek && form.greekRotors.length === 0) {
    issues.greekRotors = 'Pick at least one Greek wheel.'
  }
  const crib = parseCrib(form, cipher)
  if (crib.error) issues.crib = crib.error
  return issues
}

export function hasIssues(issues: FormIssues): boolean {
  return Object.values(issues).some((v) => v != null)
}

/** The engine config for the current form. */
export function formToConfig(form: BreakerForm): BreakerConfig {
  const crib = parseCrib(form, letters(form.ciphertext))
  return {
    ciphertext: form.ciphertext,
    model: form.model,
    rotors: [...form.rotors],
    reflectors: [...form.reflectors],
    greekRotors: MODELS[form.model].hasGreek ? [...form.greekRotors] : [],
    ringSearch: form.ringSearch,
    maxPlugs: form.maxPlugs,
    exactPlugs: form.exactPlugs,
    language: form.language,
    crib: crib.text === '' ? null : { text: crib.text, position: crib.position },
    typoTolerance: Math.min(MAX_TYPO_TOLERANCE, Math.max(0, form.typoTolerance)),
    workers: clamp(form.workers, 1, maxWorkers()),
    backend: form.backend,
    cpuEngine: form.cpuEngine,
  }
}
