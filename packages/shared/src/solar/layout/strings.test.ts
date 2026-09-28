import { describe, it, expect } from 'vitest'
import { stringCheck, recommendedStringLength, maxStringsPerMppt, serpentineOrder, autoString } from './strings'
import { GENERIC_INVERTER_50KW as INV, GENERIC_MODULE_550 as M, type StringProps } from './types'

const COND = { tMinC: -5, tAmbMaxC: 35 }
const quad = (x: number, y: number, w = 10, h = 18) => [x, y, x + w, y, x + w, y + h, x, y + h]

describe('string checks from layout specs (engine spec §3.3, hand-checked)', () => {
  it('20 × 550 W on the generic 50 kW inverter passes; Voc_cold 1078.84 V', () => {
    const r = stringCheck(M, INV, 20, 1, 'racked', COND)
    expect(r.vocCold).toBeCloseTo(1078.838, 3)
    expect(r.vmpHot).toBeCloseTo(707.026, 3)
    expect(r.vmpCold).toBeCloseTo(927.316, 3)
    expect(r.ok).toBe(true)
  })
  it('21 in series exceeds 1100 V (hard fail)', () => {
    const r = stringCheck(M, INV, 21, 1, 'racked', COND)
    expect(r.checks.find((c) => c.id === 'voc-cold')?.status).toBe('fail')
    expect(r.ok).toBe(false)
  })
  it('flush mounting runs 10 °C hotter (Vmp_hot drops)', () => {
    expect(stringCheck(M, INV, 20, 1, 'flush', COND).vmpHot).toBeCloseTo(677.654, 3)
  })
  it('recommended length is the largest that passes every hard check', () => {
    expect(recommendedStringLength(M, INV, 'racked', COND)).toBe(20)
  })
  it('strings per MPPT from the current limit', () => {
    expect(maxStringsPerMppt(M, INV)).toBe(2)
    expect(maxStringsPerMppt(M, { ...INV, iMpptMax: 10 })).toBe(0)
  })
})

describe('serpentine order', () => {
  it('facing north (sheet-up): the southernmost row first, then snake back', () => {
    // Top row (y 0) indices 0,1,2; bottom row (y 20) indices 3,4,5.
    const quads = [quad(0, 0), quad(10, 0), quad(20, 0), quad(0, 20), quad(10, 20), quad(20, 20)]
    expect(serpentineOrder(quads, 0)).toEqual([3, 4, 5, 2, 1, 0])
  })
})

describe('autoString', () => {
  // An inverter that makes the recommended length 2 so the example stays small:
  // 2 × 53.94 = 107.9 V ≤ 110; 3 × would be 161.8. Vmp_hot 70.7 ≥ 60; Vmp_cold 92.7 ≤ 100.
  const small = { ...INV, mppts: 1, vDcMax: 110, vMpptMin: 60, vMpptMax: 100, iMpptMax: 40 }
  const quads = [quad(0, 0), quad(10, 0), quad(20, 0), quad(0, 20), quad(10, 20), quad(20, 20)]

  it('fills strings of the recommended length in serpentine order onto free MPPT inputs', () => {
    const r = autoString({
      arrays: [{ id: 'A', quads, facingSheetDeg: 0 }], existingStrings: [], inverterId: 'I', inverter: small,
      module: M, mounting: 'racked', conditions: COND,
    })
    expect(r.stringLength).toBe(2)
    expect(r.strings).toEqual([
      { mppt: 1, modules: [{ arrayId: 'A', index: 3 }, { arrayId: 'A', index: 4 }] },
      { mppt: 1, modules: [{ arrayId: 'A', index: 5 }, { arrayId: 'A', index: 2 }] },
    ])
    // Two strings fill MPPT 1 (current limit); the third complete string has nowhere to go.
    expect(r.unstrung).toEqual([{ arrayId: 'A', index: 1 }, { arrayId: 'A', index: 0 }])
    expect(r.reason).toBe('The inverter has no free MPPT input for the remaining modules.')
  })

  it('skips modules already in a string and counts existing strings against MPPT capacity', () => {
    const existing: StringProps[] = [{ inverterId: 'I', mppt: 1, modules: [{ arrayId: 'A', index: 3 }, { arrayId: 'A', index: 4 }] }]
    const r = autoString({
      arrays: [{ id: 'A', quads, facingSheetDeg: 0 }], existingStrings: existing, inverterId: 'I', inverter: small,
      module: M, mounting: 'racked', conditions: COND,
    })
    expect(r.strings).toEqual([{ mppt: 1, modules: [{ arrayId: 'A', index: 5 }, { arrayId: 'A', index: 2 }] }])
    expect(r.unstrung).toEqual([{ arrayId: 'A', index: 1 }, { arrayId: 'A', index: 0 }])
  })

  it('a remainder shorter than a string stays unstrung with its own reason', () => {
    const roomy = { ...small, mppts: 4 }
    const r = autoString({
      arrays: [{ id: 'A', quads: quads.slice(0, 5), facingSheetDeg: 0 }], existingStrings: [], inverterId: 'I', inverter: roomy,
      module: M, mounting: 'racked', conditions: COND,
    })
    expect(r.strings).toHaveLength(2)
    expect(r.unstrung).toHaveLength(1)
    expect(r.reason).toBe('1 module is left over — fewer than one string of 2.')
  })

  it('refuses when no string length passes', () => {
    expect(() => autoString({
      arrays: [{ id: 'A', quads, facingSheetDeg: 0 }], existingStrings: [], inverterId: 'I', inverter: { ...small, vDcMax: 40 },
      module: M, mounting: 'racked', conditions: COND,
    })).toThrow('No string length passes')
  })
})
