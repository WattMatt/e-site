import { describe, it, expect } from 'vitest'
import { planModuleBlock, snapToSetback } from './block-plan'
import { GENERIC_MODULE_550 as M, type RoofObject } from '@esite/shared'

const roof: RoofObject = { id: 'R', kind: 'roof', pixelsPerMeter: 10, geometry: { points: [0, 0, 200, 0, 200, 120, 0, 120] },
  props: { name: 'Flat', roofType: 'flat', pitchDeg: 0, fallBearingDeg: null, heightM: 6, setbackM: 0.5, maxLoadKgM2: null } }

describe('snapToSetback', () => {
  it('pulls a start point near an edge onto the setback line (metres)', () => {
    const p = snapToSetback({ x: 0.2, y: 3 }, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 12 }, { x: 0, y: 12 }], 0.5, 1)
    expect(p.x).toBeCloseTo(0.5, 9)
    expect(p.y).toBe(3)
  })
  it('leaves a point far from every edge alone', () => {
    expect(snapToSetback({ x: 5, y: 5 }, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 12 }, { x: 0, y: 12 }], 0.5, 1)).toEqual({ x: 5, y: 5 })
  })
})

describe('planModuleBlock', () => {
  it('fills the dragged rectangle with whole modules from the snapped corner', () => {
    // Drag from (3 px, 5 px) → near the left edge → snapped to x = 5 px (0.5 m); to (60 px, 60 px).
    const p = planModuleBlock({ roof, obstructions: [], sheetPixelsPerMeter: 10, startPx: { x: 3, y: 5 }, endPx: { x: 60, y: 60 },
      module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 0, facingSheetDeg: 0, gapM: 0.02, rowPitchM: null }, 'B')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    // Across 0.5→6.0 m = 5.5 m: 4 columns (4 × 1.154 − 0.02 = 4.596 ≤ 5.5 < 5.75); along 0.5→6.0 m: 2 rows of 2.278 + gap.
    expect(p.object.geometry.modules).toHaveLength(8)
    expect(p.object.kind).toBe('module_block')
  })
  it('refuses a block with no room for one module', () => {
    const p = planModuleBlock({ roof, obstructions: [], sheetPixelsPerMeter: 10, startPx: { x: 50, y: 50 }, endPx: { x: 55, y: 55 },
      module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 0, facingSheetDeg: 0, gapM: 0.02, rowPitchM: null }, 'B')
    expect(p).toEqual({ ok: false, error: 'No whole module fits in that rectangle inside the roof setback.' })
  })
})

describe('review fix: a pitched roof needs its fall line before a block', () => {
  it('refuses rather than foreshortening along sheet-up', () => {
    const pitched = { id: 'R', kind: 'roof' as const, pixelsPerMeter: 10, geometry: { points: [0, 0, 200, 0, 200, 120, 0, 120] },
      props: { name: 'P', roofType: 'pitched' as const, pitchDeg: 30, fallBearingDeg: null, heightM: 6, setbackM: 0.5, maxLoadKgM2: null } }
    const r = planModuleBlock({ roof: pitched, obstructions: [], sheetPixelsPerMeter: 10, startPx: { x: 10, y: 10 }, endPx: { x: 100, y: 100 },
      module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 30, facingSheetDeg: 0, gapM: 0.02, rowPitchM: null }, 'B')
    expect(r).toEqual({ ok: false, error: "Draw the roof's fall line first (Properties → Draw fall line)." })
  })
})
