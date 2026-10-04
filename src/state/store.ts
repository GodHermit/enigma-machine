import { create } from 'zustand'
import {
  ROTORS,
  cloneSettings,
  coerceToModel,
  defaultSettings,
  mod26,
  randomSettings,
  toChar,
  togglePlug as togglePlugPairs,
} from '../lib/enigma'
import type {
  AnyRotorId,
  Letter,
  MachineSettings,
  ModelId,
  PlugPair,
  ReflectorId,
  RotorSlot,
  SlotId,
} from '../lib/enigma'
import { selectCurrentPositions, selectStageCount } from './selectors'

export type NonLettersMode = 'keep' | 'remove'
export type RingDisplay = 'number' | 'letter'

export interface EnigmaOptions {
  /** 'keep': spaces / punctuation pass through unchanged; 'remove': they are dropped. */
  nonLetters: NonLettersMode
  /** Display output in groups of five letters (display only). */
  groupOutput: boolean
  /** Show ring settings as 01–26 or A–Z. */
  ringDisplay: RingDisplay
  /** Animate the signal path drawing (and auto-play it on key presses). */
  animate: boolean
  /** Milliseconds per stage during playback, SPEED_MIN..SPEED_MAX. */
  speed: number
}

export const SPEED_MIN = 80
export const SPEED_MAX = 1000

export const DEFAULT_OPTIONS: EnigmaOptions = {
  nonLetters: 'keep',
  groupOutput: false,
  ringDisplay: 'number',
  animate: true,
  speed: 350,
}

/** Rounds and clamps a playback speed into SPEED_MIN..SPEED_MAX (non-finite → default). */
export function clampSpeed(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_OPTIONS.speed
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(ms)))
}

export interface EnigmaState {
  /** Daily key incl. START positions. */
  settings: MachineSettings
  /** Raw user input (may include spaces etc.). */
  input: string
  options: EnigmaOptions
  /** Which keypress trace is visualised; null = most recent. */
  selectedTrace: number | null
  /** Playback cursor: number of stages revealed in the visualisation; null = all. */
  stageCursor: number | null
  playing: boolean
  /** Increments on every key press (used to re-trigger lamp/animation). */
  pressId: number

  setModel(model: ModelId): void
  setReflector(id: ReflectorId): void
  /** Puts `rotor` in `slot`; when it already sits in another slot the two rotors swap places. */
  setRotor(slot: SlotId, rotor: AnyRotorId): void
  setRing(slot: SlotId, ring: number): void
  /** Sets the START position of a slot. */
  setPosition(slot: SlotId, position: number): void
  /** Moves the START position of a slot by ±delta (wrapping). */
  nudgePosition(slot: SlotId, delta: number): void
  setPlugboard(pairs: PlugPair[]): void
  togglePlug(a: Letter, b: Letter): void
  clearPlugboard(): void
  /** Appends a letter to the input, shows its trace and restarts playback when animating. */
  pressKey(letter: Letter): void
  /** Appends raw text to the input. */
  typeText(text: string): void
  setInput(text: string): void
  /** Removes the last character of the input (undo the last key). */
  backspace(): void
  /** Clears the input, so the rotors return to their start positions. */
  clearInput(): void
  /** START positions = current positions; clears the input (operator continues from here). */
  adoptCurrentPositions(): void
  /** Random valid settings for the current model; clears the input. */
  randomize(): void
  /** Factory defaults for the current model. */
  resetSettings(): void
  loadSettings(s: MachineSettings): void
  setOption<K extends keyof EnigmaOptions>(key: K, value: EnigmaOptions[K]): void
  selectTrace(index: number | null): void
  setStageCursor(n: number | null): void
  play(): void
  pause(): void
  stepStage(delta: 1 | -1): void
  /** Advances playback by one stage (called by the playback timer). */
  tick(): void
}

/** The data part of the state (everything except actions). */
export type EnigmaData = Pick<
  EnigmaState,
  'settings' | 'input' | 'options' | 'selectedTrace' | 'stageCursor' | 'playing' | 'pressId'
>

const STOPPED = { stageCursor: null, playing: false } as const
const VIEW_RESET = { selectedTrace: null, stageCursor: null, playing: false } as const

const MAIN_SLOTS = ['left', 'middle', 'right'] as const

function toIndex(n: number): number {
  return Number.isFinite(n) ? mod26(Math.round(n)) : 0
}

function getSlot(settings: MachineSettings, slot: SlotId): RotorSlot | null {
  return slot === 'greek' ? settings.greek : settings[slot]
}

/** Returns new settings with `patch` applied to `slot` (unchanged settings when the slot is empty). */
function patchSlot(
  settings: MachineSettings,
  slot: SlotId,
  patch: Partial<RotorSlot>,
): MachineSettings {
  const current = getSlot(settings, slot)
  if (!current) return settings
  return { ...settings, [slot]: { ...current, ...patch } }
}

/** Fresh initial data (default settings and options, empty input). */
export function initialData(): EnigmaData {
  return {
    settings: defaultSettings('I'),
    input: '',
    options: { ...DEFAULT_OPTIONS },
    selectedTrace: null,
    stageCursor: null,
    playing: false,
    pressId: 0,
  }
}

export const useEnigmaStore = create<EnigmaState>()((set, get) => ({
  ...initialData(),

  setModel(model) {
    const { settings } = get()
    if (settings.model === model) return
    set({ settings: coerceToModel(settings, model) })
  },

  setReflector(id) {
    const { settings } = get()
    if (settings.reflector === id) return
    set({ settings: { ...settings, reflector: id } })
  },

  setRotor(slot, rotor) {
    const { settings } = get()
    const spec = ROTORS[rotor]
    if (!spec) return
    // Greek wheels only fit the thin Greek slot and vice versa.
    if ((slot === 'greek') !== (spec.kind === 'greek')) return
    const current = getSlot(settings, slot)
    if (!current || current.rotor === rotor) return

    let next = patchSlot(settings, slot, { rotor })
    if (slot !== 'greek') {
      const other = MAIN_SLOTS.find((o) => o !== slot && settings[o].rotor === rotor)
      if (other) next = patchSlot(next, other, { rotor: current.rotor })
    }
    set({ settings: next })
  },

  setRing(slot, ring) {
    const { settings } = get()
    const current = getSlot(settings, slot)
    const value = toIndex(ring)
    if (!current || current.ring === value) return
    set({ settings: patchSlot(settings, slot, { ring: value }) })
  },

  setPosition(slot, position) {
    const { settings } = get()
    const current = getSlot(settings, slot)
    const value = toIndex(position)
    if (!current || current.position === value) return
    set({ settings: patchSlot(settings, slot, { position: value }) })
  },

  nudgePosition(slot, delta) {
    const { settings } = get()
    const current = getSlot(settings, slot)
    if (!current || !Number.isFinite(delta) || Math.round(delta) % 26 === 0) return
    set({ settings: patchSlot(settings, slot, { position: toIndex(current.position + delta) }) })
  },

  setPlugboard(pairs) {
    const { settings } = get()
    set({ settings: { ...settings, plugboard: pairs.map(([a, b]) => [a, b] as PlugPair) } })
  },

  togglePlug(a, b) {
    const { settings } = get()
    set({ settings: { ...settings, plugboard: togglePlugPairs(settings.plugboard, a, b) } })
  },

  clearPlugboard() {
    const { settings } = get()
    if (settings.plugboard.length === 0) return
    set({ settings: { ...settings, plugboard: [] } })
  },

  pressKey(letter) {
    const { input, options, pressId } = get()
    set({
      input: input + toChar(letter),
      selectedTrace: null,
      pressId: pressId + 1,
      ...(options.animate ? { stageCursor: 0, playing: true } : STOPPED),
    })
  },

  typeText(text) {
    if (text.length === 0) return
    set({ input: get().input + text, ...VIEW_RESET })
  },

  setInput(text) {
    if (text === get().input) return
    set({ input: text, ...VIEW_RESET })
  },

  backspace() {
    const { input } = get()
    if (input.length === 0) return
    set({ input: input.slice(0, -1), ...VIEW_RESET })
  },

  clearInput() {
    set({ input: '', ...VIEW_RESET })
  },

  adoptCurrentPositions() {
    const state = get()
    const pos = selectCurrentPositions(state)
    let settings = state.settings
    for (const slot of MAIN_SLOTS) settings = patchSlot(settings, slot, { position: pos[slot] })
    if (settings.greek && pos.greek !== null) {
      settings = patchSlot(settings, 'greek', { position: pos.greek })
    }
    set({ settings, input: '', ...VIEW_RESET })
  },

  randomize() {
    set({ settings: randomSettings(get().settings.model), input: '', ...VIEW_RESET })
  },

  resetSettings() {
    set({ settings: defaultSettings(get().settings.model), ...STOPPED })
  },

  loadSettings(s) {
    set({ settings: cloneSettings(s), ...STOPPED })
  },

  setOption(key, value) {
    const { options } = get()
    const next: EnigmaOptions = { ...options, [key]: value }
    next.speed = clampSpeed(next.speed)
    if (options[key] === next[key]) return
    set(key === 'animate' && !next.animate ? { options: next, ...STOPPED } : { options: next })
  },

  selectTrace(index) {
    const value = index === null || !Number.isFinite(index) ? null : Math.max(0, Math.round(index))
    set({ selectedTrace: value, ...STOPPED })
  },

  setStageCursor(n) {
    if (n === null) {
      set({ stageCursor: null })
      return
    }
    const total = selectStageCount(get())
    const value = Math.max(0, Math.round(n))
    set({ stageCursor: value >= total ? null : value })
  },

  play() {
    const state = get()
    const total = selectStageCount(state)
    if (total === 0) return
    const cursor = state.stageCursor
    set({ stageCursor: cursor === null || cursor >= total ? 0 : cursor, playing: true })
  },

  pause() {
    if (!get().playing) return
    set({ playing: false })
  },

  stepStage(delta) {
    const state = get()
    const total = selectStageCount(state)
    if (total === 0) return
    const cursor = state.stageCursor ?? total
    let next: number
    if (delta > 0) {
      // Stepping forward from "everything shown" starts a new walk-through.
      next = cursor >= total ? 1 : cursor + 1
    } else {
      next = Math.max(0, cursor - 1)
    }
    set({ stageCursor: next >= total ? null : next, playing: false })
  },

  tick() {
    const state = get()
    if (!state.playing) return
    const total = selectStageCount(state)
    const next = (state.stageCursor ?? 0) + 1
    if (total === 0 || next >= total) {
      set(STOPPED)
      return
    }
    set({ stageCursor: next })
  },
}))
