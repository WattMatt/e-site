/**
 * Array auto-fill (engine spec §3.1).
 *
 * Usable area = roof inset by its edge setback, minus each obstruction grown by
 * its own setback. Implemented as a per-module test (quadInsideRoof /
 * quadClear…) rather than polygon offsetting, which is exact for concave roofs
 * and needs no clipping library.
 *
 * Frame: v = the facing direction, u = 90° clockwise of it (both unit vectors
 * in plan metres). Rows advance along v by the footprint's stepAlong; modules
 * advance along u by stepAcross. The grid origin is the roof's frame bounding
 * box corner inset by the setback, shifted by one of 8 offsets.
 *
 * Candidates: every rotation in `rotationsDeg` × GRID_OFFSETS. Best = most
 * modules; tie → fewer partial rows (a row shorter than the longest); tie → the
 * earlier candidate (rotation order, then offset order), so the result is
 * deterministic.
 */
import { EPS, isSimplePolygon, quadClearOfCircle, quadClearOfPolygon, quadInsideRoof, rectQuad } from './geometry'
import { sheetDirection } from './orientation'
import type { Footprint } from './footprint'
import type { Pt } from './types'

export type Obstacle =
  | { kind: 'polygon'; points: Pt[]; setbackM: number }
  | { kind: 'circle'; centre: Pt; radiusM: number; setbackM: number }

export interface AutoFillInput {
  /** Roof outline, plan metres. */
  roof: Pt[]
  setbackM: number
  obstacles: Obstacle[]
  footprint: Footprint
  /** Sheet bearing the modules face. */
  facingSheetDeg: number
  /** [0] when the facing is fixed (racked rows, flush on a pitch); [0, 90] for flat-mounted modules. */
  rotationsDeg: number[]
}

export interface GridResult {
  modules: Pt[][]
  rowCounts: number[]
}

export interface AutoFillResult extends GridResult {
  count: number
  rotationDeg: number
  offsetIndex: number
}

export const GRID_OFFSETS = 8

export function gridOffset(k: number, stepAcross: number, stepAlong: number): { du: number; dv: number } {
  return { du: ((k % 4) / 4) * stepAcross, dv: (Math.floor(k / 4) / 2) * stepAlong }
}

export function moduleIsLegal(quad: Pt[], roof: Pt[], setbackM: number, obstacles: Obstacle[]): boolean {
  if (!quadInsideRoof(quad, roof, setbackM)) return false
  for (const o of obstacles) {
    if (o.kind === 'polygon' && !quadClearOfPolygon(quad, o.points, o.setbackM)) return false
    if (o.kind === 'circle' && !quadClearOfCircle(quad, o.centre, o.radiusM, o.setbackM)) return false
  }
  return true
}

export function placeGrid(input: AutoFillInput, rotationDeg: number, offsetIndex: number): GridResult {
  const f = input.footprint
  const vh = sheetDirection(input.facingSheetDeg + rotationDeg)
  const uh = sheetDirection(input.facingSheetDeg + rotationDeg + 90)
  const us = input.roof.map((p) => p.x * uh.x + p.y * uh.y)
  const vs = input.roof.map((p) => p.x * vh.x + p.y * vh.y)
  const minU = Math.min(...us)
  const maxU = Math.max(...us)
  const minV = Math.min(...vs)
  const maxV = Math.max(...vs)
  const { du, dv } = gridOffset(offsetIndex, f.stepAcrossM, f.stepAlongM)
  const toPlan = (u: number, v: number): Pt => ({ x: u * uh.x + v * vh.x, y: u * uh.y + v * vh.y })

  const modules: Pt[][] = []
  const rowCounts: number[] = []
  for (let v = minV + input.setbackM + dv; v + f.alongM <= maxV - input.setbackM + EPS; v += f.stepAlongM) {
    let n = 0
    for (let u = minU + input.setbackM + du; u + f.acrossM <= maxU - input.setbackM + EPS; u += f.stepAcrossM) {
      const quad = rectQuad(toPlan(u, v), uh, vh, f.acrossM, f.alongM)
      if (moduleIsLegal(quad, input.roof, input.setbackM, input.obstacles)) {
        modules.push(quad)
        n++
      }
    }
    rowCounts.push(n)
  }
  return { modules, rowCounts }
}

function partialRows(rowCounts: number[]): number {
  const longest = Math.max(0, ...rowCounts)
  return rowCounts.filter((n) => n > 0 && n < longest).length
}

/** Negative when `a` is better than `b`; 0 when equal (the caller keeps the earlier one). */
export function compareCandidates(a: { count: number; partialRows: number }, b: { count: number; partialRows: number }): number {
  if (a.count !== b.count) return b.count - a.count
  return a.partialRows - b.partialRows
}

export function autoFill(input: AutoFillInput): AutoFillResult {
  if (!isSimplePolygon(input.roof)) throw new Error('The roof outline crosses itself; redraw it.')
  if (!(input.setbackM >= 0)) throw new Error('The edge setback cannot be negative.')
  let best: (AutoFillResult & { partialRows: number }) | null = null
  for (const rotationDeg of input.rotationsDeg) {
    for (let k = 0; k < GRID_OFFSETS; k++) {
      const g = placeGrid(input, rotationDeg, k)
      const cand = { ...g, count: g.modules.length, rotationDeg, offsetIndex: k, partialRows: partialRows(g.rowCounts) }
      if (best === null || compareCandidates(cand, best) < 0) best = cand
    }
  }
  if (best === null) return { modules: [], rowCounts: [], count: 0, rotationDeg: 0, offsetIndex: 0 }
  const { partialRows: _p, ...result } = best
  return result
}
