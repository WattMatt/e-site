/**
 * Everything the status-plan canvas page needs, read through the CALLER'S
 * session: RLS and site scope (00238, 00245) are the read gate, so a plan the
 * caller may not see is simply absent and the page 404s. No service client.
 *
 * buildStatusPlanPageProps is the only place the props are assembled, and it
 * produces JSON only (checked in the test with jsonUnsafePath): page.tsx
 * spreads its result into one client component and adds nothing.
 */
import { ORG_WRITE_ROLES } from '@esite/shared'
import {
  statusPlanFromRow,
  type NodeOrderStatus,
  type ShopLink,
  type StatusPlan,
  type StatusPlanRow,
  type StatusPlanShapeRow,
} from '@esite/shared/status-plans'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { readAll } from '@/lib/tender/read-all'
import { loadTenantShopFacts } from '@/lib/tenant-schedule/shop-facts'
import type { PageScaleRow } from '@/lib/sheet/page-scale'
import { shopLinkFor } from './shop-link'
import { loadProjectDbOrderStatus } from './project-db-orders'
import { SHAPE_COLUMNS, toCanvasShape } from './canvas-shape'
import { isPdfPath, isRenderableDrawing } from './plan-urls'
import type { CanvasShape, PlanNode, StatusPlanPageProps } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const SIGNED_URL_SECONDS = 3600

export interface PlanPageRaw {
  projectId: string
  plan: StatusPlan
  drawing: { id: string; name: string; filePath: string; widthPx: number | null; heightPx: number | null; pixelsPerMeter: number | null }
  signedUrl: string | null
  pageScales: PageScaleRow[]
  shapes: CanvasShape[]
  nodes: PlanNode[]
  shopLinks: Record<string, ShopLink>
  dbOrders: Record<string, NodeOrderStatus>
  today: string
  canEdit: boolean
  requestedShapeId: string | null
}

export function buildStatusPlanPageProps(raw: PlanPageRaw): StatusPlanPageProps {
  return {
    projectId: raw.projectId,
    plan: {
      id: raw.plan.id,
      name: raw.plan.name,
      purpose: raw.plan.purpose,
      pageIndex: raw.plan.pageIndex,
      sourceFilePath: raw.plan.sourceFilePath,
      updatedAt: raw.plan.updatedAt,
    },
    sheet: {
      floorPlanId: raw.drawing.id,
      name: raw.drawing.name,
      signedUrl: raw.signedUrl,
      isPdf: isPdfPath(raw.drawing.filePath),
      widthPx: raw.drawing.widthPx,
      heightPx: raw.drawing.heightPx,
      currentFilePath: raw.drawing.filePath,
      pixels_per_meter: raw.drawing.pixelsPerMeter,
      page_scales: raw.pageScales,
    },
    shapes: raw.shapes,
    nodes: raw.nodes,
    shopLinks: raw.shopLinks,
    dbOrders: raw.dbOrders,
    today: raw.today,
    canEdit: raw.canEdit,
    initialShapeId: raw.requestedShapeId && raw.shapes.some((s) => s.id === raw.requestedShapeId) ? raw.requestedShapeId : null,
  }
}

/** yyyy-mm-dd on the South African calendar: overdue is a local-date question. */
export function johannesburgDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(now)
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

export async function loadStatusPlanPage(
  client: unknown,
  args: { projectId: string; planId: string; requestedShapeId: string | null },
): Promise<StatusPlanPageProps | null> {
  const db = client as any

  const { data: planRow } = await db.schema('tenants').from('status_plans')
    .select('id, project_id, organisation_id, floor_plan_id, page_index, purpose, name, source_file_path, created_by, created_at, updated_at')
    .eq('id', args.planId).maybeSingle()
  if (!planRow || planRow.project_id !== args.projectId) return null
  const plan = statusPlanFromRow(planRow as StatusPlanRow)

  const { data: drawingRow } = await db.schema('tenants').from('floor_plans')
    .select('id, name, file_path, width_px, height_px, pixels_per_meter')
    .eq('id', plan.floorPlanId).maybeSingle()
  if (!drawingRow) return null
  const filePath = String(drawingRow.file_path ?? '')

  let signedUrl: string | null = null
  if (isRenderableDrawing(filePath)) {
    const { data } = await db.storage.from('drawings').createSignedUrl(filePath, SIGNED_URL_SECONDS)
    signedUrl = data?.signedUrl ?? null
  }

  const [scalesRes, shapesRes, projectRes] = await Promise.all([
    db.schema('tenants').from('floor_plan_page_scales').select('page_index, pixels_per_meter').eq('floor_plan_id', plan.floorPlanId),
    readAll<StatusPlanShapeRow>((from, to) =>
      db.schema('tenants').from('status_plan_shapes').select(SHAPE_COLUMNS)
        .eq('status_plan_id', plan.id).order('created_at').order('id').range(from, to)),
    db.schema('projects').from('projects').select('id, organisation_id, opening_date').eq('id', args.projectId).maybeSingle(),
  ])
  if ('error' in shapesRes) throw new Error(`status plan shapes: ${shapesRes.error}`)
  if (!projectRes.data) return null
  const orgId = projectRes.data.organisation_id as string
  const openingDate = (projectRes.data.opening_date as string | null) ?? null

  const nodesRes = await readAll<any>((from, to) => {
    let q = db.schema('structure').from('nodes')
      .select('id, code, kind, shop_number, shop_name, name, shop_area_m2, status')
      .eq('project_id', args.projectId).is('deleted_at', null)
    if (plan.purpose === 'tenant_layout') q = q.eq('kind', 'tenant_db')
    return q.order('id').range(from, to)
  })
  if ('error' in nodesRes) throw new Error(`status plan nodes: ${nodesRes.error}`)
  const nodes: PlanNode[] = nodesRes.data.map((n) => ({
    id: n.id,
    code: n.code ?? '—',
    kind: n.kind,
    shopNumber: n.shop_number ?? null,
    shopName: n.shop_name ?? n.name ?? null,
    scheduledM2: num(n.shop_area_m2),
    decommissioned: n.status === 'decommissioned',
  }))

  let shopLinks: Record<string, ShopLink> = {}
  let dbOrders: Record<string, NodeOrderStatus> = {}
  if (plan.purpose === 'tenant_layout') {
    const facts = await loadTenantShopFacts(client, { projectId: args.projectId, orgId, openingDate })
    shopLinks = Object.fromEntries(nodes.map((n) => [n.id, shopLinkFor(facts, n.id)]))
  } else {
    dbOrders = await loadProjectDbOrderStatus(client, { projectId: args.projectId, orgId })
  }

  // `.ok` is read right here: the role-gate contract looks for it within a few lines.
  const gate = await requireEffectiveRole(db, args.projectId, ORG_WRITE_ROLES)
  const canEdit = gate.ok

  return buildStatusPlanPageProps({
    projectId: args.projectId,
    plan,
    drawing: {
      id: drawingRow.id,
      name: drawingRow.name ?? 'Drawing',
      filePath,
      widthPx: num(drawingRow.width_px),
      heightPx: num(drawingRow.height_px),
      pixelsPerMeter: num(drawingRow.pixels_per_meter),
    },
    signedUrl,
    pageScales: ((scalesRes.data ?? []) as any[]).map((r) => ({ pageIndex: Number(r.page_index), pixelsPerMeter: Number(r.pixels_per_meter) })),
    shapes: shapesRes.data.map(toCanvasShape),
    nodes,
    shopLinks,
    dbOrders,
    today: johannesburgDate(new Date()),
    canEdit,
    requestedShapeId: args.requestedShapeId,
  })
}
