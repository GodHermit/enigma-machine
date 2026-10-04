import { describe, expect, it } from 'vitest'
import { encryptText } from '../enigma/machine'
import { parsePlugboard } from '../enigma/plugboard'
import type { MachineSettings } from '../enigma/types'
import { PASSAGES } from './data/passages'
import { ngramLog10 } from './ngrams'
import { mulberry32 } from './random'
import { decipherCodes, keyFromSettings, plugMap } from './scrambler'
import { createContext, runWordsSearch } from './search'
import type { CoreCandidate } from './search'
import { testDictionary, testNgrams } from './test-data'
import { fromCodes, lettersOnly, toCodes } from './text'
import type { BreakerConfig } from './types'
import { maxEdits, parseDictionary, scoreWords } from './words'

const de = () => testDictionary('de')
const en = () => testDictionary('en')

function randomLetters(seed: number, n: number): string {
  const rand = mulberry32(seed)
  return Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(rand() * 26))).join('')
}

describe('dictionary', () => {
  it('parses word lists (uppercase A–Z, deduplicated, Q-for-CH variants in German)', () => {
    const d = parseDictionary('Haus\nhaus\nnacht x a-b\n', 'de')
    expect(d.words).toEqual(expect.arrayContaining(['HAUS', 'NACHT', 'NAQT', 'AB']))
    expect(d.size).toBe(4)
    expect(parseDictionary('night', 'en').words).toEqual(['NIGHT'])
    expect(de().size).toBeGreaterThan(15000)
    expect(en().size).toBeGreaterThan(10000)
  })

  it('allows edits in proportion to the word length', () => {
    expect([3, 4, 5, 9, 10, 14, 15, 30].map((l) => maxEdits(l, 0.2))).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
    expect(maxEdits(4, 0.25)).toBe(1)
    expect(maxEdits(12, 0)).toBe(0)
    expect(maxEdits(9, 0.34)).toBe(3)
  })
})

describe('scoreWords', () => {
  it('segments German and English sentences', () => {
    const g = scoreWords('DASWETTERISTHEUTESCHOENUNDDIESONNESCHEINT', de())
    expect(g.segmented).toBe('DAS WETTER IST HEUTE SCHOEN UND DIE SONNE SCHEINT')
    expect(g.coverage).toBe(1)
    expect(g.matched).toBe(9)
    expect(g.typos).toBe(0)
    const e = scoreWords('ITWASTHEBESTOFTIMESITWASTHEWORSTOFTIMES', en())
    expect(e.segmented).toBe('IT WAS THE BEST OF TIMES IT WAS THE WORST OF TIMES')
    expect(e.coverage).toBe(1)
  })

  it('knows Enigma vocabulary and conventions (X separator, Q for CH)', () => {
    const m = scoreWords('OBERKOMMANDODERWEHRMACHTXKEINEBESONDERENEREIGNISSEXWETTERBERICHTFOLGT', de())
    expect(m.coverage).toBe(1)
    expect(m.segmented).toBe('OBERKOMMANDO DER WEHRMACHT X KEINE BESONDEREN EREIGNISSE X WETTERBERICHT FOLGT')
    expect(scoreWords('ANGRIFFXDREIXUBOOTEXNAQTS', de()).coverage).toBe(1)
    // A lone X between non-words does not count.
    expect(scoreWords('QZJXQZJ', de()).coverage).toBe(0)
  })

  it('tolerates typos in long words, but not in short ones', () => {
    const text = 'ERWARWAHRSCHEIMLICHNICHTZUHAUSE'
    const exact = scoreWords(text, de(), 0)
    const fuzzy = scoreWords(text, de(), 0.2)
    expect(exact.coverage).toBeLessThan(fuzzy.coverage)
    expect(fuzzy.coverage).toBe(1)
    expect(fuzzy.typos).toBe(1)
    expect(fuzzy.segmented).toContain('WAHRSCHEIMLICH')
    // Insertion and deletion.
    expect(scoreWords('ERWARWAHRSCHEINNLICHNICHTZUHAUSE', de()).typos).toBe(1)
    expect(scoreWords('ERWARWAHRSCHEINLIHNICHTZUHAUSE', de()).typos).toBe(1)
    // 4-letter words (HAUS) never match with a typo at the default tolerance.
    expect(scoreWords('DASHQUSISTGROSS', de()).segmented).not.toContain(' HQUS ')
  })

  it('gives random letters a low coverage and real text a high one', () => {
    for (let seed = 1; seed <= 10; seed++) {
      expect(scoreWords(randomLetters(seed, 300), de()).coverage).toBeLessThan(0.25)
      expect(scoreWords(randomLetters(seed + 100, 300), en()).coverage).toBeLessThan(0.25)
    }
    for (const lang of ['de', 'en'] as const) {
      const d = testDictionary(lang)
      for (const p of PASSAGES[lang]) expect(scoreWords(lettersOnly(p.text).slice(0, 300), d).coverage).toBeGreaterThan(0.85)
    }
  })

  it('handles edge cases', () => {
    expect(scoreWords('', de())).toEqual({ coverage: 0, exactCoverage: 0, segmented: '', matched: 0, typos: 0 })
    expect(scoreWords('der hund, die katze', de()).segmented).toBe('DER HUND DIE KATZE')
  })

  it('scores a 500-letter text in well under 50 ms', () => {
    const text = PASSAGES.de.map((p) => lettersOnly(p.text)).join('').slice(0, 500)
    const broken = text.replace(/E/g, 'Q')
    scoreWords(broken, de())
    // Fastest of three batches, so a busy machine (parallel test files) does not fail it.
    let fastest = Infinity
    for (let batch = 0; batch < 3; batch++) {
      const start = performance.now()
      for (let i = 0; i < 10; i++) {
        scoreWords(text, de())
        scoreWords(broken, de())
        scoreWords(randomLetters(i, 500), de())
      }
      fastest = Math.min(fastest, (performance.now() - start) / 30)
    }
    expect(fastest).toBeLessThan(25)
  })
})

describe('phase 4', () => {
  const plain = PASSAGES.de.map((p) => lettersOnly(p.text)).join('').slice(6000, 6280)
  const settings: MachineSettings = {
    model: 'I',
    reflector: 'UKW-B',
    greek: null,
    left: { rotor: 'IV', ring: 3, position: 11 },
    middle: { rotor: 'I', ring: 17, position: 2 },
    right: { rotor: 'III', ring: 8, position: 20 },
    plugboard: parsePlugboard('AQ BW CE DR FT GZ HU JI KO LP').pairs,
  }
  const cipher = encryptText(settings, plain, { nonLetters: 'remove' }).output
  const config: BreakerConfig = {
    ciphertext: cipher,
    model: 'I',
    rotors: ['I', 'II', 'III', 'IV', 'V'],
    reflectors: ['UKW-B'],
    greekRotors: [],
    ringSearch: 'right-middle',
    maxPlugs: 10,
    language: 'de',
    crib: null,
    workers: 1,
  }
  const ctx = createContext(config, testNgrams('de'), {}, de())
  const key = keyFromSettings(settings)

  function candidate(plugs: string): CoreCandidate {
    const P = plugMap(parsePlugboard(plugs).pairs)
    const text = fromCodes(decipherCodes(key, P, toCodes(cipher)))
    return { key, plugs: Array.from(P), score: ngramLog10(testNgrams('de'), toCodes(text), 4), ioc: 0, phase: 'plugboard', plaintext: text }
  }

  it('ranks the correct key above a near miss with one wrong plug pair', () => {
    const right = runWordsSearch(ctx, candidate('AQ BW CE DR FT GZ HU JI KO LP'), false).result
    // E and N swapped by a wrong cable pairing.
    const near = runWordsSearch(ctx, candidate('AQ BW CN DR FT GZ HU JI KO LP'), false).result
    expect(right.plaintext).toBe(plain)
    expect(right.words?.coverage).toBeGreaterThan(0.9)
    expect(near.words!.coverage).toBeLessThan(right.words!.coverage)
    expect(near.score).toBeLessThan(right.score)
    expect(right.phase).toBe('plugboard')
  })

  it('repairs a near miss with the dictionary-guided polish', () => {
    const near = candidate('AQ BW CN DR FT GZ HU JI KO LP')
    const { result, keys } = runWordsSearch(ctx, near, true)
    expect(keys).toBeGreaterThan(100)
    expect(result.plaintext).toBe(plain)
    expect(result.phase).toBe('words')
    expect(result.words?.coverage).toBeGreaterThan(0.9)
  })
})
