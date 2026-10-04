import { describe, expect, it } from 'vitest'
import { MAX_PLUGS } from './constants'
import { toLetter } from './letters'
import { formatPlugboard, parsePlugboard, partnerOf, plugboardMap, togglePlug, unplug } from './plugboard'
import type { PlugPair } from './types'

const L = (s: string): number => toLetter(s) as number
const P = (s: string): PlugPair => [L(s[0]), L(s[1])]

describe('parsePlugboard', () => {
  it('accepts spaces, hyphens, commas and lower case', () => {
    const expected = [P('AB'), P('CD')]
    expect(parsePlugboard('AB CD')).toEqual({ pairs: expected, errors: [] })
    expect(parsePlugboard('ab-cd')).toEqual({ pairs: expected, errors: [] })
    expect(parsePlugboard('AB,CD')).toEqual({ pairs: expected, errors: [] })
    expect(parsePlugboard('  AB ;  cd  ')).toEqual({ pairs: expected, errors: [] })
    expect(parsePlugboard('ABCD')).toEqual({ pairs: expected, errors: [] })
  })

  it('returns no pairs for empty input', () => {
    expect(parsePlugboard('')).toEqual({ pairs: [], errors: [] })
    expect(parsePlugboard('   ')).toEqual({ pairs: [], errors: [] })
  })

  it('reports invalid tokens and keeps the valid pairs', () => {
    const r = parsePlugboard('AB C1 DEF GG AH IJ')
    expect(r.pairs).toEqual([P('AB'), P('IJ')])
    expect(r.errors).toHaveLength(4)
    expect(r.errors.join(' ')).toMatch(/C1/)
    expect(r.errors.join(' ')).toMatch(/DEF/)
    expect(r.errors.join(' ')).toMatch(/itself/)
    expect(r.errors.join(' ')).toMatch(/A is already plugged/)
  })

  it('accepts all 13 cables (every letter plugged)', () => {
    const r = parsePlugboard('AB CD EF GH IJ KL MN OP QR ST UV WX YZ')
    expect(r.pairs).toHaveLength(MAX_PLUGS)
    expect(r.errors).toEqual([])
    const extra = parsePlugboard('AB CD EF GH IJ KL MN OP QR ST UV WX YZ AZ')
    expect(extra.pairs).toHaveLength(MAX_PLUGS)
    expect(extra.errors).toHaveLength(1)
  })
})

describe('formatPlugboard', () => {
  it('formats pairs separated by spaces and round-trips', () => {
    const pairs = [P('AV'), P('BS'), P('CG')]
    expect(formatPlugboard(pairs)).toBe('AV BS CG')
    expect(parsePlugboard(formatPlugboard(pairs)).pairs).toEqual(pairs)
    expect(formatPlugboard([])).toBe('')
  })
})

describe('plugboardMap', () => {
  it('is an involution swapping plugged letters', () => {
    const map = plugboardMap(parsePlugboard('AV BS CG DL FU HZ IN KM OW RX').pairs)
    expect(map).toHaveLength(26)
    for (let i = 0; i < 26; i++) expect(map[map[i]]).toBe(i)
    expect(map[L('A')]).toBe(L('V'))
    expect(map[L('V')]).toBe(L('A'))
    expect(map[L('E')]).toBe(L('E'))
  })

  it('ignores conflicting pairs so the result stays an involution', () => {
    const map = plugboardMap([P('AB'), P('AC'), P('DD')])
    expect(map[L('A')]).toBe(L('B'))
    expect(map[L('C')]).toBe(L('C'))
    expect(map[L('D')]).toBe(L('D'))
    for (let i = 0; i < 26; i++) expect(map[map[i]]).toBe(i)
  })
})

describe('partnerOf / unplug / togglePlug', () => {
  const pairs = [P('AB'), P('CD')]

  it('finds partners', () => {
    expect(partnerOf(pairs, L('A'))).toBe(L('B'))
    expect(partnerOf(pairs, L('D'))).toBe(L('C'))
    expect(partnerOf(pairs, L('Z'))).toBeNull()
  })

  it('unplugs a letter', () => {
    expect(unplug(pairs, L('B'))).toEqual([P('CD')])
    expect(unplug(pairs, L('Z'))).toEqual(pairs)
  })

  it('connects, disconnects and re-plugs', () => {
    expect(togglePlug(pairs, L('E'), L('F'))).toEqual([P('AB'), P('CD'), P('EF')])
    expect(togglePlug(pairs, L('A'), L('B'))).toEqual([P('CD')])
    expect(togglePlug(pairs, L('B'), L('A'))).toEqual([P('CD')])
    expect(togglePlug(pairs, L('A'), L('C'))).toEqual([P('AC')])
    expect(togglePlug(pairs, L('A'), L('A'))).toEqual([P('CD')])
    // does not mutate input
    expect(pairs).toEqual([P('AB'), P('CD')])
  })

  it('re-plugging on a full board moves the cables', () => {
    const full = parsePlugboard('AB CD EF GH IJ KL MN OP QR ST UV WX YZ').pairs
    const next = togglePlug(full, L('A'), L('C'))
    expect(next).toHaveLength(MAX_PLUGS - 1)
    expect(partnerOf(next, L('A'))).toBe(L('C'))
    expect(partnerOf(next, L('B'))).toBeNull()
    expect(partnerOf(next, L('D'))).toBeNull()
  })
})
