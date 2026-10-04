import { MODELS, REFLECTORS } from '../enigma/constants'
import { formatRing, toChar } from '../enigma/letters'
import { encryptText } from '../enigma/machine'
import type { AnyRotorId, MachineSettings, PlugPair, RotorSlot } from '../enigma/types'
import { PASSAGES } from './data/passages'
import { defaultBreakerConfig } from './config'
import { mulberry32, randomInt } from './random'
import { lettersOnly } from './text'
import type { SampleChallenge, SampleOptions } from './types'

/** "Enigma I · UKW-B · II IV I · rings 01 14 22 · start ADU · 10 plugs". */
export function describeKey(settings: MachineSettings): string {
  const slots = settings.greek
    ? [settings.greek, settings.left, settings.middle, settings.right]
    : [settings.left, settings.middle, settings.right]
  const plugs = settings.plugboard.length
  return [
    MODELS[settings.model]?.name ?? settings.model,
    REFLECTORS[settings.reflector]?.name ?? settings.reflector,
    slots.map((s) => s.rotor).join(' '),
    `rings ${slots.map((s) => formatRing(s.ring)).join(' ')}`,
    `start ${slots.map((s) => toChar(s.position)).join('')}`,
    plugs === 0 ? 'no plugs' : plugs === 1 ? '1 plug' : `${plugs} plugs`,
  ].join(' · ')
}

function randomPlugs(rand: () => number, count: number): PlugPair[] {
  const letters = Array.from({ length: 26 }, (_, i) => i)
  for (let i = 25; i > 0; i--) {
    const j = randomInt(rand, i + 1)
    const tmp = letters[i]
    letters[i] = letters[j]
    letters[j] = tmp
  }
  const pairs: PlugPair[] = []
  for (let i = 0; i < count; i++) pairs.push([letters[2 * i], letters[2 * i + 1]])
  return pairs
}

function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const arr = items.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(rand, i + 1)
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

/** Random key inside the search space of the options (defaults: defaultBreakerConfig(model)). */
function sampleKey(options: SampleOptions, rand: () => number, plugCount: number): MachineSettings {
  const spec = MODELS[options.model]
  const defaults = defaultBreakerConfig(options.model)
  const pick = <T>(wanted: readonly T[] | undefined, fallback: readonly T[], allowed: readonly T[]): T[] => {
    const list = (wanted ?? fallback).filter((x, i, all) => allowed.includes(x) && all.indexOf(x) === i)
    return list.length > 0 ? list : [...fallback]
  }
  const rotors = pick(options.rotors, defaults.rotors, spec.rotorIds)
  if (rotors.length < 3) throw new Error('A sample needs at least three rotors.')
  const reflectors = pick(options.reflectors, defaults.reflectors, spec.reflectorIds)
  const greeks = pick(options.greekRotors, defaults.greekRotors, spec.greekIds)
  const order = shuffle(rotors, rand)
  const slot = (rotor: AnyRotorId): RotorSlot => ({ rotor, ring: randomInt(rand, 26), position: randomInt(rand, 26) })
  return {
    model: options.model,
    reflector: reflectors[randomInt(rand, reflectors.length)],
    greek: spec.hasGreek ? slot(greeks[randomInt(rand, greeks.length)]) : null,
    left: slot(order[0]),
    middle: slot(order[1]),
    right: slot(order[2]),
    plugboard: randomPlugs(rand, plugCount),
  }
}

/**
 * A real passage (bundled, public domain) enciphered with a random key — the "Try an example"
 * button. Reproducible with `seed`. The key always lies inside the search space of the given
 * rotors / reflectors / Greek wheels (by default the one of defaultBreakerConfig(model)), so
 * the example can be broken with that config.
 */
export function sampleChallenge(options: SampleOptions): SampleChallenge {
  const seed = options.seed ?? Math.floor(Math.random() * 0x7fffffff)
  const rand = mulberry32(seed)
  const length = Math.max(20, Math.min(2000, Math.floor(options.length ?? 300)))
  const plugCount = Math.max(0, Math.min(13, Math.floor(options.plugs ?? 10)))
  const passages = PASSAGES[options.language]
  if (!passages || passages.length === 0) throw new Error(`No sample passages for "${options.language}"`)

  const first = randomInt(rand, passages.length)
  let plaintext = ''
  const sources: string[] = []
  for (let k = first; plaintext.length < length; k++) {
    const p = passages[k % passages.length]
    plaintext += lettersOnly(p.text)
    if (!sources.includes(p.source)) sources.push(p.source)
  }
  plaintext = plaintext.slice(0, length)

  const settings = sampleKey(options, rand, plugCount)
  const ciphertext = encryptText(settings, plaintext, { nonLetters: 'remove' }).output
  return { ciphertext, plaintext, settings, source: sources.join('; ') }
}
