import { describe, it, expect } from 'vitest'
import { moduleFootprint } from './footprint'
import { GENERIC_MODULE_550 as M } from './types'

describe('moduleFootprint', () => {
  it('flush on a 30° roof: ALONG the fall line foreshortened by cos(pitch), ACROSS untouched', () => {
    const f = moduleFootprint({ module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 30, gapM: 0.02, rowPitchM: null })
    expect(f.slopeLengthM).toBe(2.278)
    expect(f.alongM).toBeCloseTo(1.972806, 6)
    expect(f.stepAlongM).toBeCloseTo(1.990126, 6)
    // The WM bug was foreshortening this dimension. It must be exactly the module width.
    expect(f.acrossM).toBe(1.134)
    expect(f.stepAcrossM).toBeCloseTo(1.154, 12)
  })
  it('landscape swaps which side runs up the slope', () => {
    const f = moduleFootprint({ module: M, orientation: 'landscape', mounting: 'flush', tiltDeg: 0, gapM: 0.02, rowPitchM: null })
    expect(f.slopeLengthM).toBe(1.134)
    expect(f.alongM).toBe(1.134)
    expect(f.acrossM).toBe(2.278)
  })
  it('racked: depth is the projection at the rack tilt, step is the row pitch', () => {
    const f = moduleFootprint({ module: M, orientation: 'portrait', mounting: 'racked', tiltDeg: 15, gapM: 0.02, rowPitchM: 3.525643 })
    expect(f.alongM).toBeCloseTo(2.200379, 6)
    expect(f.stepAlongM).toBe(3.525643)
  })
  it('racked needs a pitch at least the module depth', () => {
    expect(() => moduleFootprint({ module: M, orientation: 'portrait', mounting: 'racked', tiltDeg: 15, gapM: 0.02, rowPitchM: null }))
      .toThrow('row pitch')
    expect(() => moduleFootprint({ module: M, orientation: 'portrait', mounting: 'racked', tiltDeg: 15, gapM: 0.02, rowPitchM: 2 }))
      .toThrow('row pitch')
  })
  it('refuses nonsense dimensions and tilts', () => {
    expect(() => moduleFootprint({ module: { ...M, lengthM: 0 }, orientation: 'portrait', mounting: 'flush', tiltDeg: 0, gapM: 0.02, rowPitchM: null })).toThrow('size')
    expect(() => moduleFootprint({ module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 90, gapM: 0.02, rowPitchM: null })).toThrow('tilt')
    expect(() => moduleFootprint({ module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 10, gapM: -1, rowPitchM: null })).toThrow('gap')
  })
})
