/**
 * tenants.status_plan_shapes rows ↔ what the canvas holds.
 * The shared mapper (slice 1) validates points exactly as the CHECK does.
 */
import { pointsError, type AreaType, type StatusPlanShapeRow } from '@esite/shared/status-plans'
import type { CanvasShape } from './types'

export const SHAPE_COLUMNS =
  'id, status_plan_id, shape, points, node_id, area_type, detected_tag, source, created_by, created_at, updated_at'

/** The sentence shown for a stored outline the checks would refuse today. */
export const OUTLINE_NEEDS_REDRAWING = 'Outline needs redrawing'

function readPoints(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length % 2 !== 0) return null
  const out = v.map((x) => (typeof x === 'number' || (typeof x === 'string' && x.trim() !== '') ? Number(x) : Number.NaN))
  return out.every(Number.isFinite) ? out : null
}

/**
 * Tolerant: one bad stored row must never take the whole page down for every
 * role. A row whose points fail pointsError (e.g. a self-intersection the DB
 * CHECK does not enforce) is KEPT with its points and `invalidReason`, so it
 * can be selected and deleted; points that cannot even be read are kept with
 * no points. The canvas draws neither as a normal shape.
 */
export function toCanvasShape(row: StatusPlanShapeRow): CanvasShape {
  const pts = readPoints(row.points)
  const invalid = pts === null || pointsError(row.shape, pts) !== null
  return {
    id: row.id,
    shape: row.shape,
    points: pts ?? [],
    nodeId: row.node_id,
    areaType: row.area_type,
    detectedTag: row.detected_tag,
    source: row.source,
    updatedAt: row.updated_at,
    ...(invalid ? { invalidReason: OUTLINE_NEEDS_REDRAWING } : {}),
  }
}

/** 0.01 image px is far below anything a mouse can place; it keeps the JSON short. */
export function roundPoints(points: readonly number[], dp = 2): number[] {
  const f = 10 ** dp
  return points.map((v) => Math.round(v * f) / f)
}

export interface ShapePatch {
  points?: number[]
  /** null unlinks. A board link clears the area type (CHECK link_or_area). */
  nodeId?: string | null
  /** null clears. An area type clears the board link. */
  areaType?: AreaType | null
}

export function shapePatchRow(p: ShapePatch): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (p.points !== undefined) row.points = p.points
  if (p.nodeId !== undefined) {
    row.node_id = p.nodeId
    if (p.nodeId !== null) row.area_type = null
  }
  if (p.areaType !== undefined) {
    row.area_type = p.areaType
    if (p.areaType !== null) row.node_id = null
  }
  return row
}
