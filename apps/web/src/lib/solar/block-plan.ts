/**
 * Place array (manual), tool A (functional spec §6.3): drag a rectangle in the
 * facing frame → rows × columns of whole modules, the first corner snapped to
 * the roof's setback line when dragged from within `snapM` of an edge. Every
 * module is still checked against the roof setback and obstructions.
 */
import {
  moduleFootprint, moduleIsLegal, mToPx, pointInPolygon, pointSegmentDistance, pxToM, rectQuad, sheetDirection,
  type LayoutModuleSpec, type ModuleOrientation, type MountingKind, type ModulesGeometry, type ArrayProps,
  type ObstructionObject, type Pt, type RoofObject,
} from '@esite/shared'
import { obstaclesInMetres } from './auto-fill-plan'

export function snapToSetback(p: Pt, roof: Pt[], setbackM: number, snapM: number): Pt {
  let best: { d: number; a: Pt; b: Pt } | null = null
  for (let i = 0; i < roof.length; i++) {
    const a = roof[i]!
    const b = roof[(i + 1) % roof.length]!
    const d = pointSegmentDistance(p, a, b)
    if (!best || d < best.d) best = { d, a, b }
  }
  if (!best || best.d > snapM) return p
  const len = Math.hypot(best.b.x - best.a.x, best.b.y - best.a.y)
  let n = { x: -(best.b.y - best.a.y) / len, y: (best.b.x - best.a.x) / len }
  const mid = { x: (best.a.x + best.b.x) / 2 + n.x * 1e-3, y: (best.a.y + best.b.y) / 2 + n.y * 1e-3 }
  if (!pointInPolygon(mid, roof)) n = { x: -n.x, y: -n.y }
  const signed = (p.x - best.a.x) * n.x + (p.y - best.a.y) * n.y
  const move = setbackM - signed
  return { x: p.x + n.x * move, y: p.y + n.y * move }
}

export function planModuleBlock(i: {
  roof: RoofObject; obstructions: ObstructionObject[]; sheetPixelsPerMeter: number | null
  startPx: Pt; endPx: Pt; module: LayoutModuleSpec; orientation: ModuleOrientation; mounting: MountingKind
  tiltDeg: number; facingSheetDeg: number; gapM: number; rowPitchM: number | null
}, newId: string): { ok: true; object: { id: string; kind: 'module_block'; pixelsPerMeter: null; geometry: ModulesGeometry; props: ArrayProps } } | { ok: false; error: string } {
  const ppm = i.roof.pixelsPerMeter ?? i.sheetPixelsPerMeter
  if (!ppm) return { ok: false, error: 'This drawing page has no scale yet — calibrate it before drawing.' }
  // Flush on a pitch is foreshortened along the fall line; without one the
  // direction would be invented (the auto-fill planner refuses the same way).
  if (i.roof.props.roofType === 'pitched' && i.roof.props.fallBearingDeg === null) {
    return { ok: false, error: "Draw the roof's fall line first (Properties → Draw fall line)." }
  }
  const roofM = pxToM(i.roof.geometry.points, ppm)
  let fp
  try {
    fp = moduleFootprint({ module: i.module, orientation: i.orientation, mounting: i.mounting, tiltDeg: i.tiltDeg, gapM: i.gapM, rowPitchM: i.rowPitchM })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The module does not fit.' }
  }
  const vh = sheetDirection(i.facingSheetDeg)
  const uh = sheetDirection(i.facingSheetDeg + 90)
  const start = snapToSetback({ x: i.startPx.x / ppm, y: i.startPx.y / ppm }, roofM, i.roof.props.setbackM, 1)
  const end = { x: i.endPx.x / ppm, y: i.endPx.y / ppm }
  const du = (end.x - start.x) * uh.x + (end.y - start.y) * uh.y
  const dv = (end.x - start.x) * vh.x + (end.y - start.y) * vh.y
  const su = Math.sign(du) || 1
  const sv = Math.sign(dv) || 1
  const cols = Math.floor((Math.abs(du) - fp.acrossM) / fp.stepAcrossM + 1e-9) + 1
  const rows = Math.floor((Math.abs(dv) - fp.alongM) / fp.stepAlongM + 1e-9) + 1
  const obstacles = obstaclesInMetres(i.obstructions, ppm)
  const modules: number[][] = []
  for (let r = 0; r < Math.max(0, rows); r++) {
    for (let c = 0; c < Math.max(0, cols); c++) {
      const u0 = su > 0 ? c * fp.stepAcrossM : -(c * fp.stepAcrossM + fp.acrossM)
      const v0 = sv > 0 ? r * fp.stepAlongM : -(r * fp.stepAlongM + fp.alongM)
      const corner = { x: start.x + uh.x * u0 + vh.x * v0, y: start.y + uh.y * u0 + vh.y * v0 }
      const quad = rectQuad(corner, uh, vh, fp.acrossM, fp.alongM)
      if (moduleIsLegal(quad, roofM, i.roof.props.setbackM, obstacles)) modules.push(mToPx(quad, ppm))
    }
  }
  if (modules.length === 0) return { ok: false, error: 'No whole module fits in that rectangle inside the roof setback.' }
  return {
    ok: true,
    object: {
      id: newId, kind: 'module_block', pixelsPerMeter: null, geometry: { modules },
      props: {
        roofId: i.roof.id, module: i.module, orientation: i.orientation, mounting: i.mounting, tiltDeg: i.tiltDeg,
        facingSheetDeg: i.facingSheetDeg, azimuthOverrideDeg: null, rowPitchM: fp.stepAlongM, gapM: i.gapM,
      },
    },
  }
}
