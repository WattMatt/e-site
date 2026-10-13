/**
 * The shapes the tenant plan pages hand their client components, and the
 * result type every tenant plan action returns.
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
  TenantPlanMime,
} from '@esite/shared/status-plans'

/** Never thrown: production redacts thrown server-action messages. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; conflict?: boolean }

/** A signed upload slot handed to the browser (tenant-plan-sheets.actions.ts). */
export interface PreparedUpload {
  path: string
  token: string
  mime: TenantPlanMime
}

/** One sheet of a plan, as the strip, the legend and the actions return it. */
export interface SheetSummary {
  id: string
  label: string
  sortOrder: number
  fileName: string
  mime: TenantPlanMime
  /** 1-based page within the sheet's file. */
  pageIndex: number
  revision: number
  /** Set when the file was replaced and the shapes have not been re-anchored. */
  replacedAt: string | null
  /** The sheet's own scale; null = unscaled (areas show "—"). */
  pixelsPerMeter: number | null
  /** The concurrency token every sheet write must present. */
  updatedAt: string
}

/** The sheet on the canvas: a summary plus what the browser needs to draw it. */
export interface PlanSheet extends SheetSummary {
  signedUrl: string | null
  isPdf: boolean
}

export interface PlanHeader {
  id: string
  name: string
  purpose: StatusPlanPurpose
  updatedAt: string
}

export interface CanvasShape {
  id: string
  /** The sheet the shape is drawn on (its image space). */
  sheetId: string
  shape: ShapeKind
  /** Image space, flat [x0, y0, x1, y1, …]. */
  points: number[]
  nodeId: string | null
  areaType: AreaType | null
  detectedTag: string | null
  source: ShapeSource
  /** The concurrency token every write must present. */
  updatedAt: string
  /** Set (omitted otherwise) when the stored outline fails today's checks; points may then be []. */
  invalidReason?: string
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
  /** Every sheet of the plan, in strip order. */
  sheets: SheetSummary[]
  /** The sheet being drawn on (?sheet=, else the sheet of ?shape=, else the first). */
  sheet: PlanSheet
  /** Every shape of the plan, on every sheet: plan totals and "a board once per plan" need them all. */
  shapes: CanvasShape[]
  /** tenant_db nodes on a floor plan; every live node on a line diagram. */
  nodes: PlanNode[]
  /** nodeId → link, floor plan only ({} on a line diagram). */
  shopLinks: Record<string, ShopLink>
  /** nodeId → DB order status, line diagram only ({} on a floor plan). */
  dbOrders: Record<string, NodeOrderStatus>
  /** yyyy-mm-dd, the server's date: overdue is decided against it. */
  today: string
  canEdit: boolean
  /** From ?shape=, only when that shape is on the current sheet. */
  initialShapeId: string | null
}

/** A plan route with nothing uploaded yet. */
export interface TenantPlanEmptyProps {
  projectId: string
  purpose: StatusPlanPurpose
  canEdit: boolean
}
