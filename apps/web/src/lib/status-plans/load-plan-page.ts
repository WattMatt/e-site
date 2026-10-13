/**
 * Everything a tenant plan route needs, read through the CALLER'S session:
 * RLS and site scope (00238, 00245, 00249) are the read gate, so a project the
 * caller may not see answers null and the page 404s. No service client; the
 * sheet's signed URL is minted through the session too (the bucket's read
 * policy admits every project member).
 *
 * buildStatusPlanPageProps is the only place the canvas props are assembled,
 * and it produces JSON only (checked in the test with jsonUnsafePath): the
 * route pages spread its result into one client component and add nothing.
 */
import { ORG_WRITE_ROLES } from '@esite/shared'
import {
  TENANT_PLAN_BUCKET,
  statusPlanFromRow,
  type NodeOrderStatus,
  type ShopLink,
  type StatusPlan,
  type StatusPlanPurpose,
  type StatusPlanRow,
  type StatusPlanShapeRow,
  type StatusPlanSheetRow,
} from '@esite/shared/status-plans'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { readAll } from '@/lib/tender/read-all'
import { loadTenantShopFacts } from '@/lib/tenant-schedule/shop-facts'
import { shopLinkFor } from './shop-link'
import { loadProjectFeedGraph, planFeedFrom } from './feed-graph'
import { loadProjectDbOrderStatus } from './project-db-orders'
import { SHAPE_COLUMNS, toCanvasShape } from './canvas-shape'
import { SHEET_COLUMNS, toSheetSummary } from './sheet-row'
import type { CanvasShape, ColourBy, PlanFeed, PlanNode, SheetSummary, StatusPlanPageProps, TenantPlanEmptyProps } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const SIGNED_URL_SECONDS = 3600
export const PLAN_COLUMNS = 'id, project_id, organisation_id, purpose, name, created_by, created_at, updated_at'

export interface PlanPageRaw {
  projectId: string
  plan: StatusPlan
  sheets: SheetSummary[]
  current: SheetSummary
  signedUrl: string | null
  shapes: CanvasShape[]
  nodes: PlanNode[]
  shopLinks: Record<string, ShopLink>
  dbOrders: Record<string, NodeOrderStatus>
  today: string
  canEdit: boolean
  requestedShapeId: string | null
  feed: PlanFeed | null
  colourBy: ColourBy
}

export function buildStatusPlanPageProps(raw: PlanPageRaw): StatusPlanPageProps {
  const selectable = raw.requestedShapeId
    && raw.shapes.some((s) => s.id === raw.requestedShapeId && s.sheetId === raw.current.id)
  return {
    projectId: raw.projectId,
    plan: { id: raw.plan.id, name: raw.plan.name, purpose: raw.plan.purpose, updatedAt: raw.plan.updatedAt },
    sheets: raw.sheets,
    sheet: { ...raw.current, signedUrl: raw.signedUrl, isPdf: raw.current.mime === 'application/pdf' },
    shapes: raw.shapes,
    nodes: raw.nodes,
    shopLinks: raw.shopLinks,
    dbOrders: raw.dbOrders,
    today: raw.today,
    canEdit: raw.canEdit,
    initialShapeId: selectable ? raw.requestedShapeId : null,
    feed: raw.feed,
    initialColourBy: raw.plan.purpose === 'tenant_layout' ? raw.colourBy : 'status',
  }
}

/** The sheet to open: the one asked for, else the sheet of the shape asked for, else the first. */
export function pickSheet(
  sheets: readonly SheetSummary[],
  shapes: readonly Pick<CanvasShape, 'id' | 'sheetId'>[],
  requestedSheetId: string | null,
  requestedShapeId: string | null,
): SheetSummary {
  const byShape = requestedShapeId ? shapes.find((s) => s.id === requestedShapeId)?.sheetId : undefined
  return sheets.find((s) => s.id === requestedSheetId)
    ?? sheets.find((s) => s.id === byShape)
    ?? sheets[0]!
}

/** yyyy-mm-dd on the South African calendar: overdue is a local-date question. */
export function johannesburgDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(now)
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

export type TenantPlanPageData =
  | { kind: 'empty'; empty: TenantPlanEmptyProps }
  | { kind: 'plan'; props: StatusPlanPageProps }

export async function loadTenantPlanPage(
  client: unknown,
  args: {
    projectId: string
    purpose: StatusPlanPurpose
    requestedSheetId: string | null
    requestedShapeId: string | null
    /** ?colour= on the floor plan. */
    colourBy?: ColourBy
  },
): Promise<TenantPlanPageData | null> {
  const db = client as any

  const { data: project } = await db.schema('projects').from('projects')
    .select('id, organisation_id, opening_date').eq('id', args.projectId).maybeSingle()
  if (!project) return null
  const orgId = project.organisation_id as string
  const openingDate = (project.opening_date as string | null) ?? null

  // `.ok` is read right here: the role-gate contract looks for it within a few lines.
  const gate = await requireEffectiveRole(db, args.projectId, ORG_WRITE_ROLES)
  const canEdit = gate.ok
  const empty: TenantPlanPageData = { kind: 'empty', empty: { projectId: args.projectId, purpose: args.purpose, canEdit } }

  const { data: planRow } = await db.schema('tenants').from('status_plans').select(PLAN_COLUMNS)
    .eq('project_id', args.projectId).eq('purpose', args.purpose).maybeSingle()
  if (!planRow) return empty
  const plan = statusPlanFromRow(planRow as StatusPlanRow)

  const { data: sheetRows, error: sheetErr } = await db.schema('tenants').from('status_plan_sheets')
    .select(SHEET_COLUMNS).eq('status_plan_id', plan.id).order('sort_order')
  if (sheetErr) throw new Error(`tenant plan sheets: ${sheetErr.message}`)
  const rows = (sheetRows ?? []) as StatusPlanSheetRow[]
  if (rows.length === 0) return empty
  const sheets = rows.map(toSheetSummary)

  const shapesRes = await readAll<StatusPlanShapeRow>((from, to) =>
    db.schema('tenants').from('status_plan_shapes').select(SHAPE_COLUMNS)
      .eq('status_plan_id', plan.id).order('created_at').order('id').range(from, to))
  if ('error' in shapesRes) throw new Error(`tenant plan shapes: ${shapesRes.error}`)
  const shapes = shapesRes.data.map(toCanvasShape)

  const current = pickSheet(sheets, shapes, args.requestedSheetId, args.requestedShapeId)
  const filePath = rows.find((r) => r.id === current.id)!.file_path
  const { data: signed } = await db.storage.from(TENANT_PLAN_BUCKET).createSignedUrl(filePath, SIGNED_URL_SECONDS)

  const nodesRes = await readAll<any>((from, to) => {
    let q = db.schema('structure').from('nodes')
      .select('id, code, kind, shop_number, shop_name, name, shop_area_m2, status')
      .eq('project_id', args.projectId).is('deleted_at', null)
    if (plan.purpose === 'tenant_layout') q = q.eq('kind', 'tenant_db')
    return q.order('id').range(from, to)
  })
  if ('error' in nodesRes) throw new Error(`tenant plan nodes: ${nodesRes.error}`)
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
  let feed: PlanFeed | null = null
  if (plan.purpose === 'tenant_layout') {
    const facts = await loadTenantShopFacts(client, { projectId: args.projectId, orgId, openingDate })
    shopLinks = Object.fromEntries(nodes.map((n) => [n.id, shopLinkFor(facts, n.id)]))
    // Read as the caller (RLS on cable_schedule); never throws: a failure is carried as 'unavailable'.
    feed = planFeedFrom(await loadProjectFeedGraph(client, args.projectId), nodes.map((n) => n.id))
  } else {
    dbOrders = await loadProjectDbOrderStatus(client, { projectId: args.projectId, orgId })
  }

  return {
    kind: 'plan',
    props: buildStatusPlanPageProps({
      projectId: args.projectId,
      plan,
      sheets,
      current,
      signedUrl: signed?.signedUrl ?? null,
      shapes,
      nodes,
      shopLinks,
      dbOrders,
      today: johannesburgDate(new Date()),
      canEdit,
      requestedShapeId: args.requestedShapeId,
      feed,
      colourBy: args.colourBy ?? 'status',
    }),
  }
}
