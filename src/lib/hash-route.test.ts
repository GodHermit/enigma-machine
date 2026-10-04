import { afterEach, describe, expect, it } from 'vitest'
import { buildHash, navigate, parseHash } from './hash-route'

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('hash routes', () => {
  it('parses routes, parameters and legacy share links', () => {
    expect(parseHash('').route).toBe('simulator')
    expect(parseHash('#').route).toBe('simulator')
    expect(parseHash('#/').route).toBe('simulator')
    expect(parseHash('#/breaker').route).toBe('breaker')
    expect(parseHash('#/breaker/').route).toBe('breaker')
    expect(parseHash('#/nope').route).toBe('simulator')
    const sim = parseHash('#/simulator?key=I.UKW-B.I-II-III.AAA.AAA.&x=1')
    expect(sim.route).toBe('simulator')
    expect(sim.params.get('key')).toBe('I.UKW-B.I-II-III.AAA.AAA.')
    expect(sim.params.get('x')).toBe('1')
    const legacy = parseHash('#key=I.UKW-B.I-II-III.AAA.AAA.')
    expect(legacy.route).toBe('simulator')
    expect(legacy.params.get('key')).toBe('I.UKW-B.I-II-III.AAA.AAA.')
  })

  it('builds hashes', () => {
    expect(buildHash('breaker')).toBe('#/breaker')
    expect(buildHash('simulator', new URLSearchParams('key=ABC'))).toBe('#/simulator?key=ABC')
  })

  it('keeps parameters on the same route and drops them when switching', () => {
    window.location.hash = '#/simulator?key=ABC'
    navigate('simulator')
    expect(window.location.hash).toBe('#/simulator?key=ABC')
    navigate('breaker')
    expect(window.location.hash).toBe('#/breaker')
  })
})
