import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  decodeSettings,
  defaultSettings,
  encodeSettings,
  encryptLetters,
  positionsAfter,
  toLetter,
  validateSettings,
} from '../lib/enigma'
import type { Letter, MachineSettings } from '../lib/enigma'
import { useActiveTrace, useCurrentPositions, useEnigmaResult, useValidation } from './derived'
import {
  STORAGE_KEY,
  deserializeState,
  initPersistence,
  loadPersisted,
  readHashSettings,
  sanitizeOptions,
  savePersisted,
  serializeState,
  shareUrl,
} from './persistence'
import {
  selectActiveTrace,
  selectActiveTraceIndex,
  selectCurrentPositions,
  selectResult,
  selectStageCount,
  selectValidation,
} from './selectors'
import { DEFAULT_OPTIONS, SPEED_MAX, SPEED_MIN, initialData, useEnigmaStore } from './store'
import { usePlayback } from './usePlayback'

const L = (ch: string): Letter => {
  const l = toLetter(ch)
  if (l === null) throw new Error(`not a letter: ${ch}`)
  return l
}

const st = () => useEnigmaStore.getState()

function resetStore() {
  useEnigmaStore.setState(initialData())
}

function pressAll(text: string) {
  for (const ch of text) st().pressKey(L(ch))
}

beforeEach(() => {
  resetStore()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('initial state', () => {
  it('starts with the Enigma I defaults and empty input', () => {
    const s = st()
    expect(s.settings).toEqual(defaultSettings('I'))
    expect(s.input).toBe('')
    expect(s.options).toEqual(DEFAULT_OPTIONS)
    expect(s.selectedTrace).toBeNull()
    expect(s.stageCursor).toBeNull()
    expect(s.playing).toBe(false)
    expect(s.pressId).toBe(0)
  })
})

describe('key presses and text', () => {
  it('pressKey appends letters, bumps pressId and enciphers AAAAA → BDZGO', () => {
    pressAll('AAAAA')
    expect(st().input).toBe('AAAAA')
    expect(st().pressId).toBe(5)
    expect(selectResult(st()).output).toBe('BDZGO')
    expect(selectCurrentPositions(st())).toEqual({ greek: null, left: 0, middle: 0, right: 5 })
  })

  it('pressKey restarts playback when animate is on, shows everything when off', () => {
    st().selectTrace(0)
    st().pressKey(L('A'))
    expect(st().selectedTrace).toBeNull()
    expect(st().stageCursor).toBe(0)
    expect(st().playing).toBe(true)

    st().setOption('animate', false)
    expect(st().playing).toBe(false)
    expect(st().stageCursor).toBeNull()
    st().pressKey(L('B'))
    expect(st().stageCursor).toBeNull()
    expect(st().playing).toBe(false)
  })

  it('typeText appends raw text and setInput replaces it', () => {
    st().typeText('Hello, ')
    st().typeText('World')
    expect(st().input).toBe('Hello, World')
    st().setInput('abc')
    expect(st().input).toBe('abc')
    expect(selectResult(st()).traces).toHaveLength(3)
  })

  it('respects the nonLetters option', () => {
    st().setInput('AA AAA')
    expect(selectResult(st()).output).toBe('BD ZGO')
    st().setOption('nonLetters', 'remove')
    expect(selectResult(st()).output).toBe('BDZGO')
  })

  it('backspace undoes the last key and restores the rotor positions', () => {
    pressAll('HELLO')
    const before = selectCurrentPositions(st())
    const outBefore = selectResult(st()).output
    st().pressKey(L('X'))
    expect(selectCurrentPositions(st())).not.toEqual(before)
    st().backspace()
    expect(st().input).toBe('HELLO')
    expect(selectCurrentPositions(st())).toEqual(before)
    expect(selectResult(st()).output).toBe(outBefore)
    expect(st().playing).toBe(false)
  })

  it('backspace on empty input is a no-op', () => {
    const prev = st()
    st().backspace()
    expect(st()).toBe(prev)
  })

  it('backspace across the double step restores ADU-based positions exactly', () => {
    st().setPosition('left', 0)
    st().setPosition('middle', L('D'))
    st().setPosition('right', L('U'))
    pressAll('AAA')
    expect(selectCurrentPositions(st())).toEqual({ greek: null, left: 1, middle: 5, right: L('X') })
    st().backspace()
    expect(selectCurrentPositions(st())).toEqual({ greek: null, left: 0, middle: 4, right: L('W') })
    st().backspace()
    st().backspace()
    expect(selectCurrentPositions(st())).toEqual({ greek: null, left: 0, middle: 3, right: L('U') })
  })

  it('clearInput returns the rotors to their start positions', () => {
    st().setPosition('right', 7)
    pressAll('QWERTY')
    st().selectTrace(2)
    st().clearInput()
    expect(st().input).toBe('')
    expect(st().selectedTrace).toBeNull()
    expect(selectCurrentPositions(st())).toEqual({ greek: null, left: 0, middle: 0, right: 7 })
  })

  it('adoptCurrentPositions makes the current positions the new start and clears input', () => {
    st().setPosition('middle', L('D'))
    st().setPosition('right', L('U'))
    pressAll('ABCDEFGHIJ')
    const settingsBefore = st().settings
    const current = selectCurrentPositions(st())
    st().adoptCurrentPositions()
    expect(st().input).toBe('')
    const s = st().settings
    expect(s.left.position).toBe(current.left)
    expect(s.middle.position).toBe(current.middle)
    expect(s.right.position).toBe(current.right)
    expect(selectCurrentPositions(st())).toEqual(current)

    // Continuing from the adopted positions equals one long uninterrupted message.
    pressAll('KLMNO')
    const continued = selectResult(st()).output
    expect(continued).toBe(encryptLetters(settingsBefore, 'ABCDEFGHIJKLMNO').slice(10))
  })

  it('adoptCurrentPositions keeps the (non-stepping) Greek wheel position on the M4', () => {
    st().setModel('M4')
    st().setPosition('greek', 5)
    pressAll('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    const expected = positionsAfter(st().settings, 30)
    st().adoptCurrentPositions()
    expect(st().settings.greek?.position).toBe(5)
    expect(st().settings.right.position).toBe(expected.right)
    expect(st().settings.middle.position).toBe(expected.middle)
  })
})

describe('settings actions', () => {
  it('setRotor swaps when the rotor is already used in another slot', () => {
    st().setRing('left', 3)
    st().setRing('right', 9)
    st().setRotor('right', 'I')
    const s = st().settings
    expect(s.right.rotor).toBe('I')
    expect(s.left.rotor).toBe('III')
    expect(s.middle.rotor).toBe('II')
    // Rings / positions stay with the slots.
    expect(s.left.ring).toBe(3)
    expect(s.right.ring).toBe(9)
    expect(validateSettings(s)).toEqual([])
  })

  it('setRotor replaces with an unused rotor without touching other slots', () => {
    st().setRotor('middle', 'V')
    expect([st().settings.left.rotor, st().settings.middle.rotor, st().settings.right.rotor]).toEqual([
      'I',
      'V',
      'III',
    ])
  })

  it('setRotor ignores Greek wheels in normal slots, normal rotors in the Greek slot and greek on non-M4', () => {
    const before = st().settings
    st().setRotor('left', 'Beta')
    st().setRotor('greek', 'Gamma')
    expect(st().settings).toBe(before)
    st().setModel('M4')
    st().setRotor('greek', 'IV')
    expect(st().settings.greek?.rotor).toBe('Beta')
    st().setRotor('greek', 'Gamma')
    expect(st().settings.greek?.rotor).toBe('Gamma')
  })

  it('setRing / setPosition wrap into 0..25 and nudgePosition wraps around', () => {
    st().setRing('left', 27)
    expect(st().settings.left.ring).toBe(1)
    st().setPosition('middle', -1)
    expect(st().settings.middle.position).toBe(25)
    st().nudgePosition('middle', 1)
    expect(st().settings.middle.position).toBe(0)
    st().nudgePosition('right', -1)
    expect(st().settings.right.position).toBe(25)
    st().nudgePosition('right', 3)
    expect(st().settings.right.position).toBe(2)
  })

  it('ring setting BBB enciphers AAAAA → EWTYX', () => {
    st().setRing('left', 1)
    st().setRing('middle', 1)
    st().setRing('right', 1)
    st().setInput('AAAAA')
    expect(selectResult(st()).output).toBe('EWTYX')
  })

  it('plugboard actions', () => {
    st().togglePlug(L('A'), L('B'))
    st().togglePlug(L('C'), L('D'))
    expect(st().settings.plugboard).toEqual([
      [0, 1],
      [2, 3],
    ])
    st().togglePlug(L('A'), L('B'))
    expect(st().settings.plugboard).toEqual([[2, 3]])
    st().setPlugboard([
      [L('Q'), L('W')],
      [L('E'), L('R')],
    ])
    expect(st().settings.plugboard).toHaveLength(2)
    st().clearPlugboard()
    expect(st().settings.plugboard).toEqual([])
  })

  it('setReflector', () => {
    st().setReflector('UKW-C')
    expect(st().settings.reflector).toBe('UKW-C')
  })

  it('model switching coerces the settings', () => {
    st().setRotor('left', 'V')
    st().setReflector('UKW-C')
    st().setRing('right', 4)
    st().togglePlug(L('A'), L('Z'))

    st().setModel('M4')
    let s = st().settings
    expect(s.model).toBe('M4')
    expect(s.greek).not.toBeNull()
    expect(s.reflector).toBe('UKW-C-thin')
    expect(s.left.rotor).toBe('V')
    expect(s.right.ring).toBe(4)
    expect(s.plugboard).toEqual([[0, 25]])
    expect(selectValidation(st())).toEqual([])

    st().setRotor('left', 'VIII')
    st().setModel('I')
    s = st().settings
    expect(s.model).toBe('I')
    expect(s.greek).toBeNull()
    expect(s.reflector).toBe('UKW-C')
    expect(['I', 'II', 'III', 'IV', 'V']).toContain(s.left.rotor)
    expect(new Set([s.left.rotor, s.middle.rotor, s.right.rotor]).size).toBe(3)
    expect(selectValidation(st())).toEqual([])
  })

  it('setModel to the same model is a no-op', () => {
    const before = st().settings
    st().setModel('I')
    expect(st().settings).toBe(before)
  })

  it('randomize produces valid settings for the current model and clears input', () => {
    st().setModel('M4')
    pressAll('ABC')
    st().randomize()
    expect(st().input).toBe('')
    expect(st().settings.model).toBe('M4')
    expect(validateSettings(st().settings)).toEqual([])
    expect(st().settings.plugboard).toHaveLength(10)
  })

  it('resetSettings restores defaults for the current model', () => {
    st().setModel('M3')
    st().randomize()
    st().resetSettings()
    expect(st().settings).toEqual(defaultSettings('M3'))
  })

  it('loadSettings copies the given settings', () => {
    const s = decodeSettings('M4.UKW-B-thin.Beta-II-IV-I.AAAV.VJNA.AT-BL-DF') as MachineSettings
    st().loadSettings(s)
    expect(encodeSettings(st().settings)).toBe('M4.UKW-B-thin.Beta-II-IV-I.AAAV.VJNA.AT-BL-DF')
    expect(st().settings).not.toBe(s)
  })

  it('setOption clamps the speed', () => {
    st().setOption('speed', 5)
    expect(st().options.speed).toBe(SPEED_MIN)
    st().setOption('speed', 99999)
    expect(st().options.speed).toBe(SPEED_MAX)
    st().setOption('groupOutput', true)
    expect(st().options.groupOutput).toBe(true)
    st().setOption('ringDisplay', 'letter')
    expect(st().options.ringDisplay).toBe('letter')
  })
})

describe('trace selection and playback', () => {
  it('active trace is the selected one, else the latest', () => {
    expect(selectActiveTrace(st())).toBeNull()
    expect(selectStageCount(st())).toBe(0)
    pressAll('ABC')
    expect(selectActiveTraceIndex(st())).toBe(2)
    st().selectTrace(0)
    expect(selectActiveTrace(st())?.input).toBe(L('A'))
    st().selectTrace(99)
    expect(selectActiveTraceIndex(st())).toBe(2)
    st().selectTrace(null)
    expect(selectActiveTraceIndex(st())).toBe(2)
  })

  it('stage count is 13 for three rotors and 15 on the M4', () => {
    st().pressKey(L('A'))
    expect(selectStageCount(st())).toBe(13)
    st().setModel('M4')
    expect(selectStageCount(st())).toBe(15)
  })

  it('play / tick / pause, stopping at the end with stageCursor=null', () => {
    st().setOption('animate', false)
    st().play()
    expect(st().playing).toBe(false) // nothing typed yet

    st().pressKey(L('A'))
    st().play()
    expect(st().playing).toBe(true)
    expect(st().stageCursor).toBe(0)
    st().tick()
    st().tick()
    expect(st().stageCursor).toBe(2)
    st().pause()
    expect(st().playing).toBe(false)
    st().tick()
    expect(st().stageCursor).toBe(2)
    st().play()
    expect(st().stageCursor).toBe(2)
    for (let i = 0; i < 20; i++) st().tick()
    expect(st().stageCursor).toBeNull()
    expect(st().playing).toBe(false)
  })

  it('stepStage walks forward / back and clamps', () => {
    st().setOption('animate', false)
    st().pressKey(L('A'))
    st().stepStage(1)
    expect(st().stageCursor).toBe(1)
    st().stepStage(1)
    expect(st().stageCursor).toBe(2)
    st().stepStage(-1)
    st().stepStage(-1)
    st().stepStage(-1)
    expect(st().stageCursor).toBe(0)
    st().setStageCursor(12)
    st().stepStage(1)
    expect(st().stageCursor).toBeNull()
    st().stepStage(-1)
    expect(st().stageCursor).toBe(12)
    st().setStageCursor(500)
    expect(st().stageCursor).toBeNull()
  })

  it('usePlayback reveals stages on a timer honouring the speed', () => {
    vi.useFakeTimers()
    try {
      st().setOption('speed', 100)
      renderHook(() => usePlayback())
      act(() => st().pressKey(L('A')))
      expect(st().stageCursor).toBe(0)
      act(() => {
        vi.advanceTimersByTime(99)
      })
      expect(st().stageCursor).toBe(0)
      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(st().stageCursor).toBe(1)
      for (let i = 0; i < 12; i++) {
        act(() => {
          vi.advanceTimersByTime(100)
        })
      }
      expect(st().stageCursor).toBeNull()
      expect(st().playing).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('derived hooks', () => {
  it('return memoised values that follow the store', () => {
    const { result, rerender } = renderHook(() => ({
      result: useEnigmaResult(),
      positions: useCurrentPositions(),
      trace: useActiveTrace(),
      issues: useValidation(),
    }))
    expect(result.current.result.output).toBe('')
    expect(result.current.trace).toBeNull()
    expect(result.current.issues).toEqual([])
    const first = result.current.result
    rerender()
    expect(result.current.result).toBe(first)

    act(() => pressAll('AAAAA'))
    expect(result.current.result.output).toBe('BDZGO')
    expect(result.current.positions.right).toBe(5)
    expect(result.current.trace?.index).toBe(4)
  })
})

describe('persistence', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('serialize / deserialize round trip', () => {
    st().setModel('M4')
    st().randomize()
    st().setInput('Secret message')
    st().setOption('ringDisplay', 'letter')
    const text = serializeState(st())
    const back = deserializeState(text)
    expect(back).not.toBeNull()
    expect(encodeSettings(back!.settings)).toBe(encodeSettings(st().settings))
    expect(back!.options).toEqual(st().options)
    expect(back!.input).toBe('Secret message')
  })

  it('save / load via localStorage under the versioned key', () => {
    st().setRotor('right', 'V')
    st().setInput('HI')
    expect(savePersisted(st())).toBe(true)
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain('"version":1')
    const loaded = loadPersisted()
    expect(loaded?.settings.right.rotor).toBe('V')
    expect(loaded?.input).toBe('HI')
  })

  it('rejects malformed storage and sanitises options', () => {
    expect(deserializeState(null)).toBeNull()
    expect(deserializeState('{oops')).toBeNull()
    expect(deserializeState(JSON.stringify({ version: 2, settings: 'x' }))).toBeNull()
    expect(deserializeState(JSON.stringify({ version: 1, settings: 'I.UKW-B.I-I-III.AAA.AAA.' }))).toBeNull()
    expect(sanitizeOptions({ nonLetters: 'x', speed: 5, animate: 'yes' })).toEqual({
      ...DEFAULT_OPTIONS,
      speed: SPEED_MIN,
    })
    // `sound` was removed; a stale value saved by an older version is dropped.
    expect(sanitizeOptions({ ...DEFAULT_OPTIONS, sound: true })).toEqual(DEFAULT_OPTIONS)
  })

  it('survives a throwing localStorage', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(savePersisted(st())).toBe(false)
    spy.mockRestore()
  })

  it('shareUrl + readHashSettings round trip', () => {
    st().setModel('M3')
    st().randomize()
    const url = shareUrl(st().settings, 'https://example.com/enigma/?x=1#old')
    expect(url.startsWith('https://example.com/enigma/?x=1#')).toBe(true)
    expect(url).toContain('key=' + encodeSettings(st().settings))
    const hash = url.slice(url.indexOf('#'))
    expect(hash.startsWith('#/simulator?')).toBe(true)
    expect(readHashSettings(hash)).toEqual(st().settings)
    // Legacy share links (`#key=…`) still work.
    expect(readHashSettings('#key=' + encodeSettings(st().settings))).toEqual(st().settings)
    expect(readHashSettings('#key=garbage')).toBeNull()
    expect(readHashSettings('')).toBeNull()
  })

  it('initPersistence hydrates from storage and saves changes (debounced)', () => {
    vi.useFakeTimers()
    st().setRotor('left', 'IV')
    st().setInput('STORED')
    st().setOption('groupOutput', true)
    savePersisted(st())
    resetStore()

    const dispose = initPersistence()
    try {
      expect(st().settings.left.rotor).toBe('IV')
      expect(st().input).toBe('STORED')
      expect(st().options.groupOutput).toBe(true)

      st().setRotor('right', 'V')
      expect(loadPersisted()?.settings.right.rotor).toBe('III')
      vi.advanceTimersByTime(200)
      expect(loadPersisted()?.settings.right.rotor).toBe('V')
    } finally {
      dispose()
    }
  })

  it('a #key= hash overrides stored settings on load and stays in sync', () => {
    vi.useFakeTimers()
    st().setInput('OLD TEXT')
    savePersisted(st())
    resetStore()

    const shared = 'M3.UKW-C.VI-II-VIII.BCD.XYZ.AB-CD'
    window.history.replaceState(null, '', '/#key=' + shared)
    const dispose = initPersistence()
    try {
      expect(encodeSettings(st().settings)).toBe(shared)
      expect(st().input).toBe('')
      // The legacy link is upgraded to the routed form.
      expect(window.location.hash).toBe('#/simulator?key=' + shared)

      st().setPosition('right', 0)
      vi.advanceTimersByTime(200)
      expect(readHashSettings(window.location.hash)?.right.position).toBe(0)
      expect(loadPersisted()?.settings.right.position).toBe(0)
    } finally {
      dispose()
    }
  })

  it('initPersistence is idempotent', () => {
    const a = initPersistence()
    const b = initPersistence()
    expect(a).toBe(b)
    a()
  })
})
