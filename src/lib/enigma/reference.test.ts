/*
 * Independent verification of the Enigma engine.
 *
 * This file contains a from-scratch reference model of the Enigma written from
 * the Wikipedia descriptions ("Enigma machine" → "Mathematical analysis" and
 * "Enigma rotor details" → wiring tables / turnover notches / normalized
 * sequences). It deliberately does NOT import any engine tables: the wirings
 * below were copied from the Wikipedia wikitext
 * (https://en.wikipedia.org/w/index.php?title=Enigma_rotor_details&action=raw)
 * and the engine constants are compared against them.
 *
 * Model: the encipherment of one key press is
 *   E = P · R · M · L · [G] · U · [G⁻¹] · L⁻¹ · M⁻¹ · R⁻¹ · P⁻¹
 * where a rotor whose core is turned k = window − ring steps acts as
 *   ρ⁻ᵏ · W · ρᵏ   (ρ = cyclic shift A→B).
 * Stepping is modelled as the three pawls of the ratchet mechanism.
 */
import { describe, expect, it } from 'vitest'
import { ENTRY_WHEEL, MODELS, REFLECTORS, ROTORS } from './constants'
import {
  encryptLetters,
  encryptText,
  positionsAfter,
  pressKey,
  reflectorWiring,
  startPositions,
  stepRotors,
  wiringTable,
} from './machine'
import type {
  AnyRotorId,
  KeypressTrace,
  MachineSettings,
  ModelId,
  Positions,
  ReflectorId,
  RotorId,
} from './types'

/* ------------------------------------------------------------------------ */
/* Reference data (copied from Wikipedia, not from the engine)              */
/* ------------------------------------------------------------------------ */

const WIKI_ROTORS: Record<string, { wiring: string; turnover: string }> = {
  I: { wiring: 'EKMFLGDQVZNTOWYHXUSPAIBRCJ', turnover: 'Q' },
  II: { wiring: 'AJDKSIRUXBLHWTMCQGZNPYFVOE', turnover: 'E' },
  III: { wiring: 'BDFHJLCPRTXVZNYEIWGAKMUSQO', turnover: 'V' },
  IV: { wiring: 'ESOVPZJAYQUIRHXLNFTGKDCMWB', turnover: 'J' },
  V: { wiring: 'VZBRGITYUPSDNHLXAWMJQOFECK', turnover: 'Z' },
  VI: { wiring: 'JPGVOUMFYQBENHZRDKASXLICTW', turnover: 'ZM' },
  VII: { wiring: 'NZJHGRCXMYSWBOUFAIVLPEKQDT', turnover: 'ZM' },
  VIII: { wiring: 'FKQHTLXOCBJSPDZRAMEWNIUYGV', turnover: 'ZM' },
  Beta: { wiring: 'LEYJVCNIXWPBQMDRTAKZGFUHOS', turnover: '' },
  Gamma: { wiring: 'FSOKANUERHMBTIYCWLQPZXVGJD', turnover: '' },
}

const WIKI_REFLECTORS: Record<string, string> = {
  'UKW-A': 'EJMZALYXVBWFCRQUONTSPIKHGD',
  'UKW-B': 'YRUHQSLDPXNGOKMIEBFZCWVJAT',
  'UKW-C': 'FVPJIAOYEDRZXWGCTKUQSBNMHL',
  'UKW-B-thin': 'ENKQAUYWJICOPBLMDXZVFTHRGS',
  'UKW-C-thin': 'RDOBJNTKVEHMLFCWZAXGYIPSUQ',
}

const WIKI_ETW = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Historical model equipment (Wikipedia / Crypto Museum). */
const MODEL_EQUIPMENT: Record<ModelId, { rotors: RotorId[]; reflectors: ReflectorId[]; greek: string[] }> = {
  I: { rotors: ['I', 'II', 'III', 'IV', 'V'], reflectors: ['UKW-A', 'UKW-B', 'UKW-C'], greek: [] },
  M3: {
    rotors: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'],
    reflectors: ['UKW-B', 'UKW-C'],
    greek: [],
  },
  M4: {
    rotors: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'],
    reflectors: ['UKW-B-thin', 'UKW-C-thin'],
    greek: ['Beta', 'Gamma'],
  },
}

/* ------------------------------------------------------------------------ */
/* Reference model                                                           */
/* ------------------------------------------------------------------------ */

const AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const md = (n: number): number => ((n % 26) + 26) % 26
const ord = (c: string): number => AZ.indexOf(c)

type Perm = number[]

function permOf(s: string): Perm {
  return [...s].map(ord)
}

function invert(p: Perm): Perm {
  const q: Perm = new Array<number>(26)
  p.forEach((y, x) => {
    q[y] = x
  })
  return q
}

/** ρ⁻ᵏ · W · ρᵏ — absolute (frame) mapping of a rotor whose core is turned by k. */
function turned(w: Perm, k: number): Perm {
  return Array.from({ length: 26 }, (_, x) => md(w[md(x + k)] - k))
}

interface RefRotor {
  name: string
  ring: number
  window: number
}

interface RefConfig {
  reflector: string
  /** Rotors left → right; 4 entries when a Greek wheel is fitted (index 0). */
  rotors: RefRotor[]
  plugs: [number, number][]
}

interface RefHop {
  component: string
  direction: 'forward' | 'reflect' | 'backward'
  input: number
  output: number
}

interface RefPress {
  windowsBefore: number[]
  windowsAfter: number[]
  advanced: boolean[]
  middleOwnNotch: boolean
  output: number
  hops: RefHop[]
}

class RefEnigma {
  private readonly cfg: RefConfig
  windows: number[]
  private readonly plug: Perm

  constructor(cfg: RefConfig) {
    this.cfg = cfg
    this.windows = cfg.rotors.map((r) => r.window)
    this.plug = Array.from({ length: 26 }, (_, i) => i)
    for (const [a, b] of cfg.plugs) {
      this.plug[a] = b
      this.plug[b] = a
    }
  }

  private atTurnover(index: number): boolean {
    const name = this.cfg.rotors[index].name
    return WIKI_ROTORS[name].turnover.includes(AZ[this.windows[index]])
  }

  /**
   * Three pawls sit between ETW|right, right|middle and middle|left. The first always
   * pushes the right rotor. A pawl that drops into the notch of the rotor on its right
   * pushes both that rotor and the one on its left.
   */
  private step(): { advanced: boolean[]; middleOwnNotch: boolean } {
    const n = this.windows.length
    const right = n - 1
    const middle = n - 2
    const left = n - 3
    const adv = this.windows.map(() => false)
    adv[right] = true
    if (this.atTurnover(right)) {
      adv[right] = true
      adv[middle] = true
    }
    const middleOwnNotch = this.atTurnover(middle)
    if (middleOwnNotch) {
      adv[middle] = true
      adv[left] = true
    }
    this.windows = this.windows.map((w, i) => (adv[i] ? md(w + 1) : w))
    return { advanced: adv, middleOwnNotch }
  }

  rotorPerm(index: number): Perm {
    const r = this.cfg.rotors[index]
    return turned(permOf(WIKI_ROTORS[r.name].wiring), this.windows[index] - r.ring)
  }

  press(letter: number): RefPress {
    const windowsBefore = this.windows.slice()
    const { advanced, middleOwnNotch } = this.step()
    const n = this.windows.length
    const names = n === 4 ? ['greek', 'left', 'middle', 'right'] : ['left', 'middle', 'right']
    const hops: RefHop[] = []
    const hop = (component: string, direction: RefHop['direction'], input: number, output: number): number => {
      hops.push({ component, direction, input, output })
      return output
    }
    const etw = permOf(WIKI_ETW)
    let c = hop('keyboard', 'forward', letter, letter)
    c = hop('plugboard', 'forward', c, this.plug[c])
    c = hop('entry', 'forward', c, etw[c])
    for (let i = n - 1; i >= 0; i--) c = hop(names[i], 'forward', c, this.rotorPerm(i)[c])
    c = hop('reflector', 'reflect', c, permOf(WIKI_REFLECTORS[this.cfg.reflector])[c])
    for (let i = 0; i < n; i++) c = hop(names[i], 'backward', c, invert(this.rotorPerm(i))[c])
    c = hop('entry', 'backward', c, invert(etw)[c])
    c = hop('plugboard', 'backward', c, this.plug[c])
    c = hop('lamp', 'backward', c, c)
    return { windowsBefore, windowsAfter: this.windows.slice(), advanced, middleOwnNotch, output: c, hops }
  }

  /** Letters are enciphered; everything else is passed through without stepping. */
  type(text: string): { output: string; presses: RefPress[] } {
    let output = ''
    const presses: RefPress[] = []
    for (const ch of text) {
      const l = ord(ch.toUpperCase())
      if (ch.length !== 1 || l < 0 || !/[a-z]/i.test(ch)) {
        output += ch
        continue
      }
      const p = this.press(l)
      presses.push(p)
      output += AZ[p.output]
    }
    return { output, presses }
  }
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

/** Seeded PRNG (xorshift32) — independent of the one used in the engine tests. */
function xorshift(seed: number): () => number {
  let x = seed >>> 0 || 1
  return () => {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    return x / 4294967296
  }
}

const pick = <T,>(rand: () => number, items: readonly T[]): T => items[Math.floor(rand() * items.length)]
const int = (rand: () => number, n: number): number => Math.floor(rand() * n)

function toRef(s: MachineSettings): RefConfig {
  const slots = s.greek ? [s.greek, s.left, s.middle, s.right] : [s.left, s.middle, s.right]
  return {
    reflector: s.reflector,
    rotors: slots.map((r) => ({ name: r.rotor, ring: r.ring, window: r.position })),
    plugs: s.plugboard.map(([a, b]) => [a, b] as [number, number]),
  }
}

function windowsOf(p: Positions): number[] {
  return p.greek === null ? [p.left, p.middle, p.right] : [p.greek, p.left, p.middle, p.right]
}

function lettersFrom(s: string): number[] {
  return [...s].map(ord)
}

/** Human-notation settings builder: rotors left → right, rings 1..26, key letters left → right. */
function settingsFrom(o: {
  model: ModelId
  reflector: ReflectorId
  rotors: AnyRotorId[]
  rings: number[]
  key: string
  plugs: string
}): MachineSettings {
  const slots = o.rotors.map((rotor, i) => ({ rotor, ring: o.rings[i] - 1, position: ord(o.key[i]) }))
  const g = slots.length === 4
  const k = g ? 1 : 0
  const plugboard = o.plugs
    .split(' ')
    .filter(Boolean)
    .map((p) => [ord(p[0]), ord(p[1])] as [number, number])
  return {
    model: o.model,
    reflector: o.reflector,
    greek: g ? slots[0] : null,
    left: slots[k],
    middle: slots[k + 1],
    right: slots[k + 2],
    plugboard,
  }
}

const strip = (s: string): string => s.replace(/[^A-Z]/g, '')

/**
 * Random settings generator for the fuzzer. Half of the configurations are
 * "double-step heavy": the middle rotor starts on / just before its turnover letter
 * and the right rotor a few presses before its own turnover letter.
 */
function fuzzSettings(rand: () => number): MachineSettings {
  const model = pick(rand, ['I', 'M3', 'M4'] as ModelId[])
  const eq = MODEL_EQUIPMENT[model]
  const pool = eq.rotors.slice()
  const take = (): RotorId => pool.splice(int(rand, pool.length), 1)[0]
  const left = take()
  const middle = take()
  const right = take()
  // Rings ≠ A most of the time.
  const ring = (): number => (rand() < 0.85 ? 1 + int(rand, 25) : 0)
  const heavy = rand() < 0.5
  const near = (id: RotorId, maxBefore: number): number => {
    const t = pick(rand, [...WIKI_ROTORS[id].turnover])
    return md(ord(t) - int(rand, maxBefore + 1))
  }
  const plugCount = int(rand, 14)
  const letters = Array.from({ length: 26 }, (_, i) => i)
  for (let i = 25; i > 0; i--) {
    const j = int(rand, i + 1)
    ;[letters[i], letters[j]] = [letters[j], letters[i]]
  }
  const plugboard: [number, number][] = []
  for (let i = 0; i < plugCount; i++) plugboard.push([letters[2 * i], letters[2 * i + 1]])
  return {
    model,
    reflector: pick(rand, eq.reflectors),
    greek: eq.greek.length
      ? { rotor: pick(rand, eq.greek) as AnyRotorId, ring: ring(), position: int(rand, 26) }
      : null,
    left: { rotor: left, ring: ring(), position: int(rand, 26) },
    middle: { rotor: middle, ring: ring(), position: heavy ? near(middle, 1) : int(rand, 26) },
    right: { rotor: right, ring: ring(), position: heavy ? near(right, 3) : int(rand, 26) },
    plugboard,
  }
}

function fuzzText(rand: () => number): string {
  const len = 1 + int(rand, 80)
  let s = ''
  for (let i = 0; i < len; i++) {
    const r = rand()
    if (r < 0.08) s += pick(rand, [' ', '.', '-', '1', '\n', 'ß', 'é'])
    else if (r < 0.3) s += AZ[int(rand, 26)].toLowerCase()
    else s += AZ[int(rand, 26)]
  }
  return s
}

function compareTrace(trace: KeypressTrace, ref: RefPress, s: MachineSettings): void {
  const hasGreek = s.greek !== null
  // Stepping
  expect(windowsOf(trace.stepping.before)).toEqual(ref.windowsBefore)
  expect(windowsOf(trace.stepping.after)).toEqual(ref.windowsAfter)
  const k = hasGreek ? 1 : 0
  expect(trace.stepping.stepped).toEqual({
    left: ref.advanced[k],
    middle: ref.advanced[k + 1],
    right: ref.advanced[k + 2],
  })
  expect(trace.stepping.doubleStep).toBe(ref.middleOwnNotch)
  if (hasGreek) expect(ref.advanced[0]).toBe(false)
  // Stages
  expect(trace.stages).toHaveLength(hasGreek ? 15 : 13)
  expect(
    trace.stages.map((st) => ({ component: st.component, direction: st.direction, input: st.input, output: st.output })),
  ).toEqual(ref.hops)
  expect(trace.output).toBe(ref.output)
  for (const st of trace.stages) {
    const isRotor = st.kind === 'rotor'
    expect(st.coreInput !== undefined).toBe(isRotor)
    expect(st.coreOutput !== undefined).toBe(isRotor)
    expect(st.offset !== undefined).toBe(isRotor)
    if (isRotor) {
      const slot = st.component as 'greek' | 'left' | 'middle' | 'right'
      const rs = slot === 'greek' ? s.greek! : s[slot]
      const win = slot === 'greek' ? trace.stepping.after.greek! : trace.stepping.after[slot]
      expect(st.offset).toBe(md(win - rs.ring))
      expect(st.coreInput).toBe(md(st.input + st.offset!))
      const core = permOf(WIKI_ROTORS[rs.rotor].wiring)
      expect(st.coreOutput).toBe(st.direction === 'forward' ? core[st.coreInput!] : invert(core)[st.coreInput!])
    }
  }
}

/* ------------------------------------------------------------------------ */
/* 1. Constants vs Wikipedia                                                 */
/* ------------------------------------------------------------------------ */

describe('engine constants match Wikipedia "Enigma rotor details"', () => {
  it('rotor wirings and turnover letters', () => {
    for (const [id, w] of Object.entries(WIKI_ROTORS)) {
      const spec = ROTORS[id as AnyRotorId]
      expect(spec.wiring, id).toBe(w.wiring)
      expect([...spec.notches].sort().join(''), id).toBe([...w.turnover].sort().join(''))
      expect(spec.kind).toBe(w.turnover === '' ? 'greek' : 'rotor')
      expect(wiringTable(id as AnyRotorId).forward).toEqual(permOf(w.wiring))
    }
    expect(Object.keys(ROTORS).sort()).toEqual(Object.keys(WIKI_ROTORS).sort())
  })

  it('reflector wirings and entry wheel', () => {
    for (const [id, w] of Object.entries(WIKI_REFLECTORS)) {
      expect(REFLECTORS[id as ReflectorId].wiring, id).toBe(w)
      expect(REFLECTORS[id as ReflectorId].thin).toBe(id.endsWith('thin'))
      expect(reflectorWiring(id as ReflectorId)).toEqual(permOf(w))
    }
    expect(Object.keys(REFLECTORS).sort()).toEqual(Object.keys(WIKI_REFLECTORS).sort())
    expect(ENTRY_WHEEL).toBe(WIKI_ETW)
  })

  it('model → allowed rotors / reflectors / Greek wheels', () => {
    for (const id of ['I', 'M3', 'M4'] as ModelId[]) {
      const m = MODELS[id]
      const eq = MODEL_EQUIPMENT[id]
      expect([...m.rotorIds].sort()).toEqual([...eq.rotors].sort())
      expect([...m.reflectorIds].sort()).toEqual([...eq.reflectors].sort())
      expect([...m.greekIds].sort()).toEqual([...eq.greek].sort())
      expect(m.hasGreek).toBe(eq.greek.length > 0)
    }
  })
})

/* ------------------------------------------------------------------------ */
/* 2. Reference model sanity (it must itself reproduce published data)       */
/* ------------------------------------------------------------------------ */

describe('reference model sanity', () => {
  it('reproduces AAAAA → BDZGO and the Wikipedia normalized double-step sequence', () => {
    const ref = new RefEnigma({
      reflector: 'UKW-B',
      rotors: [
        { name: 'I', ring: 0, window: 0 },
        { name: 'II', ring: 0, window: 0 },
        { name: 'III', ring: 0, window: 0 },
      ],
      plugs: [],
    })
    expect(ref.type('AAAAA').output).toBe('BDZGO')
    const ds = new RefEnigma({
      reflector: 'UKW-B',
      rotors: [
        { name: 'I', ring: 0, window: ord('A') },
        { name: 'II', ring: 0, window: ord('D') },
        { name: 'III', ring: 0, window: ord('U') },
      ],
      plugs: [],
    })
    const seq = ds.type('AAAA').presses.map((p) => p.windowsAfter.map((w) => AZ[w]).join(''))
    expect(seq).toEqual(['ADV', 'AEW', 'BFX', 'BFY'])
  })
})

/* ------------------------------------------------------------------------ */
/* 3. Published messages not covered by machine.test.ts                      */
/* ------------------------------------------------------------------------ */

describe('additional published messages (engine and reference model)', () => {
  /*
   * German Wikipedia, "Enigma (Maschine)", section "Funkspruch" — worked example:
   * Enigma I, UKW B, Walzenlage I IV III, Ringstellung 16 26 08,
   * Stecker AD CN ET FL GI JV KZ PU QY WX, Grundstellung QWE, Spruchschlüssel RTZ → EWG.
   * The Kenngruppe XYOWN is sent in clear and is not enciphered.
   * https://de.wikipedia.org/wiki/Enigma_(Maschine)
   */
  const deWiki = settingsFrom({
    model: 'I',
    reflector: 'UKW-B',
    rotors: ['I', 'IV', 'III'],
    rings: [16, 26, 8],
    key: 'RTZ',
    plugs: 'AD CN ET FL GI JV KZ PU QY WX',
  })
  const dePlain =
    'XAACH ENXAA CHENX ISTGE RETTE TXDUR QGEBU ENDEL TENEI NSATZ DERHI LFSKR AEFTE KONNT EDIEB ' +
    'EDROH UNGAB GEWEN DETUN DDIER ETTUN GDERS TADTG EGENX EINSX AQTXN ULLXN ULLXU HRSIQ ERGES TELLT WERDE NX'
  const deCipher =
    'EJZLB SYEQP DWDUE EJJOU PSOFL BMUIM GLCSK BKJLY ZTEIY THZLU EUHRR KUZOW BVXFO UIZHY GVDXW ' +
    'QKKSB CPTVM NGUCL TQISS BTNSF GNFZC QSJAR CNOSE GWMYC HNODW FGGZC QNHZY FATHT QWKGU NWHOX BWKFN PYAMV FT'

  it('de.wikipedia worked example: indicator QWE + EWG → message key RTZ', () => {
    const atQwe: MachineSettings = {
      ...deWiki,
      left: { ...deWiki.left, position: ord('Q') },
      middle: { ...deWiki.middle, position: ord('W') },
      right: { ...deWiki.right, position: ord('E') },
    }
    expect(encryptText(atQwe, 'RTZ', { nonLetters: 'remove' }).output).toBe('EWG')
    expect(encryptText(atQwe, 'EWG', { nonLetters: 'remove' }).output).toBe('RTZ')
    expect(new RefEnigma(toRef(atQwe)).type('EWG').output).toBe('RTZ')
  })

  it('de.wikipedia worked example: 162-letter message body at RTZ', () => {
    expect(strip(dePlain)).toHaveLength(162) // 167 letters minus the 5-letter Kenngruppe
    expect(encryptText(deWiki, dePlain, { nonLetters: 'remove' }).output).toBe(strip(deCipher))
    expect(encryptText(deWiki, deCipher, { nonLetters: 'remove' }).output).toBe(strip(dePlain))
    expect(new RefEnigma(toRef(deWiki)).type(strip(deCipher)).output).toBe(strip(dePlain))
  })

  /*
   * Operation Barbarossa, 7 July 1941, part 2 (message key LSD). Ciphertext from
   * Franklin Heath "Enigma/Sample Messages", plaintext from "Enigma/Sample Decrypts"
   * (Geoff Sullivan & Frode Weierud). Same daily key as part 1.
   */
  it('Operation Barbarossa, 1941, part 2 (Enigma I, UKW-B, II IV V, rings 02 21 12, key LSD)', () => {
    const s = settingsFrom({
      model: 'I',
      reflector: 'UKW-B',
      rotors: ['II', 'IV', 'V'],
      rings: [2, 21, 12],
      key: 'LSD',
      plugs: 'AV BS CG DL FU HZ IN KM OW RX',
    })
    const cipher =
      'SFBWD NJUSE GQOBH KRTAR EEZMW KPPRB XOHDR OEQGB BGTQV PGVKB VVGBI MHUSZ YDAJQ IROAX SSSNR ' +
      'EHYGG RPISE ZBOVM QIEMM ZCYSG QDGRE RVBIL EKXYQ IRGIR QNRDN VRXCY YTNJR'
    const plain =
      'DREIG EHTLA NGSAM ABERS IQERV ORWAE RTSXE INSSI EBENN ULLSE QSXUH RXROE MXEIN SXINF RGTXD ' +
      'REIXA UFFLI EGERS TRASZ EMITA NFANG XEINS SEQSX KMXKM XOSTW XKAME NECXK'
    expect(encryptText(s, cipher, { nonLetters: 'remove' }).output).toBe(strip(plain))
    expect(new RefEnigma(toRef(s)).type(strip(cipher)).output).toBe(strip(plain))
  })

  it('reference model also reproduces the U-264 M4 message (Franklin Heath)', () => {
    const s = settingsFrom({
      model: 'M4',
      reflector: 'UKW-B-thin',
      rotors: ['Beta', 'II', 'IV', 'I'],
      rings: [1, 1, 1, 22],
      key: 'VJNA',
      plugs: 'AT BL DF GJ HM NW OP QY RZ VX',
    })
    const cipher = 'NCZW VUSX PNYM INHZ XMQX SFWX WLKJ AHSH NMCO CCAK UQPM KCSM HKSE INJU SBLK IOSX'
    const plain = 'VONV ONJL OOKS JHFF TTTE INSE INSD REIZ WOYY QNNS NEUN INHA LTXX BEIA NGRI FFUN'
    expect(new RefEnigma(toRef(s)).type(strip(cipher)).output).toBe(strip(plain))
    expect(encryptLetters(s, cipher)).toBe(strip(plain))
  })

  /*
   * English Wikipedia, "Enigma machine" → "Example enciphering process": the first
   * sentence of the main body of the Dönitz message (M4, UKW-C thin, β V VI VIII,
   * rings E P E L, plugs AE BF CM DQ HU JN LX PR SZ VW, message key CDSZ; the body
   * starts after the 10 letters KRKRALLEXX). Each row lists the full substitution
   * alphabet in effect for that key press, the window letters, and the core
   * positions (window − ring + 1).
   * https://en.wikipedia.org/wiki/Enigma_machine#Example_enciphering_process
   */
  const DONITZ_ROWS: [string, string, string, string][] = [
    ['F', 'KGWNTRBLQPAHYDVJIFXEZOCSMU', 'CDTK', '25 15 16 26'],
    ['O', 'UORYTQSLWXZHNMBVFCGEAPIJDK', 'CDTL', '25 15 16 01'],
    ['L', 'HLNRSKJAMGFBICUQPDEYOZXWTV', 'CDTM', '25 15 16 02'],
    ['G', 'KPTXIGFMESAUHYQBOVJCLRZDNW', 'CDUN', '25 15 17 03'],
    ['E', 'XDYBPWOSMUZRIQGENLHVJTFACK', 'CDUO', '25 15 17 04'],
    ['N', 'DLIAJUOVCEXBNMGQPWZYFHRKTS', 'CDUP', '25 15 17 05'],
    ['D', 'LUSHQOXDMZNAIKFREPCYBWVGTJ', 'CDUQ', '25 15 17 06'],
    ['E', 'JKGOPTCIHABRNMDEYLZFXWVUQS', 'CDUR', '25 15 17 07'],
    ['S', 'GCBUZRASYXVMLPQNOFHWDKTJIE', 'CDUS', '25 15 17 08'],
    ['I', 'XPJUOWIYGCVRTQEBNLZMDKFAHS', 'CDUT', '25 15 17 09'],
    ['S', 'DISAUYOMBPNTHKGJRQCLEZXWFV', 'CDUU', '25 15 17 10'],
    ['T', 'FJLVQAKXNBGCPIRMEOYZWDUHST', 'CDUV', '25 15 17 11'],
    ['S', 'KTJUQONPZCAMLGFHEWXBDYRSVI', 'CDUW', '25 15 17 12'],
    ['O', 'ZQXUVGFNWRLKPHTMBJYODEICSA', 'CDUX', '25 15 17 13'],
    ['F', 'XJWFRDZSQBLKTVPOIEHMYNCAUG', 'CDUY', '25 15 17 14'],
    ['O', 'FSKTJARXPECNULYIZGBDMWVHOQ', 'CDUZ', '25 15 17 15'],
    ['R', 'CEAKBMRYUVDNFLTXWGZOIJQPHS', 'CDVA', '25 15 18 16'],
    ['T', 'TLJRVQHGUCXBZYSWFDOAIEPKNM', 'CDVB', '25 15 18 17'],
    ['B', 'YHLPGTEBKWICSVUDRQMFONJZAX', 'CDVC', '25 15 18 18'],
    ['E', 'KRULGJEWNFADVIPOYBXZCMHSQT', 'CDVD', '25 15 18 19'],
    ['K', 'RCBPQMVZXYUOFSLDEANWKGTIJH', 'CDVE', '25 15 18 20'],
    ['A', 'FCBJQAWTVDYNXLUSEZPHOIGMKR', 'CDVF', '25 15 18 21'],
    ['N', 'VFTQSBPORUZWYXHGDIECJALNMK', 'CDVG', '25 15 18 22'],
    ['N', 'JSRHFENDUAZYQGXTMCBPIWVOLK', 'CDVH', '25 15 18 23'],
    ['T', 'RCBUTXVZJINQPKWMLAYEDGOFSH', 'CDVI', '25 15 18 24'],
    ['Z', 'URFXNCMYLVPIGESKTBOQAJZDHW', 'CDVJ', '25 15 18 25'],
    ['U', 'JIOZFEWMBAUSHPCNRQLVKTGYXD', 'CDVK', '25 15 18 26'],
    ['G', 'ZGVRKOBXLNEIWJFUSDQYPCMHTA', 'CDVL', '25 15 18 01'],
    ['E', 'RMJVLYQZKCIEBONUGAWXPDSTFH', 'CDVM', '25 15 18 02'],
    ['B', 'GKQRFEANZPBMLHVJCDUXSOYTWI', 'CDWN', '25 15 19 03'],
    ['E', 'YMZTGVEKQOHPBSJLIUNDRFXWAC', 'CDWO', '25 15 19 04'],
    ['N', 'PDSBTIUQFNOVWJKAHZCEGLMYXR', 'CDWP', '25 15 19 05'],
  ]
  const donitz = settingsFrom({
    model: 'M4',
    reflector: 'UKW-C-thin',
    rotors: ['Beta', 'V', 'VI', 'VIII'],
    rings: [5, 16, 5, 12],
    key: 'CDSZ',
    plugs: 'AE BF CM DQ HU JN LX PR SZ VW',
  })

  it('Dönitz message, Wikipedia per-key-press table: windows, core positions and full alphabets', () => {
    let pos = positionsAfter(donitz, 10) // after KRKRALLEXX
    let cipher = ''
    for (const [plain, alphabet, windows, cores] of DONITZ_ROWS) {
      // Full substitution alphabet in effect for this key press.
      const row = Array.from({ length: 26 }, (_, x) => AZ[pressKey(donitz, pos, x).trace.output]).join('')
      expect(row, windows).toBe(alphabet)
      const { trace, positions } = pressKey(donitz, pos, ord(plain))
      expect(windowsOf(positions).map((w) => AZ[w]).join('')).toBe(windows)
      const offsets = ['greek', 'left', 'middle', 'right'].map((slot) => {
        const st = trace.stages.find((x) => x.component === slot && x.direction === 'forward')!
        return String(st.offset! + 1).padStart(2, '0')
      })
      expect(offsets.join(' ')).toBe(cores)
      cipher += AZ[trace.output]
      pos = positions
    }
    expect(cipher).toBe(strip('RBBF PMHP HGCZ XTDY GAHG UFXG EWKB LKGJ'))
    expect(encryptLetters(donitz, 'KRKRALLEXX' + DONITZ_ROWS.map((r) => r[0]).join(''))).toBe(
      'LANOTCTOUA' + cipher,
    )
  })

  it('Dönitz message, Wikipedia stage expansion of the 4th key press (G → F)', () => {
    const before = positionsAfter(donitz, 13)
    const { trace } = pressKey(donitz, before, ord('G'))
    const path = trace.stages.map((st) => `${st.component}:${AZ[st.input]}${AZ[st.output]}`)
    // G >P G >VIII A >VI N >V L >β Y >c U >β B >V V >VI F >VIII B >P F
    expect(path).toEqual([
      'keyboard:GG',
      'plugboard:GG',
      'entry:GG',
      'right:GA',
      'middle:AN',
      'left:NL',
      'greek:LY',
      'reflector:YU',
      'greek:UB',
      'left:BV',
      'middle:VF',
      'right:FB',
      'entry:BB',
      'plugboard:BF',
      'lamp:FF',
    ])
    // The per-component alphabets printed by Wikipedia for that press (reference model check).
    const ref = new RefEnigma(toRef(donitz))
    ref.type('KRKRALLEXXFOL')
    ref.press(ord('G'))
    const s = (p: Perm): string => p.map((x) => AZ[x]).join('')
    expect(s(ref.rotorPerm(3))).toBe('OFRJVMAZHQNBXPYKCULGSWETDI') // VIII, N 03
    expect(s(ref.rotorPerm(2))).toBe('NUKCHVSMDGTZQFYEWPIALOXRJB') // VI, U 17
    expect(s(ref.rotorPerm(1))).toBe('XJMIYVCARQOWHLNDSUFKGBEPZT') // V, D 15
    expect(s(ref.rotorPerm(0))).toBe('QUNGALXEPKZYRDSOFTVCMBIHWJ') // β, C 25
    expect(s(invert(ref.rotorPerm(0)))).toBe('EVTNHQDXWZJFUCPIAMORBSYGLK')
    expect(s(invert(ref.rotorPerm(1)))).toBe('HVGPWSUMDBTNCOKXJIQZRFLAEY')
    expect(s(invert(ref.rotorPerm(2)))).toBe('TZDIPNJESYCUHAVRMXGKBFQWOL')
    expect(s(invert(ref.rotorPerm(3)))).toBe('GLQYWBTIZDPSFKANJCUXREVMOH')
  })
})

/* ------------------------------------------------------------------------ */
/* 4. Differential fuzzing: engine vs reference                              */
/* ------------------------------------------------------------------------ */

describe('differential fuzz: engine vs independent reference', () => {
  it('2,000 random settings × random texts (I / M3 / M4, double-step heavy, rings ≠ A)', () => {
    const rand = xorshift(0x5eed1234)
    const stats = { I: 0, M3: 0, M4: 0, doubleSteps: 0, leftSteps: 0, presses: 0, simultaneous: 0 }
    for (let n = 0; n < 2000; n++) {
      const s = fuzzSettings(rand)
      const text = fuzzText(rand)
      stats[s.model]++
      const ref = new RefEnigma(toRef(s)).type(text)

      const keep = encryptText(s, text, { nonLetters: 'keep' })
      expect(keep.output, `#${n} keep`).toBe(ref.output)
      const lettersOnly = [...ref.output].filter((c) => /[A-Z]/.test(c)).join('')
      const removedRef = [...text].filter((c) => /^[a-z]$/i.test(c)).length
      const remove = encryptText(s, text, { nonLetters: 'remove' })
      expect(remove.output, `#${n} remove`).toBe(lettersOnly)
      expect(remove.output).toHaveLength(removedRef)
      expect(encryptLetters(s, text)).toBe(lettersOnly)

      expect(keep.traces).toHaveLength(ref.presses.length)
      keep.traces.forEach((t, i) => {
        expect(t.index).toBe(i)
        compareTrace(t, ref.presses[i], s)
        stats.presses++
        if (t.stepping.doubleStep) stats.doubleSteps++
        if (t.stepping.stepped.left) stats.leftSteps++
        const pre = ref.presses[i]
        const k = s.greek ? 1 : 0
        const rightAtNotch = WIKI_ROTORS[s.right.rotor].turnover.includes(AZ[pre.windowsBefore[k + 2]])
        if (rightAtNotch && pre.middleOwnNotch) stats.simultaneous++
      })
      const finalRef = ref.presses.length ? ref.presses[ref.presses.length - 1].windowsAfter : windowsOf(startPositions(s))
      expect(windowsOf(keep.finalPositions)).toEqual(finalRef)
      expect(windowsOf(positionsAfter(s, ref.presses.length))).toEqual(finalRef)

      // Index maps
      expect(keep.inputToTrace).toHaveLength(text.length)
      expect(keep.outputToTrace).toHaveLength(keep.output.length)
      expect(remove.outputToTrace).toEqual(remove.traces.map((_, i) => i))
      for (let i = 0; i < text.length; i++) {
        const ti = keep.inputToTrace[i]
        if (ti === null) {
          expect(keep.output[i]).toBe(text[i])
          expect(keep.outputToTrace[i]).toBeNull()
        } else {
          expect(keep.outputToTrace[i]).toBe(ti)
          expect(keep.output[i]).toBe(AZ[keep.traces[ti].output])
          expect(keep.traces[ti].input).toBe(ord(text[i].toUpperCase()))
        }
      }
    }
    // The fuzzer really exercised every model and the stepping anomalies.
    expect(stats.I).toBeGreaterThan(500)
    expect(stats.M3).toBeGreaterThan(500)
    expect(stats.M4).toBeGreaterThan(500)
    expect(stats.doubleSteps).toBeGreaterThan(500)
    expect(stats.leftSteps).toBeGreaterThan(500)
    expect(stats.simultaneous).toBeGreaterThan(0)
  }, 60_000)

  it('pressKey chained manually equals encryptText and the reference', () => {
    const rand = xorshift(77)
    for (let n = 0; n < 100; n++) {
      const s = fuzzSettings(rand)
      const text = Array.from({ length: 40 }, () => AZ[int(rand, 26)]).join('')
      const ref = new RefEnigma(toRef(s)).type(text)
      let pos = startPositions(s)
      let out = ''
      for (let i = 0; i < text.length; i++) {
        const before = pos
        const r = pressKey(s, pos, ord(text[i]))
        expect(r.trace.index).toBe(0)
        expect(r.trace.stepping.before).toEqual(before)
        expect(stepRotors(s, before)).toEqual(r.trace.stepping)
        compareTrace(r.trace, ref.presses[i], s)
        out += AZ[r.trace.output]
        pos = r.positions
      }
      expect(out).toBe(ref.output)
    }
  })
})

/* ------------------------------------------------------------------------ */
/* 5. Stepping flag semantics                                                */
/* ------------------------------------------------------------------------ */

describe('stepping flags', () => {
  const base = settingsFrom({
    model: 'M3',
    reflector: 'UKW-B',
    rotors: ['I', 'II', 'III'],
    rings: [1, 1, 1],
    key: 'AAA',
    plugs: '',
  })
  const at = (key: string, rings: number[] = [1, 1, 1]): MachineSettings => ({
    ...base,
    left: { rotor: 'I', ring: rings[0] - 1, position: ord(key[0]) },
    middle: { rotor: 'II', ring: rings[1] - 1, position: ord(key[1]) },
    right: { rotor: 'III', ring: rings[2] - 1, position: ord(key[2]) },
  })

  it('normal carry (right at V) steps the middle rotor but is not a double step', () => {
    const info = stepRotors(at('AAV'), startPositions(at('AAV')))
    expect(info.stepped).toEqual({ left: false, middle: true, right: true })
    expect(info.doubleStep).toBe(false)
    expect(lettersFrom('ABW')).toEqual(windowsOf(info.after))
  })

  it('middle rotor sitting on its own notch steps itself and the left rotor (double step)', () => {
    const info = stepRotors(at('AEA'), startPositions(at('AEA')))
    expect(windowsOf(info.after)).toEqual(lettersFrom('BFB'))
    expect(info.stepped).toEqual({ left: true, middle: true, right: true })
    expect(info.doubleStep).toBe(true)
  })

  it('right and middle both at their notches: middle steps once, left steps', () => {
    const info = stepRotors(at('AEV'), startPositions(at('AEV')))
    expect(windowsOf(info.after)).toEqual(lettersFrom('BFW'))
    expect(info.stepped).toEqual({ left: true, middle: true, right: true })
  })

  it('turnover depends on the window letter, not on the ring setting', () => {
    for (const ring of [1, 7, 26]) {
      const info = stepRotors(at('ADV', [ring, ring, ring]), startPositions(at('ADV', [ring, ring, ring])))
      expect(windowsOf(info.after)).toEqual(lettersFrom('AEW'))
    }
  })

  it('left rotor wraps Z → A and does not carry further (Greek wheel untouched)', () => {
    const s = settingsFrom({
      model: 'M4',
      reflector: 'UKW-B-thin',
      rotors: ['Beta', 'V', 'II', 'III'],
      rings: [3, 4, 5, 6],
      key: 'QZEA',
      plugs: '',
    })
    const info = stepRotors(s, startPositions(s))
    expect(windowsOf(info.after)).toEqual(lettersFrom('QAFB'))
    expect(info.after.greek).toBe(ord('Q'))
  })
})
