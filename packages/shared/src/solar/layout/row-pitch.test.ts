import { describe, it, expect } from 'vitest'
import { solsticeElevationDeg, shadeFreeElevationDeg, autoRowPitch, manualRowPitch, JUNE_SOLSTICE_DECLINATION_DEG } from './row-pitch'

describe('solstice solar elevation at the site latitude (D-11)', () => {
  it('uses the June solstice declination', () => {
    expect(JUNE_SOLSTICE_DECLINATION_DEG).toBe(23.44)
  })
  it('Johannesburg at 09:00 solar time (hand-checked)', () => {
    expect(solsticeElevationDeg(-26.2, 9)).toBeCloseTo(23.98355, 4)
  })
  it('is symmetric about solar noon', () => {
    expect(solsticeElevationDeg(-26.2, 15)).toBeCloseTo(solsticeElevationDeg(-26.2, 9), 12)
  })
  it('Cape Town is lower, the equator higher', () => {
    expect(solsticeElevationDeg(-33.9, 9)).toBeCloseTo(18.4580, 3)
    expect(solsticeElevationDeg(0, 9)).toBeCloseTo(40.4477, 3)
  })
  it('the shade-free window uses the LOWER of its two ends', () => {
    // 10:00 is higher than 15:00, so 15:00 governs.
    expect(shadeFreeElevationDeg(-26.2, 10, 15)).toBeCloseTo(solsticeElevationDeg(-26.2, 15), 12)
  })
})

describe('row pitch', () => {
  it('auto: L_proj + L·sin(tilt)/tan(α), hand-checked', () => {
    const p = autoRowPitch({ slopeLengthM: 2.278, tiltDeg: 15, latDeg: -26.2, fromHour: 9, toHour: 15 })
    expect(p.alphaDeg).toBeCloseTo(23.98355, 4)
    expect(p.projM).toBeCloseTo(2.200379, 5)
    expect(p.gapM).toBeCloseTo(1.325264, 5)
    expect(p.pitchM).toBeCloseTo(3.525643, 5)
  })
  it('a flat-mounted module needs no shading gap', () => {
    const p = autoRowPitch({ slopeLengthM: 2.278, tiltDeg: 0, latDeg: -26.2, fromHour: 9, toHour: 15 })
    expect(p.gapM).toBe(0)
    expect(p.pitchM).toBeCloseTo(2.278, 12)
  })
  it('refuses when the sun is too low to design against', () => {
    expect(() => autoRowPitch({ slopeLengthM: 2.278, tiltDeg: 15, latDeg: -70, fromHour: 9, toHour: 15 }))
      .toThrow('enter a manual row pitch')
  })
  it('manual pitch must clear the module’s own projection', () => {
    expect(manualRowPitch({ slopeLengthM: 2.278, tiltDeg: 15, pitchM: 4 }).pitchM).toBe(4)
    expect(() => manualRowPitch({ slopeLengthM: 2.278, tiltDeg: 15, pitchM: 2 })).toThrow('shorter than')
  })
})
