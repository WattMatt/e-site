import { describe, it, expect } from 'vitest'
import { autoFill, placeGrid, compareCandidates, gridOffset, GRID_OFFSETS, type Obstacle, type AutoFillInput } from './packing'
import { moduleFootprint, type Footprint } from './footprint'
import { quadInsideRoof, quadClearOfPolygon, quadClearOfCircle } from './geometry'
import { GENERIC_MODULE_550 as M, type Pt } from './types'

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
]
const L_ROOF: Pt[] = [
  { x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 6 }, { x: 8, y: 6 }, { x: 8, y: 12 }, { x: 0, y: 12 },
]
const OBSTACLES: Obstacle[] = [
  { kind: 'polygon', points: rect(3, 2, 5, 4), setbackM: 0.6 },
  { kind: 'circle', centre: { x: 4, y: 9 }, radiusM: 0.5, setbackM: 0.3 },
]

function everyModuleIsLegal(input: AutoFillInput, modules: Pt[][]) {
  for (const q of modules) {
    expect(quadInsideRoof(q, input.roof, input.setbackM)).toBe(true)
    for (const o of input.obstacles) {
      if (o.kind === 'polygon') expect(quadClearOfPolygon(q, o.points, o.setbackM)).toBe(true)
      else expect(quadClearOfCircle(q, o.centre, o.radiusM, o.setbackM)).toBe(true)
    }
  }
}

describe('grid offsets', () => {
  it('eight offsets: quarter steps across × half steps along', () => {
    expect(GRID_OFFSETS).toBe(8)
    expect(gridOffset(0, 1, 2)).toEqual({ du: 0, dv: 0 })
    expect(gridOffset(3, 1, 2)).toEqual({ du: 0.75, dv: 0 })
    expect(gridOffset(5, 1, 2)).toEqual({ du: 0.25, dv: 1 })
  })
})

describe('hand-checked roof 1 — flat, racked 15°, D-11 pitch', () => {
  const fp = moduleFootprint({ module: M, orientation: 'portrait', mounting: 'racked', tiltDeg: 15, gapM: 0.02, rowPitchM: 3.525643 })
  const input: AutoFillInput = { roof: rect(0, 0, 20, 12), setbackM: 0.5, obstacles: [], footprint: fp, facingSheetDeg: 0, rotationsDeg: [0] }
  it('places 3 rows of 16 = 48 modules', () => {
    const r = autoFill(input)
    expect(r.count).toBe(48)
    expect(r.rowCounts).toEqual([16, 16, 16])
    expect(r.rotationDeg).toBe(0)
    expect(r.offsetIndex).toBe(0)
    everyModuleIsLegal(input, r.modules)
  })
  it('rows are one pitch apart along the facing direction', () => {
    const r = autoFill(input)
    const ys = [...new Set(r.modules.map((q) => Math.round(Math.max(...q.map((p) => p.y)) * 1e6) / 1e6))].sort((a, b) => b - a)
    expect(ys[0]! - ys[1]!).toBeCloseTo(3.525643, 6)
  })
})

describe('hand-checked roof 2 — pitched 30°, flush', () => {
  const fp = moduleFootprint({ module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 30, gapM: 0.02, rowPitchM: null })
  const input: AutoFillInput = { roof: rect(0, 0, 12, 7), setbackM: 0.3, obstacles: [], footprint: fp, facingSheetDeg: 0, rotationsDeg: [0] }
  it('places 9 × 3 = 27 modules', () => {
    const r = autoFill(input)
    expect(r.count).toBe(27)
    expect(r.rowCounts).toEqual([9, 9, 9])
    everyModuleIsLegal(input, r.modules)
  })
  it('the WM bug (foreshortening across the slope) would have placed 22 — pinned so it cannot come back', () => {
    const c = Math.cos(Math.PI / 6)
    const wm: Footprint = { slopeLengthM: 2.278, acrossM: 1.134 * c, stepAcrossM: 1.154 * c, alongM: 2.278, stepAlongM: 2.298 }
    expect(autoFill({ ...input, footprint: wm }).count).toBe(22)
    expect(autoFill(input).count).not.toBe(22)
  })
})

describe('hand-checked roof 3 — irregular L with a plant room and a skylight', () => {
  const fp = moduleFootprint({ module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 0, gapM: 0.02, rowPitchM: null })
  const input: AutoFillInput = { roof: L_ROOF, setbackM: 0.5, obstacles: OBSTACLES, footprint: fp, facingSheetDeg: 0, rotationsDeg: [0, 90] }
  it('rotation 0°, offset 0 gives 23 in rows 4, 4, 6, 9 (hand count)', () => {
    const g = placeGrid(input, 0, 0)
    expect(g.modules.length).toBe(23)
    expect(g.rowCounts).toEqual([4, 4, 6, 9])
  })
  it('rotation 90°, offset 1 gives 25 in rows 5, 3, 5, 4, 4, 4 (hand count)', () => {
    const g = placeGrid(input, 90, 1)
    expect(g.modules.length).toBe(25)
    expect(g.rowCounts).toEqual([5, 3, 5, 4, 4, 4])
  })
  it('auto-fill picks the best of 2 rotations × 8 offsets: 25 at 90°, offset 1', () => {
    const r = autoFill(input)
    expect(r.count).toBe(25)
    expect(r.rotationDeg).toBe(90)
    expect(r.offsetIndex).toBe(1)
    everyModuleIsLegal(input, r.modules)
  })
  it('the obstructions cost modules (39 without them)', () => {
    expect(autoFill({ ...input, obstacles: [] }).count).toBe(39)
  })
})

describe('tie-break and edge cases', () => {
  it('more modules wins; equal count prefers fewer partial rows; still equal keeps the first', () => {
    const a = { count: 10, partialRows: 1 }
    expect(compareCandidates({ count: 11, partialRows: 5 }, a)).toBeLessThan(0)
    expect(compareCandidates({ count: 10, partialRows: 0 }, a)).toBeLessThan(0)
    expect(compareCandidates({ count: 10, partialRows: 1 }, a)).toBe(0)
  })
  it('a symmetric square ties 0° and 90°, and 0° (the first candidate) is kept', () => {
    const fp: Footprint = { slopeLengthM: 1, acrossM: 1, alongM: 1, stepAcrossM: 1, stepAlongM: 1 }
    const r = autoFill({ roof: rect(0, 0, 10.2, 10.2), setbackM: 0.1, obstacles: [], footprint: fp, facingSheetDeg: 0, rotationsDeg: [0, 90] })
    expect(r.count).toBe(100)
    expect(r.rotationDeg).toBe(0)
    expect(r.offsetIndex).toBe(0)
  })
  it('a roof smaller than one module places nothing', () => {
    const fp = moduleFootprint({ module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 0, gapM: 0.02, rowPitchM: null })
    expect(autoFill({ roof: rect(0, 0, 1, 1), setbackM: 0.3, obstacles: [], footprint: fp, facingSheetDeg: 0, rotationsDeg: [0] }).count).toBe(0)
  })
  it('refuses a roof that is not a simple polygon', () => {
    const fp = moduleFootprint({ module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 0, gapM: 0.02, rowPitchM: null })
    expect(() => autoFill({ roof: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 0 }, { x: 0, y: 5 }], setbackM: 0, obstacles: [], footprint: fp, facingSheetDeg: 0, rotationsDeg: [0] }))
      .toThrow('roof outline crosses itself')
  })
  it('works for a roof that faces a skewed bearing (rotated frame)', () => {
    const fp = moduleFootprint({ module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 0, gapM: 0.02, rowPitchM: null })
    // The 20 × 12 roof rotated 30° about the origin, facing 30°: same count as the unrotated roof facing 0°.
    const rot = (p: Pt): Pt => ({ x: p.x * Math.cos(Math.PI / 6) - p.y * Math.sin(Math.PI / 6), y: p.x * Math.sin(Math.PI / 6) + p.y * Math.cos(Math.PI / 6) })
    const straight = autoFill({ roof: rect(0, 0, 20, 12), setbackM: 0.5, obstacles: [], footprint: fp, facingSheetDeg: 0, rotationsDeg: [0] })
    const skewed = autoFill({ roof: rect(0, 0, 20, 12).map(rot), setbackM: 0.5, obstacles: [], footprint: fp, facingSheetDeg: 30, rotationsDeg: [0] })
    expect(skewed.count).toBe(straight.count)
  })
})
