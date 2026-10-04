import { describe, expect, it } from 'vitest'
import { ALPHABET, DEFAULT_SETTINGS, REFLECTORS, ROTORS } from './constants'
import { toChar, toLetter } from './letters'
import {
  activeSlots,
  encryptLetters,
  encryptText,
  inverseWiring,
  positionsAfter,
  pressKey,
  reflectorWiring,
  startPositions,
  stepRotors,
  wiringTable,
} from './machine'
import { parsePlugboard } from './plugboard'
import { randomSettings } from './settings'
import type { AnyRotorId, MachineSettings, ModelId, Positions, RotorId } from './types'

/** Deterministic PRNG (mulberry32) so property tests are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomText(rand: () => number, n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(rand() * 26)]
  return s
}

const L = (s: string): number => {
  const l = toLetter(s)
  if (l === null) throw new Error(`bad letter ${s}`)
  return l
}

/** Builds settings from human notation: rotors left→right, rings as numbers 1..26, key letters. */
function machine(opts: {
  model: ModelId
  reflector: MachineSettings['reflector']
  rotors: AnyRotorId[]
  rings: number[]
  key: string
  plugs: string
}): MachineSettings {
  const slots = opts.rotors.map((rotor, i) => ({
    rotor,
    ring: opts.rings[i] - 1,
    position: L(opts.key[i]),
  }))
  const hasGreek = slots.length === 4
  const o = hasGreek ? 1 : 0
  const { pairs, errors } = parsePlugboard(opts.plugs)
  expect(errors).toEqual([])
  return {
    model: opts.model,
    reflector: opts.reflector,
    greek: hasGreek ? slots[0] : null,
    left: slots[o],
    middle: slots[o + 1],
    right: slots[o + 2],
    plugboard: pairs,
  }
}

const strip = (s: string): string => s.replace(/[^A-Z]/g, '')

function posString(p: Positions): string {
  return (p.greek === null ? '' : toChar(p.greek)) + toChar(p.left) + toChar(p.middle) + toChar(p.right)
}

describe('wirings', () => {
  it('every rotor wiring is a permutation of the alphabet', () => {
    for (const spec of Object.values(ROTORS)) {
      expect([...spec.wiring].sort().join('')).toBe(ALPHABET)
    }
  })

  it('every reflector is a fixed-point-free involution', () => {
    for (const id of Object.keys(REFLECTORS) as (keyof typeof REFLECTORS)[]) {
      const w = reflectorWiring(id)
      for (let i = 0; i < 26; i++) {
        expect(w[i]).not.toBe(i)
        expect(w[w[i]]).toBe(i)
      }
    }
  })

  it('inverseWiring / wiringTable are consistent', () => {
    expect(inverseWiring('EKMFLGDQVZNTOWYHXUSPAIBRCJ')).toBe('UWYGADFPVZBECKMTHXSLRINQOJ')
    expect(inverseWiring(ALPHABET)).toBe(ALPHABET)
    const t = wiringTable('VI')
    expect(t.wiring).toBe(ROTORS.VI.wiring)
    expect(t.notches).toEqual([L('Z'), L('M')])
    for (let i = 0; i < 26; i++) expect(t.backward[t.forward[i]]).toBe(i)
    expect(t.inverse).toBe(inverseWiring(t.wiring))
    expect(wiringTable('Beta').notches).toEqual([])
  })
})

describe('known test vectors', () => {
  it('Enigma I, UKW-B, I-II-III, rings AAA, pos AAA: AAAAA → BDZGO', () => {
    expect(encryptText(DEFAULT_SETTINGS, 'AAAAA', { nonLetters: 'keep' }).output).toBe('BDZGO')
  })

  it('rings BBB: AAAAA → EWTYX', () => {
    const s: MachineSettings = {
      ...DEFAULT_SETTINGS,
      left: { rotor: 'I', ring: 1, position: 0 },
      middle: { rotor: 'II', ring: 1, position: 0 },
      right: { rotor: 'III', ring: 1, position: 0 },
    }
    expect(encryptText(s, 'AAAAA', { nonLetters: 'keep' }).output).toBe('EWTYX')
  })

  it('is case-insensitive and keeps / removes non-letters', () => {
    const keep = encryptText(DEFAULT_SETTINGS, 'aa a-aa!', { nonLetters: 'keep' })
    expect(keep.output).toBe('BD Z-GO!')
    expect(keep.inputToTrace).toEqual([0, 1, null, 2, null, 3, 4, null])
    expect(keep.outputToTrace).toEqual([0, 1, null, 2, null, 3, 4, null])
    const remove = encryptText(DEFAULT_SETTINGS, 'aa a-aa!', { nonLetters: 'remove' })
    expect(remove.output).toBe('BDZGO')
    expect(remove.inputToTrace).toEqual([0, 1, null, 2, null, 3, 4, null])
    expect(remove.outputToTrace).toEqual([0, 1, 2, 3, 4])
    expect(remove.traces.map((t) => t.index)).toEqual([0, 1, 2, 3, 4])
    expect(posString(remove.finalPositions)).toBe('AAF')
  })

  it('non-letters do not step the rotors', () => {
    const r = encryptText(DEFAULT_SETTINGS, '  1234 ', { nonLetters: 'keep' })
    expect(r.output).toBe('  1234 ')
    expect(r.traces).toHaveLength(0)
    expect(r.finalPositions).toEqual(startPositions(DEFAULT_SETTINGS))
  })
})

describe('stepping', () => {
  it('double-steps: I-II-III from ADU → ADV, AEW, BFX, BFY', () => {
    const s: MachineSettings = {
      ...DEFAULT_SETTINGS,
      left: { rotor: 'I', ring: 0, position: L('A') },
      middle: { rotor: 'II', ring: 0, position: L('D') },
      right: { rotor: 'III', ring: 0, position: L('U') },
    }
    let pos = startPositions(s)
    const seen: string[] = []
    const infos = []
    for (let i = 0; i < 4; i++) {
      const info = stepRotors(s, pos)
      infos.push(info)
      pos = info.after
      seen.push(posString(pos))
    }
    expect(seen).toEqual(['ADV', 'AEW', 'BFX', 'BFY'])
    expect(infos.map((i) => i.stepped)).toEqual([
      { left: false, middle: false, right: true },
      { left: false, middle: true, right: true },
      { left: true, middle: true, right: true },
      { left: false, middle: false, right: true },
    ])
    expect(infos.map((i) => i.doubleStep)).toEqual([false, false, true, false])
    expect(posString(positionsAfter(s, 4))).toBe('BFY')
  })

  it('left rotor notch has no effect', () => {
    const s: MachineSettings = {
      ...DEFAULT_SETTINGS,
      left: { rotor: 'I', ring: 0, position: L('Q') },
      middle: { rotor: 'II', ring: 0, position: L('A') },
      right: { rotor: 'III', ring: 0, position: L('A') },
    }
    const info = stepRotors(s, startPositions(s))
    expect(posString(info.after)).toBe('QAB')
  })

  it('two-notch rotors (VI–VIII) turn over at Z and M', () => {
    const s: MachineSettings = {
      ...DEFAULT_SETTINGS,
      model: 'M3',
      left: { rotor: 'I', ring: 0, position: L('A') },
      middle: { rotor: 'II', ring: 0, position: L('A') },
      right: { rotor: 'VI', ring: 0, position: L('L') },
    }
    // L→M (no carry), M→N (carry), ... Y→Z (no carry), Z→A (carry)
    let pos = startPositions(s)
    const middles: string[] = []
    for (let i = 0; i < 16; i++) {
      pos = stepRotors(s, pos).after
      middles.push(toChar(pos.middle))
    }
    // press 1: right L→M; press 2: right at notch M → middle B; press 15: right at notch Z → middle C
    expect(middles.join('')).toBe('A' + 'B'.repeat(13) + 'CC')

    // VIII in the middle double-steps at both M and Z
    const s2: MachineSettings = {
      ...s,
      middle: { rotor: 'VIII', ring: 0, position: L('L') },
      right: { rotor: 'I', ring: 0, position: L('P') },
    }
    let p2 = startPositions(s2)
    const seq: string[] = []
    for (let i = 0; i < 3; i++) {
      p2 = stepRotors(s2, p2).after
      seq.push(posString(p2))
    }
    expect(seq).toEqual(['ALQ', 'AMR', 'BNS'])
  })

  it('Greek wheel never steps', () => {
    const s = machine({
      model: 'M4',
      reflector: 'UKW-B-thin',
      rotors: ['Beta', 'I', 'II', 'III'],
      rings: [1, 1, 1, 1],
      key: 'CAAA',
      plugs: '',
    })
    const r = encryptText(s, randomText(rng(3), 2000), { nonLetters: 'remove' })
    for (const t of r.traces) {
      expect(t.stepping.before.greek).toBe(L('C'))
      expect(t.stepping.after.greek).toBe(L('C'))
    }
    expect(r.finalPositions.greek).toBe(L('C'))
  })

  it('has a period of 26·25·26 = 16,900 key presses (double-stepping skips states)', () => {
    // Middle rotor double-steps, so the cycle is 16,900 rather than 17,576.
    const s = DEFAULT_SETTINGS
    const start = posString(startPositions(s))
    let pos = startPositions(s)
    let n = 0
    do {
      pos = stepRotors(s, pos).after
      n++
    } while (posString(pos) !== start && n < 20000)
    expect(n).toBe(16900)
  })
})

describe('machine properties', () => {
  const models: ModelId[] = ['I', 'M3', 'M4']

  it('is reciprocal and never maps a letter to itself', () => {
    const rand = rng(42)
    for (let k = 0; k < 30; k++) {
      const s = randomSettings(models[k % 3], rand)
      const text = randomText(rand, 300)
      const c = encryptText(s, text, { nonLetters: 'remove' }).output
      expect(encryptText(s, c, { nonLetters: 'remove' }).output).toBe(text)
      expect(encryptLetters(s, text)).toBe(c)
      for (let i = 0; i < text.length; i++) expect(c[i]).not.toBe(text[i])
    }
  })

  it('M4 with thin B + Beta at A/A equals M3 with UKW-B; thin C + Gamma equals UKW-C', () => {
    const rand = rng(7)
    for (let k = 0; k < 20; k++) {
      const m3 = randomSettings('M3', rand)
      const thick = k % 2 === 0 ? 'UKW-B' : 'UKW-C'
      m3.reflector = thick
      const m4: MachineSettings = {
        ...m3,
        model: 'M4',
        reflector: thick === 'UKW-B' ? 'UKW-B-thin' : 'UKW-C-thin',
        greek: { rotor: thick === 'UKW-B' ? 'Beta' : 'Gamma', ring: 0, position: 0 },
      }
      const text = randomText(rand, 400)
      expect(encryptText(m4, text, { nonLetters: 'remove' }).output).toBe(
        encryptText(m3, text, { nonLetters: 'remove' }).output,
      )
    }
  })

  it('encrypts 5,000 characters with traces quickly', () => {
    const s = randomSettings('M4', rng(99))
    const text = randomText(rng(100), 5000)
    encryptText(s, text, { nonLetters: 'keep' }) // warm-up
    const t0 = performance.now()
    const r = encryptText(s, text, { nonLetters: 'keep' })
    const dt = performance.now() - t0
    expect(r.output).toHaveLength(5000)
    expect(dt).toBeLessThan(50)
  })
})

describe('trace', () => {
  it('pressKey steps first, then enciphers, and returns the trace', () => {
    const { trace, positions } = pressKey(DEFAULT_SETTINGS, startPositions(DEFAULT_SETTINGS), L('A'))
    expect(trace.index).toBe(0)
    expect(trace.input).toBe(L('A'))
    expect(toChar(trace.output)).toBe('B')
    expect(posString(positions)).toBe('AAB')
    expect(trace.stepping.after).toEqual(positions)
  })

  it('has the documented stage order and chaining invariant (3- and 4-rotor)', () => {
    const rand = rng(5)
    for (const model of ['I', 'M3', 'M4'] as ModelId[]) {
      const s = randomSettings(model, rand)
      const r = encryptText(s, randomText(rand, 200), { nonLetters: 'remove' })
      for (const t of r.traces) {
        const comps = t.stages.map((st) => `${st.component}:${st.direction}`)
        const rotorsFwd = model === 'M4' ? ['right', 'middle', 'left', 'greek'] : ['right', 'middle', 'left']
        expect(comps).toEqual([
          'keyboard:forward',
          'plugboard:forward',
          'entry:forward',
          ...rotorsFwd.map((c) => `${c}:forward`),
          'reflector:reflect',
          ...[...rotorsFwd].reverse().map((c) => `${c}:backward`),
          'entry:backward',
          'plugboard:backward',
          'lamp:backward',
        ])
        expect(t.stages[0].input).toBe(t.input)
        expect(t.stages[t.stages.length - 1].output).toBe(t.output)
        for (let i = 0; i + 1 < t.stages.length; i++) {
          expect(t.stages[i].output).toBe(t.stages[i + 1].input)
        }
        const pos = t.stepping.after
        for (const st of t.stages) {
          if (st.kind !== 'rotor') {
            expect(st.coreInput).toBeUndefined()
            continue
          }
          const slot = st.component as 'greek' | 'left' | 'middle' | 'right'
          const rs = slot === 'greek' ? s.greek! : s[slot]
          const p = slot === 'greek' ? pos.greek! : pos[slot]
          const offset = (((p - rs.ring) % 26) + 26) % 26
          expect(st.offset).toBe(offset)
          expect(st.coreInput).toBe((st.input + offset) % 26)
          expect(st.output).toBe((((st.coreOutput! - offset) % 26) + 26) % 26)
          const w = wiringTable(rs.rotor)
          const table = st.direction === 'forward' ? w.forward : w.backward
          expect(st.coreOutput).toBe(table[st.coreInput!])
        }
      }
    }
  })

  it('labels stages for the visualisation', () => {
    const s = machine({
      model: 'M4',
      reflector: 'UKW-C-thin',
      rotors: ['Gamma', 'V', 'VI', 'VIII'],
      rings: [1, 1, 1, 1],
      key: 'AAAA',
      plugs: 'AB',
    })
    const { trace } = pressKey(s, startPositions(s), L('A'))
    const labels = trace.stages.map((st) => st.label)
    expect(labels).toContain('Plugboard')
    expect(labels).toContain('Entry wheel (ETW)')
    expect(labels).toContain('Rotor VIII (right)')
    expect(labels).toContain('Rotor VI (middle)')
    expect(labels).toContain('Rotor V (left)')
    expect(labels).toContain('Greek wheel Gamma')
    expect(labels).toContain('Reflector UKW-C (thin)')
    expect(trace.stages[1].output).toBe(L('B'))
    expect(activeSlots(s)).toEqual(['greek', 'left', 'middle', 'right'])
    expect(activeSlots(DEFAULT_SETTINGS)).toEqual(['left', 'middle', 'right'])
  })
})

/*
 * Genuine historical messages. Settings, ciphertext and plaintext copied from:
 *  - Franklin Heath "Enigma/Sample Messages" and "Enigma/Sample Decrypts"
 *    https://wiki.franklinheath.co.uk/index.php/Enigma/Sample_Messages
 *    https://wiki.franklinheath.co.uk/index.php/Enigma/Sample_Decrypts
 *    (archived: https://web.archive.org/web/20231206014637/http://wiki.franklinheath.co.uk/index.php/Enigma/Sample_Decrypts)
 *  - Crypto Museum, Enigma M4 message P1030681 (Dönitz message, 1 May 1945)
 *    https://www.cryptomuseum.com/crypto/enigma/msg/p1030681.htm
 * Message keys are the rotor start positions for the message body.
 */
describe('historical messages', () => {
  it('Enigma instruction manual, 1930 (Enigma I, UKW-A, II I III, rings 24 13 22, key ABL)', () => {
    const s = machine({
      model: 'I',
      reflector: 'UKW-A',
      rotors: ['II', 'I', 'III'],
      rings: [24, 13, 22],
      key: 'ABL',
      plugs: 'AM FI NV PS TU WZ',
    })
    const cipher =
      'GCDSE AHUGW TQGRK VLFGX UCALX VYMIG MMNMF DXTGN VHVRM MEVOU YFZSL RHDRR XFJWC FHUHM UNZEF RDISI KBGPM YVXUZ'
    const plain =
      'FEIND LIQEI NFANT ERIEK OLONN EBEOB AQTET XANFA NGSUE DAUSG ANGBA ERWAL DEXEN DEDRE IKMOS TWAER TSNEU STADT'
    expect(encryptText(s, strip(cipher), { nonLetters: 'remove' }).output).toBe(strip(plain))
    expect(encryptText(s, strip(plain), { nonLetters: 'remove' }).output).toBe(strip(cipher))
  })

  it('Operation Barbarossa, 1941, part 1 (Enigma I, UKW-B, II IV V, rings 02 21 12, key BLA)', () => {
    const s = machine({
      model: 'I',
      reflector: 'UKW-B',
      rotors: ['II', 'IV', 'V'],
      rings: [2, 21, 12],
      key: 'BLA',
      plugs: 'AV BS CG DL FU HZ IN KM OW RX',
    })
    const cipher =
      'EDPUD NRGYS ZRCXN UYTPO MRMBO FKTBZ REZKM LXLVE FGUEY SIOZV EQMIK UBPMM YLKLT TDEIS MDICA GYKUA CTCDO MOHWX MUUIA UBSTS LRNBZ SZWNR FXWFY SSXJZ VIJHI DISHP RKLKA YUPAD TXQSP INQMA TLPIF SVKDA SCTAC DPBOP VHJK'
    const plain =
      'AUFKL XABTE ILUNG XVONX KURTI NOWAX KURTI NOWAX NORDW ESTLX SEBEZ XSEBE ZXUAF FLIEG ERSTR ASZER IQTUN GXDUB ROWKI XDUBR OWKIX OPOTS CHKAX OPOTS CHKAX UMXEI NSAQT DREIN ULLXU HRANG ETRET ENXAN GRIFF XINFX RGTX'
    expect(encryptText(s, strip(cipher), { nonLetters: 'remove' }).output).toBe(strip(plain))
  })

  it('Scharnhorst, 1943 (M3, UKW-B, III VI VIII, rings 01 08 13, key UZV)', () => {
    const s = machine({
      model: 'M3',
      reflector: 'UKW-B',
      rotors: ['III', 'VI', 'VIII'],
      rings: [1, 8, 13],
      key: 'UZV',
      plugs: 'AN EZ HK IJ LR MQ OT PV SW UX',
    })
    const cipher =
      'YKAE NZAP MSCH ZBFO CUVM RMDP YCOF HADZ IZME FXTH FLOL PZLF GGBO TGOX GRET DWTJ IQHL MXVJ WKZU ASTR'
    const plain =
      'STEUE REJTA NAFJO RDJAN STAND ORTQU AAACC CVIER NEUNN EUNZW OFAHR TZWON ULSMX XSCHA RNHOR STHCO'
    expect(encryptText(s, strip(cipher), { nonLetters: 'remove' }).output).toBe(strip(plain))
  })

  it('U-264, 1942 (M4, thin B, Beta II IV I, rings 01 01 01 22, key VJNA)', () => {
    const s = machine({
      model: 'M4',
      reflector: 'UKW-B-thin',
      rotors: ['Beta', 'II', 'IV', 'I'],
      rings: [1, 1, 1, 22],
      key: 'VJNA',
      plugs: 'AT BL DF GJ HM NW OP QY RZ VX',
    })
    const cipher =
      'NCZW VUSX PNYM INHZ XMQX SFWX WLKJ AHSH NMCO CCAK UQPM KCSM HKSE INJU SBLK IOSX CKUB HMLL XCSJ USRR DVKO HULX WCCB GVLI YXEO AHXR HKKF VDRE WEZL XOBA FGYU JQUK GRTV UKAM EURB VEKS UHHV OYHA BCJW MAKL FKLM YFVN RIZR VVRT KOFD ANJM OLBG FFLE OPRG TFLV RHOW OPBE KVWM UQFM PWPA RMFH AGKX IIBG'
    const plain =
      'VONV ONJL OOKS JHFF TTTE INSE INSD REIZ WOYY QNNS NEUN INHA LTXX BEIA NGRI FFUN TERW ASSE RGED RUEC KTYW ABOS XLET ZTER GEGN ERST ANDN ULAC HTDR EINU LUHR MARQ UANT ONJO TANE UNAC HTSE YHSD REIY ZWOZ WONU LGRA DYAC HTSM YSTO SSEN ACHX EKNS VIER MBFA ELLT YNNN NNNO OOVI ERYS ICHT EINS NULL'
    expect(encryptText(s, strip(cipher), { nonLetters: 'remove' }).output).toBe(strip(plain))
  })

  it('Dönitz message P1030681, 1 May 1945 (M4, thin C, Beta V VI VIII, rings EPEL, key CDSZ)', () => {
    const s = machine({
      model: 'M4',
      reflector: 'UKW-C-thin',
      rotors: ['Beta', 'V', 'VI', 'VIII'],
      rings: [5, 16, 5, 12], // E P E L
      key: 'CDSZ',
      plugs: 'AE BF CM DQ HU JN LX PR SZ VW',
    })
    // Message indicator groups DUHF TETO (start and end) omitted, as instructed by the source.
    const cipher =
      'LANO TCTO UARB BFPM HPHG CZXT DYGA HGUF XGEW KBLK GJWL QXXT ' +
      'GPJJ AVTO CKZF SLPP QIHZ FXOE BWII EKFZ LCLO AQJU LJOY HSSM BBGW HZAN ' +
      'VOII PYRB RTDJ QDJJ OQKC XWDN BBTY VXLY TAPG VEAT XSON PNYN QFUD BBHH ' +
      'VWEP YEYD OHNL XKZD NWRH DUWU JUMW WVII WZXI VIUQ DRHY MNCY EFUA PNHO ' +
      'TKHK GDNP SAKN UAGH JZSM JBMH VTRE QEDG XHLZ WIFU SKDQ VELN MIMI THBH ' +
      'DBWV HDFY HJOQ IHOR TDJD BWXE MEAY XGYQ XOHF DMYU XXNO JAZR SGHP LWML ' +
      'RECW WUTL RTTV LBHY OORG LGOW UXNX HMHY FAAC QEKT HSJW'
    const plain =
      'KRKRALLEXXFOLGENDESISTSOFORTBEKANNTZUGEBENXXICHHABEFOLGELNBEBEFEHLERH' +
      'ALTENXXJANSTERLEDESBISHERIGXNREICHSMARSCHALLSJGOERINGJSETZTDERFUEHRER' +
      'SIEYHVRRGRZSSADMIRALYALSSEINENNACHFOLGEREINXSCHRIFTLSCHEVOLLMACHTUNTE' +
      'RWEGSXABSOFORTSOLLENSIESAEMTLICHEMASSNAHMENVERFUEGENYDIESICHAUSDERGEG' +
      'ENWAERTIGENLAGEERGEBENXGEZXREICHSLEITEIKKTULPEKKJBORMANNJXXOBXDXMMMDU' +
      'RNHFKSTXKOMXADMXUUUBOOIEXKP'
    expect(encryptText(s, strip(cipher), { nonLetters: 'remove' }).output).toBe(plain)
  })

  it('Dönitz message indicator: QEOB at Grundstellung NAEM gives message key CDSZ', () => {
    // Same source: "Entering QEOB at the basic setting (Grundstellung) NEAM, reveals the message key: CDSZ"
    // (the settings table on the page lists the Grundstellung as NAEM).
    const s = machine({
      model: 'M4',
      reflector: 'UKW-C-thin',
      rotors: ['Beta', 'V', 'VI', 'VIII'],
      rings: [5, 16, 5, 12],
      key: 'NAEM',
      plugs: 'AE BF CM DQ HU JN LX PR SZ VW',
    })
    expect(encryptText(s, 'QEOB', { nonLetters: 'remove' }).output).toBe('CDSZ')
  })
})

describe('rotor ids', () => {
  it('all eight rotors and both Greek wheels are defined', () => {
    const ids: RotorId[] = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']
    for (const id of ids) expect(ROTORS[id].kind).toBe('rotor')
    expect(ROTORS.Beta.kind).toBe('greek')
    expect(ROTORS.Gamma.kind).toBe('greek')
  })
})
