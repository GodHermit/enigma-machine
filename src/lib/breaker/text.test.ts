import { describe, expect, it } from 'vitest'
import { PASSAGES } from './data/passages'
import { ngramLog10, ngramSum, parseNgrams } from './ngrams'
import { mulberry32 } from './random'
import { testNgrams, readNgramFile } from './test-data'
import { fromCodes, indexOfCoincidence, letterAgreement, lettersOnly, toCodes, transliterate } from './text'

describe('lettersOnly / codes', () => {
  it('keeps A–Z only, uppercased', () => {
    expect(lettersOnly('Hello, World! 123 äß')).toBe('HELLOWORLD')
    expect(fromCodes(toCodes('ab-Z'))).toBe('ABZ')
  })

  it('transliterates German umlauts and strips accents', () => {
    expect(lettersOnly(transliterate('Grüße aus Köln, Ärger, café'))).toBe('GRUESSEAUSKOELNAERGERCAFE')
  })
})

describe('indexOfCoincidence', () => {
  it('matches hand-computed values', () => {
    expect(indexOfCoincidence('AAAA')).toBe(1)
    expect(indexOfCoincidence('ABCD')).toBe(0)
    // AABB: pairs (n=4): 2 coincident pairs out of 6.
    expect(indexOfCoincidence('AABB')).toBeCloseTo(2 / 6)
    expect(indexOfCoincidence('A')).toBe(0)
    expect(indexOfCoincidence(toCodes('AABB'))).toBeCloseTo(2 / 6)
  })

  it('separates language from random letters', () => {
    const rand = mulberry32(7)
    const random = Array.from({ length: 2000 }, () => String.fromCharCode(65 + Math.floor(rand() * 26))).join('')
    const german = PASSAGES.de.map((p) => lettersOnly(p.text)).join('')
    const english = PASSAGES.en.map((p) => lettersOnly(p.text)).join('')
    expect(indexOfCoincidence(random)).toBeGreaterThan(0.035)
    expect(indexOfCoincidence(random)).toBeLessThan(0.042)
    expect(indexOfCoincidence(german)).toBeGreaterThan(0.07)
    expect(indexOfCoincidence(english)).toBeGreaterThan(0.06)
  })

  it('letterAgreement compares position by position', () => {
    expect(letterAgreement('ABCD', 'ABXD')).toBe(0.75)
    expect(letterAgreement('', 'A')).toBe(0)
  })
})

describe('n-gram statistics', () => {
  it('parses the bundled tables', () => {
    for (const lang of ['de', 'en'] as const) {
      const m = testNgrams(lang)
      expect(m.bi).toHaveLength(676)
      expect(m.tri).toHaveLength(17576)
      expect(m.quad).toHaveLength(456976)
      expect(m.floor[2]).toBeLessThan(-7)
      expect(m.step[2]).toBeGreaterThan(0)
    }
  })

  it('rejects malformed data', () => {
    expect(() => parseNgrams(new Uint8Array(10), 'de')).toThrow(/bytes/)
    const bad = readNgramFile('de').slice()
    bad[0] = 0
    expect(() => parseNgrams(bad, 'de')).toThrow(/format/)
  })

  it('scores real language above random letters and recognises the language', () => {
    const de = testNgrams('de')
    const en = testNgrams('en')
    const rand = mulberry32(11)
    const random = Uint8Array.from({ length: 300 }, () => Math.floor(rand() * 26))
    const german = toCodes(PASSAGES.de[0].text).slice(0, 300)
    const english = toCodes(PASSAGES.en[0].text).slice(0, 300)
    for (const order of [2, 3, 4] as const) {
      expect(ngramLog10(de, german, order)).toBeGreaterThan(ngramLog10(de, random, order) + 0.5)
      expect(ngramLog10(en, english, order)).toBeGreaterThan(ngramLog10(en, random, order) + 0.5)
    }
    expect(ngramLog10(de, german, 4)).toBeGreaterThan(ngramLog10(en, german, 4))
    expect(ngramLog10(en, english, 4)).toBeGreaterThan(ngramLog10(de, english, 4))
    // Typical quadgram log10 probability of prose.
    expect(ngramLog10(de, german, 4)).toBeGreaterThan(-5)
    expect(ngramSum(de, toCodes('ABC'), 4)).toBe(0)
  })
})
