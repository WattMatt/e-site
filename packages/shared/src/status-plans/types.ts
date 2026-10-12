/**
 * Status plans — shared shapes (spec 2026-10-09 §4).
 *
 * A status plan is one page of a drawing marked with a purpose. Its shapes
 * store geometry + link + type ONLY: image-space pixels of the page at the
 * fixed scale-2 raster (apps/web/src/lib/sheet), flat [x0, y0, x1, y1, …].
 * Status, colour, hatch and area are derived, never stored.
 *
 * The constants below mirror the CHECKs in the status-plans migration;
 * types.test.ts reads the migration and fails if they drift.
 */

import { isSelfIntersecting, shapeAreaPx } from './geometry'

export const STATUS_PLAN_PURPOSES = ['tenant_layout', 'distribution_schematic'] as const
export type StatusPlanPurpose = (typeof STATUS_PLAN_PURPOSES)[number]

export const AREA_TYPES = ['common', 'plant_room', 'services', 'vacant'] as const
export type AreaType = (typeof AREA_TYPES)[number]

export const AREA_TYPE_LABEL: Record<AreaType, string> = {
  common: 'Mall / common area',
  plant_room: 'Plant / electrical room',
  services: 'Services / back-of-house',
  vacant: 'Vacant / future',
}

export const PURPOSE_LABEL: Record<StatusPlanPurpose, string> = {
  tenant_layout: 'Tenant layout',
  distribution_schematic: 'Distribution schematic',
}

export const SHAPE_KINDS = ['polygon', 'rect'] as const
export type ShapeKind = (typeof SHAPE_KINDS)[number]

export const SHAPE_SOURCES = ['manual', 'detected'] as const
export type ShapeSource = (typeof SHAPE_SOURCES)[number]

/** structure.node_orders.status. Same union as the tenant schedule report's OrderStatus. */
export type NodeOrderStatus = 'by_tenant' | 'required' | 'ordered' | 'received'

/** A tenant's scope-of-work state, as the tenant schedule report computes it. */
export type ScopeState = 'awaited' | 'received' | 'not_required'

/** The database's cap on numbers in `points` (2,000 corners). */
export const MAX_POINT_VALUES = 4000

/**
 * Flat or collapsed: a zero-extent box, or zero area without crossing itself.
 * (A bow-tie also has zero signed area; that is a crossing, not "no area".)
 */
function hasNoArea(pts: number[]): boolean {
  const xs = pts.filter((_, i) => i % 2 === 0)
  const ys = pts.filter((_, i) => i % 2 === 1)
  const flat = Math.max(...xs) - Math.min(...xs) < 1e-6 || Math.max(...ys) - Math.min(...ys) < 1e-6
  return flat || (shapeAreaPx(pts) < 1e-6 && !isSelfIntersecting(pts))
}

/**
 * The status_plan_shapes_points_shape CHECK as a sentence, or null when the
 * points would be accepted. Server actions return this instead of letting the
 * database refuse with a constraint name.
 */
export function pointsError(shape: ShapeKind, points: unknown): string | null {
  if (!Array.isArray(points)) return 'A shape needs a list of points.'
  if (points.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return 'Every point must be a number.'
  if (points.length % 2 !== 0) return 'Points come in x, y pairs.'
  if (points.length < 6) return 'A shape needs at least three corners.'
  if (points.length > MAX_POINT_VALUES) return 'This shape has too many corners (2,000 at most).'
  if (shape === 'rect' && points.length !== 8) return 'A rectangle has exactly four corners.'
  if (hasNoArea(points as number[])) {
    return shape === 'rect' ? 'The rectangle has no area — drag it larger.' : 'The outline has no area — move the corners apart.'
  }
  if (isSelfIntersecting(points as number[])) return 'The outline crosses itself — redraw it without crossing lines.'
  return null
}

/** tenants.status_plans as PostgREST returns it. */
export interface StatusPlanRow {
  id: string
  project_id: string
  organisation_id: string
  floor_plan_id: string
  page_index: number
  purpose: StatusPlanPurpose
  name: string
  source_file_path: string
  created_by: string | null
  created_at: string
  updated_at: string
}

/** tenants.status_plan_shapes as PostgREST returns it. */
export interface StatusPlanShapeRow {
  id: string
  status_plan_id: string
  shape: ShapeKind
  points: unknown
  node_id: string | null
  area_type: AreaType | null
  detected_tag: string | null
  source: ShapeSource
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface StatusPlan {
  id: string
  projectId: string
  organisationId: string
  floorPlanId: string
  pageIndex: number
  purpose: StatusPlanPurpose
  name: string
  sourceFilePath: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface StatusPlanShape {
  id: string
  statusPlanId: string
  shape: ShapeKind
  points: number[]
  nodeId: string | null
  areaType: AreaType | null
  detectedTag: string | null
  source: ShapeSource
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export function statusPlanFromRow(r: StatusPlanRow): StatusPlan {
  return {
    id: r.id,
    projectId: r.project_id,
    organisationId: r.organisation_id,
    floorPlanId: r.floor_plan_id,
    pageIndex: r.page_index,
    purpose: r.purpose,
    name: r.name,
    sourceFilePath: r.source_file_path,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function statusPlanShapeFromRow(r: StatusPlanShapeRow): StatusPlanShape {
  const err = pointsError(r.shape, r.points)
  if (err) throw new Error(`status_plan_shapes ${r.id}: ${err}`)
  return {
    id: r.id,
    statusPlanId: r.status_plan_id,
    shape: r.shape,
    points: (r.points as number[]).map(Number),
    nodeId: r.node_id,
    areaType: r.area_type,
    detectedTag: r.detected_tag,
    source: r.source,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}
