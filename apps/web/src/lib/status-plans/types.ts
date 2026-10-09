/**
 * The shapes the status-plan pages hand their client components, and the
 * result type every status-plan action returns.
 *
 * EVERYTHING HERE MUST SURVIVE JSON. A page.tsx → 'use client' prop that is a
 * function, Map, Date or undefined passes tsc and next build and fails only at
 * render (PR #201). `jsonUnsafePath` (json-safe.ts) checks the assembled props
 * at runtime in the loader's test.
 */
import type {
  AreaType,
  NodeOrderStatus,
  ShapeKind,
  ShapeSource,
  ShopLink,
  StatusPlanPurpose,
} from '@esite/shared/status-plans'
import type { PageScaleRow } from '@/lib/sheet/page-scale'

/** Never thrown: production redacts thrown server-action messages. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; conflict?: boolean }

/** The drawing page under the plan. snake_case scale fields match `ScaledSheet`. */
export interface PlanSheet {
  floorPlanId: string
  name: string
  signedUrl: string | null
  isPdf: boolean
  widthPx: number | null
  heightPx: number | null
  /** The drawing's file NOW; compared with the plan's sourceFilePath. */
  currentFilePath: string
  pixels_per_meter: number | null
  page_scales: PageScaleRow[]
}

export interface PlanHeader {
  id: string
  name: string
  purpose: StatusPlanPurpose
  pageIndex: number
  /** The drawing's file when the plan was created (or last re-anchored). */
  sourceFilePath: string
  updatedAt: string
}

export interface CanvasShape {
  id: string
  shape: ShapeKind
  /** Image space, flat [x0, y0, x1, y1, …]. */
  points: number[]
  nodeId: string | null
  areaType: AreaType | null
  detectedTag: string | null
  source: ShapeSource
  /** The concurrency token every write must present. */
  updatedAt: string
}

/** A live (not soft-deleted) project node a shape may link to. */
export interface PlanNode {
  id: string
  code: string
  kind: string
  shopNumber: string | null
  shopName: string | null
  /** structure.nodes.shop_area_m2 — the scheduled area. */
  scheduledM2: number | null
  decommissioned: boolean
}

export interface StatusPlanPageProps {
  projectId: string
  plan: PlanHeader
  sheet: PlanSheet
  shapes: CanvasShape[]
  /** tenant_db nodes on a tenant layout; every live node on a schematic. */
  nodes: PlanNode[]
  /** nodeId → link, tenant layout only ({} on a schematic). */
  shopLinks: Record<string, ShopLink>
  /** nodeId → DB order status, schematic only ({} on a tenant layout). */
  dbOrders: Record<string, NodeOrderStatus>
  /** yyyy-mm-dd, the server's date: overdue is decided against it. */
  today: string
  canEdit: boolean
  /** From ?shape=, only when that shape is on this plan. */
  initialShapeId: string | null
}
