/**
 * tenants.status_plan_shapes rows ↔ what the canvas holds.
 * The shared mapper (slice 1) validates points exactly as the CHECK does.
 */
import { statusPlanShapeFromRow, type AreaType, type StatusPlanShapeRow } from '@esite/shared/status-plans'
import type { CanvasShape } from './types'

export const SHAPE_COLUMNS =
  'id, status_plan_id, shape, points, node_id, area_type, detected_tag, source, created_by, created_at, updated_at'

export function toCanvasShape(row: StatusPlanShapeRow): CanvasShape {
  const s = statusPlanShapeFromRow(row)
  return {
    id: s.id,
    shape: s.shape,
    points: s.points,
    nodeId: s.nodeId,
    areaType: s.areaType,
    detectedTag: s.detectedTag,
    source: s.source,
    updatedAt: s.updatedAt,
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
