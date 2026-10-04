import { describe, expect, it } from 'vitest'
import { encryptText } from '../../enigma/machine'
import { randomSettings } from '../../enigma/settings'
import { buildClassTable, cipherLayout } from '../climb'
import { mulberry32 } from '../random'
import { buildTable, compileKey, keyFromSettings } from '../scrambler'
import { createContext, planUnit, rotorUnits } from '../search'
import { toCodes } from '../text'
import type { BreakerConfig } from '../types'
import { createGpuStages, gpuUnsupportedReason } from './gpu-stages'
import {
  JOB_STRIDE,
  NONE,
  SCREEN_STRIDE,
  cipherBuffer,
  packBytes,
  packedByte,
  pairList,
  planBuffer,
  reduceScreen,
  refineJobs,
  unpackPlugs,
} from './layout'

const config = (ciphertext: string): BreakerConfig => ({
  ciphertext,
  model: 'I',
  rotors: ['I', 'II', 'III', 'IV', 'V'],
  reflectors: ['UKW-B'],
  greekRotors: [],
  ringSearch: 'right-middle',
  maxPlugs: 10,
  language: 'de',
  crib: null,
  workers: 1,
})

describe('GPU buffer layouts', () => {
  it('packs bytes four to a word and reads them back', () => {
    const bytes = Uint8Array.from({ length: 27 }, (_, i) => (i * 37) & 0xff)
    const words = packBytes(bytes)
    expect(words.length).toBe(7)
    for (let i = 0; i < bytes.length; i++) expect(packedByte(words, 0, i)).toBe(bytes[i])
    const P = Uint8Array.from({ length: 26 }, (_, i) => 25 - i)
    const out = new Uint32Array(10)
    packBytes(P, out, 3)
    expect(Array.from(unpackPlugs(out, 3))).toEqual(Array.from(P))
  })

  it('tabMap rebuilds the CPU class table from the position-major scrambler table', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const s = { ...randomSettings('I', mulberry32(seed)), reflector: 'UKW-B' as const }
      const plain = 'DERFEINDISTIMANMARSCHNACHWESTENXSTOPXKEINEBESONDERENEREIGNISSE'.repeat(3)
      const codes = toCodes(encryptText(s, plain, { nonLetters: 'remove' }).output)
      const layout = cipherLayout(codes)
      const c = compileKey(keyFromSettings(s), codes.length)
      const classTab = new Uint8Array(codes.length * 26)
      buildClassTable(layout, c.inner, c.rf, c.rb, c.rBase, c.iBase, classTab)
      const posTab = buildTable(c)
      const buf = cipherBuffer(layout)
      for (let o = 0; o < codes.length * 26; o++) {
        const m = buf.data[buf.tabMapOff + o]
        expect(posTab[(m & 0xffff) * 26 + (m >>> 16)]).toBe(classTab[o])
      }
      for (let k = 0; k < codes.length; k++) expect(buf.data[buf.classPosOff + k]).toBe(layout.classPos[k])
      for (let i = 0; i < codes.length; i++) {
        expect(buf.data[i]).toBe(codes[i])
        expect(buf.data[buf.classRankOff + i]).toBe(layout.classRank[i])
      }
    }
  })

  it('lists cable pairs in the CPU climb order', () => {
    const order = Uint8Array.from({ length: 26 }, (_, i) => (i * 7) % 26)
    const pairs = pairList(order, 18)
    expect(pairs.length).toBe((18 * 17) / 2)
    let k = 0
    for (let i = 0; i < 17; i++) {
      for (let j = i + 1; j < 18; j++) {
        expect(pairs[k] & 0xff).toBe(order[i])
        expect(pairs[k] >>> 8).toBe(order[j])
        k++
      }
    }
  })

  it('encodes a unit plan', () => {
    const cfg = config('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(10))
    const ctx = createContext(cfg, null)
    const plan = planUnit(ctx, rotorUnits(cfg)[7])
    const b = planBuffer(plan)
    for (let oM = 0; oM < 26; oM++) {
      const screen = plan.screenRms[oM]
      expect(b.data[oM * b.screenStride]).toBe(screen.length)
      expect(Array.from(b.data.subarray(oM * b.screenStride + 1, oM * b.screenStride + 1 + screen.length))).toEqual(screen)
      const all = plan.allRms[oM]
      const base = b.allOff + oM * b.allStride
      expect(b.data[base]).toBe(all.length)
      expect(Array.from(b.data.subarray(base + 1, base + 1 + all.length))).toEqual(all)
    }
    expect(Array.from(b.data.subarray(b.screenRingsOff + 1, b.screenRingsOff + 1 + plan.screenRings.length))).toEqual(plan.screenRings)
    expect(b.data[b.sweepOff]).toBe(26)
    expect(b.variantsPerPos).toBe((b.screenStride - 1) * plan.screenRings.length)
  })

  it('reduces stage-A results like the CPU: first best variant, missing variants skipped', () => {
    const V = 3
    const out = new Uint32Array(2 * V * SCREEN_STRIDE)
    const put = (job: number, value: number, plug: number) => {
      out[job * SCREEN_STRIDE] = value
      const P = Uint8Array.from({ length: 26 }, (_, i) => i)
      P[0] = plug
      packBytes(P, out, job * SCREEN_STRIDE + 1)
    }
    put(0, 50, 1)
    put(1, 70, 2)
    put(2, 70, 3) // tie: the earlier variant wins
    put(3, NONE, 0)
    put(4, 10, 4)
    put(5, NONE, 0)
    const screen = new Float64Array(2)
    const screenP = new Uint8Array(52)
    reduceScreen(out, V, screen, screenP, 0, 2)
    expect(Array.from(screen)).toEqual([70, 10])
    expect(screenP[0]).toBe(2)
    expect(screenP[26]).toBe(4)
  })

  it('packs stage-B jobs: start position + its screen plugboard', () => {
    const screenP = new Uint8Array(17576 * 26)
    screenP[123 * 26 + 5] = 9
    const jobs = refineJobs(Int32Array.from([123]), screenP)
    expect(jobs.length).toBe(JOB_STRIDE)
    expect(jobs[0]).toBe(123)
    expect(unpackPlugs(jobs, 1)[5]).toBe(9)
  })

  it('reports why WebGPU cannot run here and creates no backend (node has no navigator.gpu)', async () => {
    const ctx = createContext(config('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(4)), null)
    expect(gpuUnsupportedReason(ctx)).toBe('WebGPU is not available')
    await expect(createGpuStages(ctx)).resolves.toBeNull()
  })
})
