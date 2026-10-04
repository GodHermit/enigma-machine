/**
 * Guarded calls into the codebreaker engine: the page must keep rendering when an engine
 * function throws (e.g. while it is still loading or for an unexpected config).
 */
import { MODELS, REFLECTORS } from '../../lib/enigma'
import type { MachineSettings, ModelId } from '../../lib/enigma'
import { defaultBreakerConfig, describeKey, estimateWork, lettersOnly } from '../../lib/breaker'
import type { BreakerConfig, WorkEstimate } from '../../lib/breaker/types'
import { plural, plugsLabel, ringsLabel, rotorsLabel, startLabel } from './format'

/** A–Z only, uppercased. */
export function letters(text: string): string {
  try {
    return lettersOnly(text)
  } catch {
    return text.toUpperCase().replace(/[^A-Z]/g, '')
  }
}

export function safeEstimate(config: BreakerConfig, keysPerSecondPerWorker?: number): WorkEstimate | null {
  try {
    const estimate = estimateWork(config, keysPerSecondPerWorker)
    return Number.isFinite(estimate.keys) && Number.isFinite(estimate.seconds) ? estimate : null
  } catch {
    return null
  }
}

/** "Enigma I · UKW-B · II IV I · rings 01 14 22 · start ADU · 10 plugs". */
export function safeDescribe(settings: MachineSettings): string {
  try {
    return describeKey(settings)
  } catch {
    return [
      MODELS[settings.model]?.name ?? settings.model,
      REFLECTORS[settings.reflector]?.name ?? settings.reflector,
      rotorsLabel(settings),
      `rings ${ringsLabel(settings)}`,
      `start ${startLabel(settings)}`,
      settings.plugboard.length === 0
        ? 'no plugs'
        : `${plural(settings.plugboard.length, 'plug')} ${plugsLabel(settings)}`,
    ].join(' · ')
  }
}

/** The engine's defaults for a model, or equivalent local ones when it is unavailable. */
export function safeDefaults(model: ModelId): BreakerConfig {
  try {
    return defaultBreakerConfig(model)
  } catch {
    const spec = MODELS[model]
    return {
      ciphertext: '',
      model,
      rotors: [...spec.rotorIds],
      reflectors: spec.reflectorIds.filter((id) => id.startsWith('UKW-B')),
      greekRotors: [...spec.greekIds],
      ringSearch: 'right-middle',
      maxPlugs: 10,
      language: 'de',
      crib: null,
      workers: Math.max(1, hardwareThreads() - 1),
    }
  }
}

/** Logical CPU cores (navigator.hardwareConcurrency), 4 when unknown. */
export function hardwareThreads(): number {
  const n = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : 4
}
