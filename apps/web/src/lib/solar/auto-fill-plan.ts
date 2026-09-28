/**
 * Auto-fill (functional spec §6.3 "F", engine spec §3.1) from the canvas's
 * objects to a new array object in IMAGE PIXELS. Pure; the dialog previews the
 * result and Place pushes it onto the history.
 *
 * Mounting rules:
 *   pitched roof           → flush, tilt = roof pitch, facing = drawn fall line
 *   mode 'racked'          → racked rows at `tiltDeg`, facing the equator
 *                            (needs north + latitude), row pitch D-11 or manual
 *   mode 'flat'            → flat-mounted (tilt 0), grid tried at 0° and 90°
 */
import {
  autoFill, autoRowPitch, equatorFacingAzimuth, isCircleGeometry, manualRowPitch, moduleFootprint, mToPx, pxToM,
  sheetBearingForAzimuth, type ArrayObject, type LayoutModuleSpec, type ModuleOrientation, type Obstacle,
  type ObstructionObject, type RoofObject,
} from '@esite/shared'

export interface AutoFillRequest {
  roof: RoofObject
  obstructions: ObstructionObject[]
  sheetPixelsPerMeter: number | null
  latDeg: number | null
  northBearingDeg: number | null
  module: LayoutModuleSpec
  orientation: ModuleOrientation
  mode: 'racked' | 'flat'
  tiltDeg: number
  rowSpacing: { kind: 'auto' } | { kind: 'manual'; pitchM: number }
  gapMm: number
  shadeFree: { fromHour: number; toHour: number }
}

export type AutoFillPlan =
  | { ok: true; object: ArrayObject; count: number; alphaDeg: number | null }
  | { ok: false; error: string }

export function obstaclesInMetres(obstructions: ObstructionObject[], fallbackPpm: number): Obstacle[] {
  return obstructions.map((o) => {
    const ppm = o.pixelsPerMeter ?? fallbackPpm
    return isCircleGeometry(o.geometry)
      ? { kind: 'circle' as const, centre: { x: o.geometry.cx / ppm, y: o.geometry.cy / ppm }, radiusM: o.geometry.r / ppm, setbackM: o.props.setbackM }
      : { kind: 'polygon' as const, points: pxToM(o.geometry.points, ppm), setbackM: o.props.setbackM }
  })
}

export function planAutoFill(req: AutoFillRequest, newId: string): AutoFillPlan {
  const ppm = req.roof.pixelsPerMeter ?? req.sheetPixelsPerMeter
  if (!ppm) return { ok: false, error: 'This drawing page has no scale yet — calibrate it before drawing.' }
  const gapM = req.gapMm / 1000
  const pitched = req.roof.props.roofType === 'pitched'
  let facingSheetDeg = 0
  let tiltDeg = 0
  let mounting: 'flush' | 'racked' = 'flush'
  let rotationsDeg = [0, 90]
  let rowPitchM: number | null = null
  let alphaDeg: number | null = null

  try {
    if (pitched) {
      if (req.roof.props.fallBearingDeg === null) return { ok: false, error: "Draw the roof's fall line first (Properties → Draw fall line)." }
      facingSheetDeg = req.roof.props.fallBearingDeg
      tiltDeg = req.roof.props.pitchDeg
      rotationsDeg = [0]
    } else if (req.mode === 'racked') {
      if (req.latDeg === null) return { ok: false, error: 'Set the site location in Site & Supply first — row spacing depends on latitude.' }
      if (req.northBearingDeg === null) return { ok: false, error: 'Set north first (N) — racked rows face the equator.' }
      mounting = 'racked'
      tiltDeg = req.tiltDeg
      facingSheetDeg = sheetBearingForAzimuth(equatorFacingAzimuth(req.latDeg), req.northBearingDeg)
      rotationsDeg = [0]
      const slope = req.orientation === 'portrait' ? req.module.lengthM : req.module.widthM
      const p = req.rowSpacing.kind === 'auto'
        ? autoRowPitch({ slopeLengthM: slope, tiltDeg, latDeg: req.latDeg, fromHour: req.shadeFree.fromHour, toHour: req.shadeFree.toHour })
        : manualRowPitch({ slopeLengthM: slope, tiltDeg, pitchM: req.rowSpacing.pitchM })
      rowPitchM = p.pitchM
      alphaDeg = p.alphaDeg
    }
    const footprint = moduleFootprint({ module: req.module, orientation: req.orientation, mounting, tiltDeg, gapM, rowPitchM })
    const result = autoFill({
      roof: pxToM(req.roof.geometry.points, ppm),
      setbackM: req.roof.props.setbackM,
      obstacles: obstaclesInMetres(req.obstructions, ppm),
      footprint,
      facingSheetDeg,
      rotationsDeg,
    })
    const object: ArrayObject = {
      id: newId,
      kind: 'array',
      pixelsPerMeter: null,
      geometry: { modules: result.modules.map((q) => mToPx(q, ppm)) },
      props: {
        roofId: req.roof.id, module: req.module, orientation: req.orientation, mounting, tiltDeg,
        facingSheetDeg: (facingSheetDeg + result.rotationDeg) % 360, azimuthOverrideDeg: null,
        rowPitchM: footprint.stepAlongM, gapM,
      },
    }
    return { ok: true, object, count: result.count, alphaDeg }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Auto-fill failed.' }
  }
}
