import { describe, it, expect } from 'vitest'
import {
  breakerBreakingCapacityCheck,
  adiabaticWithstand,
  makingCapacityCheck,
  asymmetricalBreakingCheck,
} from './mv-sizing.service'

describe('breaker breaking capacity', () => {
  it('passes when device kA ≥ Ik3 max, with margin', () => {
    const v = breakerBreakingCapacityCheck(16, 15.06)
    expect(v.pass).toBe(true)
    expect(v.marginPct).toBeCloseTo(6.24, 1)
  })
  it('fails when undersized', () => {
    expect(breakerBreakingCapacityCheck(12.5, 15.06).pass).toBe(false)
  })
})

describe('adiabatic I²t withstand', () => {
  it('permissible time = (k·S/I)²; passes when clear time is shorter', () => {
    // copper XLPE k=143, S=95 mm², Ik=15.06 kA, clear 0.2 s
    const v = adiabaticWithstand({ kFactor: 143, csaMm2: 95, ikKa: 15.06, clearTimeS: 0.2 })
    expect(v.permissibleTimeS).toBeCloseTo(0.814, 2)
    expect(v.pass).toBe(true)
  })
  it('fails when clear time exceeds permissible', () => {
    expect(
      adiabaticWithstand({ kFactor: 143, csaMm2: 25, ikKa: 15.06, clearTimeS: 0.2 }).pass,
    ).toBe(false)
  })
})

describe('making (peak) capacity', () => {
  it('passes when the making peak covers ip', () => {
    expect(makingCapacityCheck(62.5, 50).pass).toBe(true)
  })
  it('fails when ip exceeds the making peak', () => {
    const v = makingCapacityCheck(40, 50)
    expect(v.pass).toBe(false)
    expect(v.marginPct).toBeLessThan(0)
  })
})

describe('asymmetrical (DC) breaking duty', () => {
  it('passes for a normal X/R within the IEC standard (~14.1)', () => {
    expect(asymmetricalBreakingCheck({ ik3MaxKa: 20, xr: 10 }).pass).toBe(true)
  })
  it('flags at the X/R = 14.1 boundary', () => {
    expect(asymmetricalBreakingCheck({ ik3MaxKa: 20, xr: 14 }).pass).toBe(true)
    expect(asymmetricalBreakingCheck({ ik3MaxKa: 20, xr: 15 }).pass).toBe(false)
  })
  it('a high X/R yields an asymmetrical current above the symmetrical Ik', () => {
    const v = asymmetricalBreakingCheck({ ik3MaxKa: 20, xr: 30 })
    expect(v.pass).toBe(false)
    expect(v.note).toMatch(/I_asym/)
  })
})

describe('adiabatic validity', () => {
  it('flags a clear time outside the adiabatic regime (>5 s)', () => {
    const v = adiabaticWithstand({ kFactor: 143, csaMm2: 300, ikKa: 1, clearTimeS: 8 })
    expect(v.pass).toBe(true)
    expect(v.note).toMatch(/adiabatic regime|IEC 60949/)
  })
  it('no validity warning for a normal short clear', () => {
    const v = adiabaticWithstand({ kFactor: 143, csaMm2: 95, ikKa: 15.06, clearTimeS: 0.2 })
    expect(v.note).toBe('Withstand adequate')
  })
})
