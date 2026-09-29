/**
 * A read-only 3D scene for the Layout preview (functional spec §6.3 "3D
 * preview"): roofs as planes at their height (pitched ones rising up-slope
 * from the eaves), modules lying on them (flush) or tilted on racks, and
 * obstructions as prisms. Metres; x east-ish = plan x, y = −plan y, z up. Pure.
 *
 * Positions share one image space, so every position is converted with ONE
 * frame scale: `framePpm` (the sheet's current scale) when given, else the
 * first saved object's. Unsaved objects therefore render too.
 */
import { flatToPts, pointInPolygon, pxToM, vertexMean } from './geometry'
import { sheetDirection } from './orientation'
import { isArrayObject, isCircleGeometry, type LayoutObject, type Pt, type RoofObject } from './types'

export type Vec3 = [number, number, number]
export interface Scene3D {
  roofs: Array<{ id: string; top: Vec3[] }>
  modules: Array<{ arrayId: string; corners: Vec3[] }>
  obstructions: Array<{ id: string; base: Vec3[]; heightM: number }>
}

const RACK_CLEARANCE_M = 0.1
const FLUSH_STANDOFF_M = 0.05

function roofM(r: RoofObject, frame: number | null = r.pixelsPerMeter): Pt[] {
  return frame ? pxToM(r.geometry.points, frame) : []
}

/** Roof surface height at a plan point (metres), `p` in the same frame as `frame`. */
export function roofHeightAt(r: RoofObject, p: Pt, frame: number | null = r.pixelsPerMeter): number {
  if (r.props.roofType !== 'pitched' || r.props.fallBearingDeg === null || r.props.pitchDeg === 0) return r.props.heightM
  const d = sheetDirection(r.props.fallBearingDeg)
  const maxProj = Math.max(...roofM(r, frame).map((v) => v.x * d.x + v.y * d.y))
  return r.props.heightM + (maxProj - (p.x * d.x + p.y * d.y)) * Math.tan((r.props.pitchDeg * Math.PI) / 180)
}

const v3 = (p: Pt, z: number): Vec3 => [p.x, -p.y, z]

export function buildScene3d(objects: LayoutObject[], framePpm: number | null = null): Scene3D {
  const frame = framePpm ?? objects.find((o) => o.pixelsPerMeter !== null)?.pixelsPerMeter ?? null
  const scene: Scene3D = { roofs: [], modules: [], obstructions: [] }
  if (!frame) return scene
  const roofs = objects.filter((o): o is RoofObject => o.kind === 'roof')
  const roofOf = (p: Pt) => roofs.find((r) => pointInPolygon(p, roofM(r, frame)))
  const height = (r: RoofObject, p: Pt) => roofHeightAt(r, p, frame)
  for (const r of roofs) scene.roofs.push({ id: r.id, top: roofM(r, frame).map((p) => v3(p, height(r, p))) })
  for (const a of objects.filter(isArrayObject)) {
    const f = sheetDirection(a.props.facingSheetDeg)
    const rise = a.props.mounting === 'racked'
      ? (a.props.orientation === 'portrait' ? a.props.module.lengthM : a.props.module.widthM) * Math.sin((a.props.tiltDeg * Math.PI) / 180)
      : 0
    for (const q of a.geometry.modules) {
      const pts = pxToM(q, frame)
      const proj = pts.map((p) => p.x * f.x + p.y * f.y)
      const lo = Math.min(...proj), hi = Math.max(...proj)
      const roof = roofOf(vertexMean(pts))
      scene.modules.push({
        arrayId: a.id,
        corners: pts.map((p, i) => {
          const base = roof ? height(roof, p) : 0
          if (a.props.mounting === 'flush') return v3(p, base + FLUSH_STANDOFF_M)
          const t = hi > lo ? (proj[i]! - lo) / (hi - lo) : 0
          return v3(p, base + RACK_CLEARANCE_M + (1 - t) * rise)
        }),
      })
    }
  }
  for (const o of objects) {
    if (o.kind !== 'obstruction') continue
    const ppm = frame
    const pts = isCircleGeometry(o.geometry)
      ? Array.from({ length: 16 }, (_, i) => ({ x: (o.geometry as { cx: number }).cx / ppm + Math.cos((i / 16) * 2 * Math.PI) * (o.geometry as { r: number }).r / ppm, y: (o.geometry as { cy: number }).cy / ppm + Math.sin((i / 16) * 2 * Math.PI) * (o.geometry as { r: number }).r / ppm }))
      : flatToPts(o.geometry.points).map((p) => ({ x: p.x / ppm, y: p.y / ppm }))
    const roof = roofOf(vertexMean(pts))
    const z = roof ? height(roof, vertexMean(pts)) : 0
    scene.obstructions.push({ id: o.id, base: pts.map((p) => v3(p, z)), heightM: o.props.heightM })
  }
  return scene
}
