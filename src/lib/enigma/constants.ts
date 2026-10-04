import type {
  AnyRotorId,
  GreekRotorId,
  MachineSettings,
  ModelId,
  ModelSpec,
  ReflectorId,
  ReflectorSpec,
  RotorId,
  RotorSpec,
  SlotId,
} from './types'

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Entry wheel (Eintrittswalze) wiring of the Enigma I / M3 / M4: identity. */
export const ENTRY_WHEEL = ALPHABET

/*
 * Rotor and reflector wirings / turnover letters verified against
 * https://en.wikipedia.org/wiki/Enigma_rotor_details (tables "Rotor wiring tables"
 * and "Turnover notch positions") and cryptomuseum.com.
 */
export const ROTORS: Record<AnyRotorId, RotorSpec> = {
  I: {
    id: 'I',
    wiring: 'EKMFLGDQVZNTOWYHXUSPAIBRCJ',
    notches: 'Q',
    kind: 'rotor',
    description: 'Enigma I, 1930. Turnover at Q → R.',
  },
  II: {
    id: 'II',
    wiring: 'AJDKSIRUXBLHWTMCQGZNPYFVOE',
    notches: 'E',
    kind: 'rotor',
    description: 'Enigma I, 1930. Turnover at E → F.',
  },
  III: {
    id: 'III',
    wiring: 'BDFHJLCPRTXVZNYEIWGAKMUSQO',
    notches: 'V',
    kind: 'rotor',
    description: 'Enigma I, 1930. Turnover at V → W.',
  },
  IV: {
    id: 'IV',
    wiring: 'ESOVPZJAYQUIRHXLNFTGKDCMWB',
    notches: 'J',
    kind: 'rotor',
    description: 'M3 Army, December 1938. Turnover at J → K.',
  },
  V: {
    id: 'V',
    wiring: 'VZBRGITYUPSDNHLXAWMJQOFECK',
    notches: 'Z',
    kind: 'rotor',
    description: 'M3 Army, December 1938. Turnover at Z → A.',
  },
  VI: {
    id: 'VI',
    wiring: 'JPGVOUMFYQBENHZRDKASXLICTW',
    notches: 'ZM',
    kind: 'rotor',
    description: 'M3 & M4 Naval, 1939. Two notches: turnover at Z → A and M → N.',
  },
  VII: {
    id: 'VII',
    wiring: 'NZJHGRCXMYSWBOUFAIVLPEKQDT',
    notches: 'ZM',
    kind: 'rotor',
    description: 'M3 & M4 Naval, 1939. Two notches: turnover at Z → A and M → N.',
  },
  VIII: {
    id: 'VIII',
    wiring: 'FKQHTLXOCBJSPDZRAMEWNIUYGV',
    notches: 'ZM',
    kind: 'rotor',
    description: 'M3 & M4 Naval, 1939. Two notches: turnover at Z → A and M → N.',
  },
  Beta: {
    id: 'Beta',
    wiring: 'LEYJVCNIXWPBQMDRTAKZGFUHOS',
    notches: '',
    kind: 'greek',
    description: 'M4 Greek wheel β (Spring 1941). Never steps; used with thin reflector B.',
  },
  Gamma: {
    id: 'Gamma',
    wiring: 'FSOKANUERHMBTIYCWLQPZXVGJD',
    notches: '',
    kind: 'greek',
    description: 'M4 Greek wheel γ (Spring 1942). Never steps; used with thin reflector C.',
  },
}

export const REFLECTORS: Record<ReflectorId, ReflectorSpec> = {
  'UKW-A': {
    id: 'UKW-A',
    name: 'UKW-A',
    wiring: 'EJMZALYXVBWFCRQUONTSPIKHGD',
    thin: false,
    description: 'Reflector A, used until 1937.',
  },
  'UKW-B': {
    id: 'UKW-B',
    name: 'UKW-B',
    wiring: 'YRUHQSLDPXNGOKMIEBFZCWVJAT',
    thin: false,
    description: 'Reflector B, the standard reflector from 1937.',
  },
  'UKW-C': {
    id: 'UKW-C',
    name: 'UKW-C',
    wiring: 'FVPJIAOYEDRZXWGCTKUQSBNMHL',
    thin: false,
    description: 'Reflector C, used briefly in 1940–1941.',
  },
  'UKW-B-thin': {
    id: 'UKW-B-thin',
    name: 'UKW-B (thin)',
    wiring: 'ENKQAUYWJICOPBLMDXZVFTHRGS',
    thin: true,
    description: 'Thin reflector B (M4, 1940). With Beta at A/A it equals UKW-B.',
  },
  'UKW-C-thin': {
    id: 'UKW-C-thin',
    name: 'UKW-C (thin)',
    wiring: 'RDOBJNTKVEHMLFCWZAXGYIPSUQ',
    thin: true,
    description: 'Thin reflector C (M4, 1940). With Gamma at A/A it equals UKW-C.',
  },
}

export const ROTOR_IDS: RotorId[] = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']
export const GREEK_IDS: GreekRotorId[] = ['Beta', 'Gamma']
export const REFLECTOR_IDS: ReflectorId[] = ['UKW-A', 'UKW-B', 'UKW-C', 'UKW-B-thin', 'UKW-C-thin']

export const MODELS: Record<ModelId, ModelSpec> = {
  I: {
    id: 'I',
    name: 'Enigma I',
    description: 'Army & Air Force machine (1932): 3 rotors chosen from I–V, reflector A/B/C, plugboard.',
    rotorIds: ['I', 'II', 'III', 'IV', 'V'],
    reflectorIds: ['UKW-A', 'UKW-B', 'UKW-C'],
    hasGreek: false,
    greekIds: [],
  },
  M3: {
    id: 'M3',
    name: 'Enigma M3',
    description: 'Navy machine (1934): 3 rotors chosen from I–VIII, reflector B/C, plugboard.',
    rotorIds: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'],
    reflectorIds: ['UKW-B', 'UKW-C'],
    hasGreek: false,
    greekIds: [],
  },
  M4: {
    id: 'M4',
    name: 'Enigma M4',
    description:
      'U-boat machine (1942): non-stepping Greek wheel β/γ, 3 rotors from I–VIII, thin reflector B/C.',
    rotorIds: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'],
    reflectorIds: ['UKW-B-thin', 'UKW-C-thin'],
    hasGreek: true,
    greekIds: ['Beta', 'Gamma'],
  },
}

export const MODEL_ORDER: ModelId[] = ['I', 'M3', 'M4']

/** Slots ordered left → right as seen by the operator. */
export const SLOT_ORDER: SlotId[] = ['greek', 'left', 'middle', 'right']

/** German Enigma keyboard / lampboard layout (QWERTZ). */
export const KEYBOARD_ROWS = ['QWERTZUIO', 'ASDFGHJK', 'PYXCVBNML']

export const MAX_PLUGS = 13
/** Number of cables historically issued / used (from 1939). */
export const HISTORICAL_PLUGS = 10

export const DEFAULT_SETTINGS: MachineSettings = {
  model: 'I',
  reflector: 'UKW-B',
  greek: null,
  left: { rotor: 'I', ring: 0, position: 0 },
  middle: { rotor: 'II', ring: 0, position: 0 },
  right: { rotor: 'III', ring: 0, position: 0 },
  plugboard: [],
}
