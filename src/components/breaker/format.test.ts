import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  confidenceOf,
  formatCountLong,
  formatCountShort,
  formatDuration,
  formatPercent,
  groupInFives,
  letterAgreement,
  readable,
  viewPlaintext,
} from './format'
import { defaultForm, formToConfig, sanitizeForm, validateForm, withModel } from './form-state'

vi.mock('../../lib/breaker', async () => (await import('./test-fakes')).fakeBreakerModule)

beforeAll(() => {
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8, configurable: true })
})

describe('format', () => {
  it('formats counts', () => {
    expect(formatCountLong(63_200_000)).toBe('63.2 million')
    expect(formatCountLong(950)).toBe('950')
    expect(formatCountLong(1.6e12)).toBe('1.6 trillion')
    expect(formatCountShort(12_400_000)).toBe('12.4 M')
    expect(formatCountShort(250_000)).toBe('250 k')
    expect(formatCountShort(2_000_000_000)).toBe('2 B')
  })

  it('formats durations', () => {
    expect(formatDuration(0.2)).toBe('< 1 s')
    expect(formatDuration(25)).toBe('25 s')
    expect(formatDuration(250)).toBe('4 min 10 s')
    expect(formatDuration(1500)).toBe('25 min')
    expect(formatDuration(4800)).toBe('1 h 20 min')
    expect(formatDuration(2 * 86400 + 3 * 3600)).toBe('2 d 3 h')
  })

  it('formats plaintext views and rates candidates', () => {
    expect(groupInFives('ABCDEFGHIJKL')).toBe('ABCDE FGHIJ KL')
    expect(groupInFives('ABCDE')).toBe('ABCDE')
    expect(readable('XANXXDERXFRONTX')).toBe('AN DER FRONT')
    expect(confidenceOf(0.07)).toBe('language')
    expect(confidenceOf(0.055)).toBe('partial')
    expect(confidenceOf(0.04)).toBe('wrong')
    expect(letterAgreement('ABCD', 'ABXD')).toBe(0.75)
    expect(letterAgreement('', '')).toBe(0)
  })
})

describe('form state', () => {
  it('builds the engine config from the form', () => {
    const form = { ...defaultForm('M4'), ciphertext: 'abc def', cribText: 'u-boot', cribPosition: '' }
    expect(formToConfig(form)).toMatchObject({
      model: 'M4',
      reflectors: ['UKW-B-thin'],
      greekRotors: ['Beta', 'Gamma'],
      crib: { text: 'UBOOT', position: null },
      workers: 7,
    })
    expect(formToConfig(withModel(form, 'I')).greekRotors).toEqual([])
  })

  it('sanitizes stored data', () => {
    const form = sanitizeForm({
      model: 'M3',
      rotors: ['II', 'IX', 'I'],
      reflectors: ['UKW-A'],
      maxPlugs: 40,
      workers: 99,
      language: 'fr',
    })
    expect(form.model).toBe('M3')
    expect(form.rotors).toEqual(['I', 'II'])
    expect(form.reflectors).toEqual([])
    expect(form.maxPlugs).toBe(13)
    // 8 threads → at most 7 workers: one is always kept free.
    expect(form.workers).toBe(7)
    expect(form.language).toBe('de')
    expect(sanitizeForm('nonsense')).toEqual(defaultForm())
  })

  it('validates crib positions', () => {
    const base = { ...defaultForm(), ciphertext: 'QWERTYUIOPASDFGHJKLZXCVBNMQWERTY' }
    expect(validateForm(base)).toEqual({})
    expect(validateForm({ ...base, cribText: 'ABC', cribPosition: '40' }).crib).toMatch(/1 to 30/)
    expect(validateForm({ ...base, cribText: 'QA', cribPosition: '1' }).crib).toMatch(/itself/)
    expect(validateForm({ ...base, cribText: 'AQ', cribPosition: '1' }).crib).toBeUndefined()
  })
})

describe('dictionary-aware formatting', () => {
  it('shows the dictionary segmentation in the readable view, without X separators', () => {
    expect(viewPlaintext('KEINEXBESONDERENEREIGNISSE', 'readable', 'KEINE X BESONDEREN EREIGNISSE')).toBe(
      'KEINE BESONDEREN EREIGNISSE',
    )
    // Without a segmentation it falls back to the X → space heuristic.
    expect(viewPlaintext('KEINEXBESONDEREN', 'readable')).toBe('KEINE BESONDEREN')
    expect(viewPlaintext('KEINEXBESONDEREN', 'fives', 'KEINE X BESONDEREN')).toBe('KEINE XBESO NDERE N')
  })

  it('judges confidence by word coverage when there is one', () => {
    expect(confidenceOf(0.03, 0.95)).toBe('language')
    expect(confidenceOf(0.08, 0.5)).toBe('partial')
    expect(confidenceOf(0.08, 0.2)).toBe('wrong')
    expect(confidenceOf(0.07)).toBe('language')
    expect(formatPercent(0.876)).toBe('88%')
  })
})
