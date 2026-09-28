import { describe, it, expect } from 'vitest'
import { planAutoFill, type AutoFillRequest } from './auto-fill-plan'
import { GENERIC_MODULE_550 as M, type RoofObject } from '@esite/shared'

const PPM = 10
const flatRoof: RoofObject = { id: 'R', kind: 'roof', pixelsPerMeter: PPM, geometry: { points: [0, 0, 200, 0, 200, 120, 0, 120] },
  props: { name: 'Flat', roofType: 'flat', pitchDeg: 0, fallBearingDeg: null, heightM: 6, setbackM: 0.5, maxLoadKgM2: null } }
const base: AutoFillRequest = {
  roof: flatRoof, obstructions: [], sheetPixelsPerMeter: PPM, latDeg: -26.2, northBearingDeg: 0, module: M,
  orientation: 'portrait', mode: 'racked', tiltDeg: 15, rowSpacing: { kind: 'auto' }, gapMm: 20, shadeFree: { fromHour: 9, toHour: 15 },
}

describe('planAutoFill', () => {
  it('racked on a flat roof: the hand-checked 48, rows at the D-11 pitch, facing north', () => {
    const p = planAutoFill(base, 'A')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.count).toBe(48)
    expect(p.object.props).toMatchObject({ roofId: 'R', mounting: 'racked', tiltDeg: 15, facingSheetDeg: 0 })
    expect(p.object.props.rowPitchM).toBeCloseTo(3.525643, 5)
    expect(p.object.geometry.modules).toHaveLength(48)
    // stored in IMAGE PIXELS: the first module is 0.5 m (5 px) in from the left edge
    expect(Math.min(...p.object.geometry.modules.flatMap((q) => [q[0]!, q[2]!, q[4]!, q[6]!]))).toBeCloseTo(5, 6)
  })
  it('racked needs north and a site latitude', () => {
    expect(planAutoFill({ ...base, northBearingDeg: null }, 'A')).toEqual({ ok: false, error: 'Set north first (N) — racked rows face the equator.' })
    expect(planAutoFill({ ...base, latDeg: null }, 'A')).toEqual({ ok: false, error: 'Set the site location in Site & Supply first — row spacing depends on latitude.' })
  })
  it('a pitched roof mounts flush along its drawn fall line', () => {
    const pitched: RoofObject = { ...flatRoof, geometry: { points: [0, 0, 120, 0, 120, 70, 0, 70] }, props: { ...flatRoof.props, roofType: 'pitched', pitchDeg: 30, fallBearingDeg: 0, setbackM: 0.3 } }
    const p = planAutoFill({ ...base, roof: pitched, mode: 'racked' }, 'A')
    expect(p.ok && p.count).toBe(27)
    expect(p.ok && p.object.props.mounting).toBe('flush')
    expect(p.ok && p.object.props.tiltDeg).toBe(30)
    expect(planAutoFill({ ...base, roof: { ...pitched, props: { ...pitched.props, fallBearingDeg: null } } }, 'A'))
      .toEqual({ ok: false, error: "Draw the roof's fall line first (Properties → Draw fall line)." })
  })
  it('manual pitch shorter than the module depth is refused with the engine sentence', () => {
    const p = planAutoFill({ ...base, rowSpacing: { kind: 'manual', pitchM: 1 } }, 'A')
    expect(p.ok).toBe(false)
  })
  it('an uncalibrated sheet cannot be filled', () => {
    expect(planAutoFill({ ...base, roof: { ...flatRoof, pixelsPerMeter: null }, sheetPixelsPerMeter: null }, 'A'))
      .toEqual({ ok: false, error: 'This drawing page has no scale yet — calibrate it before drawing.' })
  })
})
