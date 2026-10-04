import { decodeSettings, encodeSettings, settingsEqual } from '../lib/enigma'
import type { MachineSettings } from '../lib/enigma'
import { DEFAULT_OPTIONS, clampSpeed, useEnigmaStore } from './store'
import type { EnigmaOptions, EnigmaState } from './store'
import { buildHash, parseHash } from '../lib/hash-route'

/** Versioned localStorage key. */
export const STORAGE_KEY = 'enigma-tools:v1'
/** Name of the URL hash parameter that carries a shared key, e.g. `#/simulator?key=I.UKW-B.I-II-III.AAA.AAA.` */
export const HASH_PARAM = 'key'
/** Inputs longer than this are not persisted (keeps localStorage small). */
export const MAX_PERSISTED_INPUT = 20000
/** Delay between a state change and the save. */
export const SAVE_DEBOUNCE_MS = 150

export interface PersistedState {
  settings: MachineSettings
  options: EnigmaOptions
  input: string
}

interface StoredShape {
  version: 1
  settings: string
  options: EnigmaOptions
  input: string
}

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

/** Accepts any value and returns valid options, falling back to defaults field by field. */
export function sanitizeOptions(raw: unknown): EnigmaOptions {
  const o = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    nonLetters: o.nonLetters === 'remove' || o.nonLetters === 'keep' ? o.nonLetters : DEFAULT_OPTIONS.nonLetters,
    groupOutput: typeof o.groupOutput === 'boolean' ? o.groupOutput : DEFAULT_OPTIONS.groupOutput,
    ringDisplay:
      o.ringDisplay === 'number' || o.ringDisplay === 'letter' ? o.ringDisplay : DEFAULT_OPTIONS.ringDisplay,
    animate: typeof o.animate === 'boolean' ? o.animate : DEFAULT_OPTIONS.animate,
    speed: typeof o.speed === 'number' ? clampSpeed(o.speed) : DEFAULT_OPTIONS.speed,
  }
}

/** Serialises the persisted part of the state (settings are stored in their compact text form). */
export function serializeState(state: Pick<EnigmaState, 'settings' | 'options' | 'input'>): string {
  const stored: StoredShape = {
    version: 1,
    settings: encodeSettings(state.settings),
    options: state.options,
    input: state.input.length > MAX_PERSISTED_INPUT ? '' : state.input,
  }
  return JSON.stringify(stored)
}

/** Parses `serializeState` output; null when missing, malformed or the settings are invalid. */
export function deserializeState(text: string | null): PersistedState | null {
  if (!text) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (obj.version !== 1 || typeof obj.settings !== 'string') return null
  const settings = decodeSettings(obj.settings)
  if (!settings) return null
  return {
    settings,
    options: sanitizeOptions(obj.options),
    input: typeof obj.input === 'string' ? obj.input : '',
  }
}

/** Reads the persisted state from localStorage (null when absent / unreadable). */
export function loadPersisted(): PersistedState | null {
  const storage = getStorage()
  if (!storage) return null
  try {
    return deserializeState(storage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

/** Writes the persisted part of the state to localStorage. Returns false when storage is unavailable. */
export function savePersisted(state: Pick<EnigmaState, 'settings' | 'options' | 'input'>): boolean {
  const storage = getStorage()
  if (!storage) return false
  try {
    storage.setItem(STORAGE_KEY, serializeState(state))
    return true
  } catch {
    return false
  }
}

/** Removes the persisted state. */
export function clearPersisted(): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked: nothing to remove.
  }
}

function hashParams(hash: string): URLSearchParams {
  return parseHash(hash).params
}

/**
 * Extracts settings from a URL hash such as `#/simulator?key=M3.UKW-C.VI-II-VIII.ABC.XYZ.AB-CD`
 * (or the legacy `#key=…`); null when absent/invalid.
 */
export function readHashSettings(hash: string = typeof window !== 'undefined' ? window.location.hash : ''): MachineSettings | null {
  const value = hashParams(hash).get(HASH_PARAM)
  return value ? decodeSettings(value) : null
}

/** Builds the simulator hash (with leading '#') for settings, keeping other hash parameters. */
export function settingsHash(settings: MachineSettings, currentHash = ''): string {
  const params = hashParams(currentHash)
  params.set(HASH_PARAM, encodeSettings(settings))
  // encodeSettings only produces A–Z, a–z, 0–9, '.' and '-', which URLSearchParams leaves unescaped.
  return buildHash('simulator', params)
}

/** Absolute link that opens the app with these settings. */
export function shareUrl(
  settings: MachineSettings,
  base: string = typeof window !== 'undefined' ? window.location.href : '',
): string {
  const hashIndex = base.indexOf('#')
  const withoutHash = hashIndex === -1 ? base : base.slice(0, hashIndex)
  const currentHash = hashIndex === -1 ? '' : base.slice(hashIndex)
  return withoutHash + settingsHash(settings, currentHash)
}

/**
 * Loads settings received through a share link. When they differ from the current key the
 * input is cleared, since text typed for the old key no longer applies.
 */
function applySharedSettings(settings: MachineSettings): void {
  if (settingsEqual(useEnigmaStore.getState().settings, settings)) return
  useEnigmaStore.setState({
    settings,
    input: '',
    selectedTrace: null,
    stageCursor: null,
    playing: false,
  })
}

/** Rewrites a legacy share link (`#key=…`) in the address bar to the routed form (`#/simulator?key=…`). */
function upgradeLegacyHash(): void {
  if (typeof window === 'undefined' || window.location.hash.startsWith('#/')) return
  try {
    window.history.replaceState(window.history.state, '', settingsHash(useEnigmaStore.getState().settings, window.location.hash))
  } catch {
    // History changes can be forbidden in embedded contexts; the legacy link still works.
  }
}

let disposeActive: (() => void) | null = null

/**
 * Hydrates the store (localStorage, then a `key=` URL hash parameter which overrides the stored
 * settings) and keeps localStorage in sync (debounced). While the simulator URL carries a `key=`
 * parameter it is kept up to date with the current settings. Idempotent; returns a dispose function.
 */
export function initPersistence(): () => void {
  if (disposeActive) return disposeActive

  const stored = loadPersisted()
  const fromHash = readHashSettings()
  if (stored) {
    useEnigmaStore.setState({ settings: stored.settings, options: stored.options, input: stored.input })
  }
  if (fromHash) applySharedSettings(fromHash)
  const syncHash = fromHash !== null
  if (syncHash) upgradeLegacyHash()

  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    const state = useEnigmaStore.getState()
    savePersisted(state)
    // Keep a shared key in the URL up to date — only while the simulator tab is open.
    if (syncHash && typeof window !== 'undefined' && parseHash(window.location.hash).route === 'simulator') {
      const hash = settingsHash(state.settings, window.location.hash)
      if (hash !== window.location.hash) {
        try {
          window.history.replaceState(window.history.state, '', hash)
        } catch {
          // Some embedded contexts forbid history changes; persistence still works.
        }
      }
    }
  }

  const unsubscribe = useEnigmaStore.subscribe((state, prev) => {
    if (state.settings === prev.settings && state.options === prev.options && state.input === prev.input) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(flush, SAVE_DEBOUNCE_MS)
  })

  const onHashChange = () => {
    const next = readHashSettings()
    if (next) {
      applySharedSettings(next)
      upgradeLegacyHash()
    }
  }
  const onPageHide = () => {
    if (timer !== null) flush()
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', onHashChange)
    window.addEventListener('pagehide', onPageHide)
  }

  disposeActive = () => {
    if (timer !== null) flush()
    unsubscribe()
    if (typeof window !== 'undefined') {
      window.removeEventListener('hashchange', onHashChange)
      window.removeEventListener('pagehide', onPageHide)
    }
    disposeActive = null
  }
  return disposeActive
}
