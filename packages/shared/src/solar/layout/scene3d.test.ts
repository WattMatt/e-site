import { describe, it, expect } from 'vitest'
import { buildScene3d, roofHeightAt } from './scene3d'
import { GENERIC_MODULE_550 as M, type LayoutObject, type RoofObject } from './types'

const pitched: RoofObject = { id: 'R', kind: 'roof', pixelsPerMeter: 10, geometry: { points: [0, 0, 120, 0, 120, 70, 0, 70] },
  props: { name: 'P', roofType: 'pitched', pitchDeg: 30, fallBearingDeg: 0, heightM: 5, setbackM: 0.3, maxLoadKgM2: null } }

describe('scene3d', () => {
  it('pitched roof: eaves (downhill, north edge) at height, ridge side higher by depth × tan(pitch)', () => {
    expect(roofHeightAt(pitched, { x: 6, y: 0 })).toBeCloseTo(5, 9)
    expect(roofHeightAt(pitched, { x: 6, y: 7 })).toBeCloseTo(5 + 7 * Math.tan(Math.PI / 6), 9)
  })
  it('a racked module raises its back edge by slope × sin(tilt)', () => {
    const flat: RoofObject = { ...pitched, props: { ...pitched.props, roofType: 'flat', pitchDeg: 0, fallBearingDeg: null } }
    const arr: LayoutObject = { id: 'A', kind: 'array', pixelsPerMeter: 10, geometry: { modules: [[10, 10, 21.34, 10, 21.34, 32.0, 10, 32.0]] },
      props: { roofId: 'R', module: M, orientation: 'portrait', mounting: 'racked', tiltDeg: 15, facingSheetDeg: 0, azimuthOverrideDeg: null, rowPitchM: 3.5, gapM: 0.02 } }
    const scene = buildScene3d([flat, arr])
    const zs = scene.modules[0]!.corners.map((c) => c[2])
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2.278 * Math.sin(Math.PI / 12), 6)
  })
})

describe('scene3d — review fixes', () => {
  const flat: RoofObject = { ...pitched, props: { ...pitched.props, roofType: 'flat', pitchDeg: 0, fallBearingDeg: null } }
  it('positions share ONE frame: an obstruction saved at another scale stays at its drawn pixels', () => {
    const obs: LayoutObject = { id: 'O', kind: 'obstruction', pixelsPerMeter: 20, geometry: { points: [40, 40, 60, 40, 60, 60, 40, 60] }, props: { name: 'O', setbackM: 0.5, heightM: 1 } }
    const scene = buildScene3d([flat, obs], 10)
    expect(scene.obstructions[0]!.base.map((v) => v[0])).toEqual([4, 6, 6, 4])
  })
  it('unsaved objects render with the sheet scale', () => {
    const scene = buildScene3d([{ ...flat, pixelsPerMeter: null }], 10)
    expect(scene.roofs).toHaveLength(1)
    expect(buildScene3d([{ ...flat, pixelsPerMeter: null }]).roofs).toHaveLength(0)
  })
})
