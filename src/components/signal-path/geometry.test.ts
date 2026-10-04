import { describe, expect, it } from 'vitest'
import { defaultSettings, encryptText, mod26, toChar } from '../../lib/enigma'
import type { MachineSettings, SlotId } from '../../lib/enigma'
import {
  ROW_COUNT,
  buildActivePath,
  buildLayout,
  buildStaticDiagram,
  columnOf,
  layoutFor,
  rotorForward,
  rowY,
  splitCubic,
  stageExplanation,
  steppingSentence,
} from './geometry'

function traceOf(settings: MachineSettings, text: string, index = -1) {
  const { traces } = encryptText(settings, text, { nonLetters: 'remove' })
  return traces.at(index)!
}

const M3_PLUGGED: MachineSettings = {
  ...defaultSettings('I'),
  model: 'M3',
  reflector: 'UKW-C',
  left: { rotor: 'VI', ring: 3, position: 7 },
  middle: { rotor: 'II', ring: 11, position: 4 },
  right: { rotor: 'VIII', ring: 20, position: 25 },
  plugboard: [
    [0, 9],
    [4, 17],
    [10, 23],
  ],
}

const M4: MachineSettings = {
  ...defaultSettings('M4'),
  greek: { rotor: 'Gamma', ring: 2, position: 14 },
  left: { rotor: 'IV', ring: 5, position: 1 },
  middle: { rotor: 'VII', ring: 0, position: 12 },
  right: { rotor: 'I', ring: 22, position: 16 },
  plugboard: [
    [1, 2],
    [3, 24],
  ],
}

describe('layout', () => {
  it('orders the columns reflector → keys, with the Greek wheel only on M4', () => {
    expect(buildLayout(false).columns.map((c) => c.id)).toEqual([
      'reflector',
      'left',
      'middle',
      'right',
      'entry',
      'plugboard',
      'keys',
    ])
    expect(buildLayout(true).columns.map((c) => c.id)).toEqual([
      'reflector',
      'greek',
      'left',
      'middle',
      'right',
      'entry',
      'plugboard',
      'keys',
    ])
  })

  it('keeps the natural width in the 900–1150px range and columns non-overlapping', () => {
    for (const hasGreek of [false, true]) {
      const layout = layoutFor(hasGreek)
      expect(layout.width).toBeGreaterThanOrEqual(900)
      expect(layout.width).toBeLessThanOrEqual(1150)
      for (let i = 1; i < layout.columns.length; i++) {
        expect(layout.columns[i].x0).toBeGreaterThan(layout.columns[i - 1].x1)
      }
      expect(rowY(ROW_COUNT - 1)).toBeLessThan(layout.bodyBottom)
      expect(rowY(0)).toBeGreaterThan(layout.bodyTop)
    }
  })

  it('splits a cubic into two halves meeting in the middle', () => {
    const [a, b] = splitCubic([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
    ])
    expect(a[3]).toEqual(b[0])
    expect(a[0]).toEqual({ x: 0, y: 0 })
    expect(b[3]).toEqual({ x: 10, y: 0 })
    expect(a[3]).toEqual({ x: 5, y: 7.5 })
  })
})

describe('active path', () => {
  const cases: [string, MachineSettings, string, number, number][] = [
    ['Enigma I defaults', defaultSettings('I'), 'K', 26, 12],
    ['M3 with rings and plugs', M3_PLUGGED, 'HELLOWORLD', 26, 12],
    ['M4 with Greek wheel', M4, 'UBOOTE', 30, 14],
  ]

  for (const [name, settings, text, segmentCount, badgeCount] of cases) {
    describe(name, () => {
      const trace = traceOf(settings, text)
      const layout = layoutFor(settings.greek !== null)
      const path = buildActivePath(layout, trace)

      it('has the expected number of segments and badges', () => {
        expect(path.segments).toHaveLength(segmentCount)
        expect(path.badges).toHaveLength(badgeCount)
        expect(trace.stages).toHaveLength(settings.greek ? 15 : 13)
      })

      it('chains continuously: every segment starts where the previous one ended', () => {
        for (let i = 1; i < path.segments.length; i++) {
          expect(path.segments[i].from).toEqual(path.segments[i - 1].to)
        }
      })

      it('starts at the pressed key and ends at the lit lamp', () => {
        const first = path.segments[0]
        const last = path.segments.at(-1)!
        expect(first.from.y).toBe(rowY(trace.input))
        expect(last.to.y).toBe(rowY(trace.output))
        expect(first.from.x).toBe(last.to.x)
        expect(path.key).toBe(trace.input)
        expect(path.lamp).toBe(trace.output)
      })

      it('tags segments with monotonic stage indices covering every stage', () => {
        const indices = path.segments.map((s) => s.stageIndex)
        for (let i = 1; i < indices.length; i++) {
          expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1])
        }
        expect(new Set(indices)).toEqual(new Set(trace.stages.map((_, i) => i)))
        const badgeIdx = path.badges.map((b) => b.stageIndex)
        expect(badgeIdx).toEqual([...badgeIdx].sort((a, b) => a - b))
      })

      it('each stage starts on its input row and the stage after continues on its output row', () => {
        trace.stages.forEach((stage, i) => {
          const segs = path.segments.filter((s) => s.stageIndex === i)
          expect(segs[0].from.y).toBe(rowY(stage.input))
          const wires = segs.filter((s) => s.kind === 'wire')
          expect(wires.at(-1)!.to.y).toBe(rowY(stage.output))
        })
      })

      it('colours the forward path orange and the return path blue, split at the reflector', () => {
        const reflectorIndex = trace.stages.findIndex((s) => s.kind === 'reflector')
        for (const seg of path.segments) {
          if (seg.stageIndex < reflectorIndex) expect(seg.tone).toBe('in')
          if (seg.stageIndex > reflectorIndex) expect(seg.tone).toBe('out')
        }
        const refl = path.segments.filter((s) => s.stageIndex === reflectorIndex)
        expect(refl.map((s) => s.tone)).toEqual(['in', 'out', 'out'])
      })

      it('labels the badges with the letter handed to the next column', () => {
        for (const badge of path.badges) {
          expect(badge.letter).toBe(toChar(trace.stages[badge.stageIndex].output))
        }
      })

      it('draws rotor wires that match the faint wiring for the stage offset', () => {
        for (const stage of trace.stages) {
          if (stage.kind !== 'rotor') continue
          const slot = stage.component as SlotId
          const rotor = (slot === 'greek' ? settings.greek! : settings[slot]).rotor
          if (stage.direction === 'forward') {
            expect(rotorForward(rotor, stage.offset!, stage.input)).toBe(stage.output)
          } else {
            expect(rotorForward(rotor, stage.offset!, stage.output)).toBe(stage.input)
          }
        }
      })
    })
  }
})

describe('static diagram', () => {
  it('builds 3 drums for Enigma I and 4 for M4, using the trace offsets', () => {
    const trace = traceOf(M4, 'ENIGMA')
    const model = buildStaticDiagram(M4, trace)
    expect(model.drums.map((d) => d.slot)).toEqual(['greek', 'left', 'middle', 'right'])
    for (const drum of model.drums) {
      const stage = trace.stages.find((s) => s.component === drum.slot)!
      expect(drum.offset).toBe(stage.offset)
    }
    expect(buildStaticDiagram(defaultSettings('I'), null).drums).toHaveLength(3)
  })

  it('shows the ring letters rotated by the position, window letter on row A', () => {
    const settings = { ...defaultSettings('I'), right: { rotor: 'III' as const, ring: 0, position: 20 } }
    const trace = traceOf(settings, 'A') // right steps U → V
    const right = buildStaticDiagram(settings, trace).drums.find((d) => d.slot === 'right')!
    expect(right.windowLetter).toBe('V')
    expect(right.ringLetters[0]).toMatchObject({ letter: 'V', window: true, notch: true })
    expect(right.ringLetters[1].letter).toBe('W')
    expect(right.ringLetters.filter((l) => l.notch)).toHaveLength(1)
    expect(right.badge).toEqual({ text: 'stepped U→V', emphasis: 'outline' })
  })

  it('uses the START positions without a trace', () => {
    const settings = { ...defaultSettings('I'), left: { rotor: 'I' as const, ring: 1, position: 3 } }
    const left = buildStaticDiagram(settings, null).drums.find((d) => d.slot === 'left')!
    expect(left.offset).toBe(mod26(3 - 1))
    expect(left.windowLetter).toBe('D')
    expect(left.badge).toBeNull()
  })

  it('separates plugged cables from straight plugboard wires', () => {
    const model = buildStaticDiagram(M3_PLUGGED, null)
    expect(model.plugboard.plugged.match(/M/g)).toHaveLength(6)
    expect(model.plugboard.plain.match(/M/g)).toHaveLength(20)
    expect(model.plugboard.detail).toBe('3 cables')
    expect(model.reflector.arcs.match(/M/g)).toHaveLength(13)
    expect(columnOf(model.layout, 'plugboard')).toBe(model.plugboard.column)
  })

  it('marks the double step on the middle rotor', () => {
    const settings: MachineSettings = {
      ...defaultSettings('I'),
      left: { rotor: 'I', ring: 0, position: 0 },
      middle: { rotor: 'II', ring: 0, position: 3 },
      right: { rotor: 'III', ring: 0, position: 20 },
    }
    const trace = traceOf(settings, 'AAA') // ADU → ADV, AEW, BFX
    expect(trace.stepping.doubleStep).toBe(true)
    const model = buildStaticDiagram(settings, trace)
    const badges = Object.fromEntries(model.drums.map((d) => [d.slot, d.badge?.text]))
    expect(badges).toEqual({
      left: 'stepped A→B',
      middle: 'double step E→F',
      right: 'stepped W→X',
    })
    expect(steppingSentence(trace.stepping)).toBe(
      'Right rotor stepped W → X; middle rotor stepped E → F (double step); left rotor stepped A → B.',
    )
  })
})

describe('explanations', () => {
  it('explains the rotor maths', () => {
    const settings = { ...defaultSettings('I'), right: { rotor: 'III' as const, ring: 1, position: 3 } }
    const trace = traceOf(settings, 'K')
    const stage = trace.stages.find((s) => s.component === 'right' && s.direction === 'forward')!
    const text = stageExplanation(stage, trace, settings)
    expect(text).toContain('offset = position − ring = E − 02 = 3')
    expect(text).toContain(`core in ${toChar(stage.coreInput!)}`)
    expect(text).toContain(`core out ${toChar(stage.coreOutput!)}`)
    expect(stageExplanation(trace.stages[1], trace, settings)).toContain('passes straight through')
  })
})
