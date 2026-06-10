import { describe, it, expect } from 'vitest'
import {
  deviceTime,
  tccSeries,
  gradePair,
  coordinateStudy,
  type DeviceModel,
} from './mv-coordination.service'

const down: DeviceModel = { id: 'd', label: 'Feeder', std: 'IEC', curve: 'SI', pickupA: 100, tms: 0.1 }
const up: DeviceModel = { id: 'u', label: 'Incomer', std: 'IEC', curve: 'SI', pickupA: 300, tms: 0.15 }

describe('deviceTime', () => {
  it('returns null at/below pickup', () => {
    expect(deviceTime(down, 50)).toBeNull()
    expect(deviceTime(down, 100)).toBeNull()
  })
  it('downstream operates ~0.2267 s at 2000 A (M=20)', () => {
    expect(deviceTime(down, 2000)!).toBeCloseTo(0.2267, 3)
  })
  it('supports definite-time devices', () => {
    const dt: DeviceModel = { id: 'x', label: 'DT', std: 'DT', pickupA: 100, dtS: 0.4 }
    expect(deviceTime(dt, 500)).toBe(0.4)
  })
})

describe('tccSeries', () => {
  it('is log-spaced, drops below-pickup points, decreases in time', () => {
    const s = tccSeries(down, { minA: 50, maxA: 5000, points: 50 })
    expect(s[0].currentA).toBeGreaterThan(100) // 50 A start is below the 100 A pickup
    expect(s.at(-1)!.timeS).toBeLessThan(s[0].timeS)
  })
})

describe('gradePair (verified worked example)', () => {
  it('achieves ~0.316 s margin → verdict ok', () => {
    const c = gradePair(up, down, 2000, 0.3)
    expect(c.downstreamTimeS).toBeCloseTo(0.2267, 3)
    expect(c.upstreamTimeS).toBeCloseTo(0.543, 3)
    expect(c.marginS).toBeCloseTo(0.3163, 3)
    expect(c.verdict).toBe('ok')
  })
  it('flags fails when the margin is too small', () => {
    const tight: DeviceModel = { ...up, tms: 0.1 }
    expect(gradePair(tight, down, 2000, 0.3).verdict).toBe('fails')
  })
})

describe('coordinateStudy', () => {
  it('maps each pair to a discrimination check', () => {
    const checks = coordinateStudy([{ up, down, faultA: 2000 }], 0.3)
    expect(checks).toHaveLength(1)
    expect(checks[0].verdict).toBe('ok')
  })
})

describe('high-set / instantaneous (50) element', () => {
  const inst: DeviceModel = { id: 'i', label: 'Inst', std: 'IEC', curve: 'SI', pickupA: 100, tms: 0.2, instMultiple: 10, instTimeS: 0.05 }
  const noInst: DeviceModel = { ...inst, instMultiple: undefined }

  it('uses the IDMT curve below the high-set threshold (M=8 < 10)', () => {
    expect(deviceTime(inst, 800)!).toBeCloseTo(deviceTime(noInst, 800)!, 6)
  })
  it('floors at instTimeS above the threshold, faster than the IDMT there (M=20)', () => {
    expect(deviceTime(inst, 2000)).toBe(0.05)
    expect(0.05).toBeLessThan(deviceTime(noInst, 2000)!)
  })
  it('defaults the high-set operate time to 0.05 s when instTimeS is omitted', () => {
    expect(deviceTime({ ...inst, instTimeS: undefined }, 2000)).toBe(0.05)
  })
  it('an upstream 50 overreaching the downstream zone fails grading', () => {
    const downIdmt: DeviceModel = { id: 'd', label: 'Feeder', std: 'IEC', curve: 'SI', pickupA: 100, tms: 0.1 }
    const upInst: DeviceModel = { id: 'u', label: 'Incomer', std: 'IEC', curve: 'SI', pickupA: 300, tms: 0.3, instMultiple: 10, instTimeS: 0.05 }
    const c = gradePair(upInst, downIdmt, 4000, 0.3) // 4000 A > 10×300 → upstream 50 picks up
    expect(c.upstreamTimeS).toBe(0.05) // upstream trips on its high-set
    expect(c.downstreamTimeS).toBeGreaterThan(0.05) // downstream still on IDMT
    expect(c.verdict).toBe('fails') // upstream beats downstream → no discrimination
  })
})
