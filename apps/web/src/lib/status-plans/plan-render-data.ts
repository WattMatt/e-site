/**
 * Tenant plans → render inputs for the PDF renderer (report appendix, Export sheet, portal).
 * ONE INPUT PER SHEET (spec 2026-10-12 §5).
 *
 * Reads:
 *   clients.db      — the CALLER's session client: project, plans, sheets, shapes and nodes under
 *                     RLS + site_scope (00245/00249 open SELECT to every project role).
 *   clients.facts   — order / scope facts (loadTenantShopFacts, loadProjectDbOrderStatus); the service
 *                     client, passed ONLY after the route's project gate, as the tenant report does.
 *   clients.storage — sheet bytes from the tenant-plan-files bucket (service client).
 *
 * What a shape looks like is decided by shape-view.ts, fed exactly the inputs load-plan-page.ts gives
 * the canvas (floor plans see tenant_db nodes only, line diagrams every live node; each sheet its own
 * scale), so the PDF and the screen cannot disagree. Rows go through toCanvasShape, which keeps an
 * outline that fails today's checks (invalidReason) instead of throwing.
 *
 * Never throws for one sheet: a missing, unreadable or over-budget file becomes a "not included" line
 * with a sentence. It throws only when the plan or sheet list (or the facts it needs) cannot be read;
 * the callers turn that into a single "not included" line too, never a 500.
 *
 * Colours are computed for `today` at render time: a saved report is a snapshot.
 */
import {
  SCHEMATIC_LEGEND, TENANT_LEGEND, TENANT_PLAN_BUCKET, statusPlanFromRow,
  type NodeOrderStatus, type ShopLink, type StatusPlan, type StatusPlanPurpose, type StatusPlanRow,
  type StatusPlanShapeRow, type StatusPlanSheetRow,
} from '@esite/shared/status-plans'
import { loadTenantShopFacts } from '@/lib/tenant-schedule/shop-facts'
import { readAll } from '@/lib/tender/read-all'
import { shopLinkFor } from './shop-link'
import { loadProjectDbOrderStatus } from './project-db-orders'
import { SHAPE_COLUMNS, toCanvasShape } from './canvas-shape'
import { SHEET_COLUMNS } from './sheet-row'
import { legendSummary, resolveShapeView, type ShapeViewContext } from './shape-view'
import { planTitle, type PlanSource, type RenderShape, type StatusPlanRenderInput } from './render-plan-page'
import type { CanvasShape, PlanNode } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

export const TENANT_PLAN_FILES = TENANT_PLAN_BUCKET
export const MAX_PLAN_SHEETS_PER_REPORT = 20
/**
 * One sheet file, and Σ unique files for one appendix. Both sit under the `reports` bucket's 50 MiB
 * file_size_limit (00117): the finished PDF carries the sources (vector pages are copied, not
 * rasterised), so the handoff also re-checks the final bytes (pdf-handoff.ts). A sheet file may be up
 * to 50 MB in its own bucket; one over this cap is listed as "not included" with the reason.
 */
export const MAX_STATUS_PLAN_SOURCE_BYTES = 40 * 1024 * 1024
export const MAX_STATUS_PLAN_TOTAL_BYTES = 40 * 1024 * 1024

export interface StorageLike {
  from: (bucket: string) => { download: (path: string) => Promise<{ data: Blob | null; error: { message: string } | null }> }
}
export interface PlanRenderClients { db: unknown; facts: unknown; storage: StorageLike }
export interface LoadPlanRenderArgs {
  projectId: string
  /** yyyy-mm-dd (johannesburgDate): overdue is decided against it. */
  today: string
  purposes: readonly StatusPlanPurpose[]
  planIds?: readonly string[]
  sheetIds?: readonly string[]
  maxSheets?: number
  /** Per sheet file. */
  maxSourceBytes?: number
  /** Σ unique sheet files in this output. */
  maxTotalBytes?: number
}
export interface PlanOmission { title: string; reason: string }
export interface PlanRenderLoadResult {
  inputs: StatusPlanRenderInput[]
  omitted: PlanOmission[]
  /** The project's organisation, read as the caller — set whenever there was something to render. */
  organisationId?: string
}

const PLAN_COLUMNS = 'id, project_id, organisation_id, purpose, name, created_by, created_at, updated_at'
const PURPOSE_ORDER: Record<StatusPlanPurpose, number> = { tenant_layout: 0, distribution_schematic: 1 }

export interface SheetRef { plan: StatusPlan; row: StatusPlanSheetRow }

/** Floor plan sheets, then line diagram sheets; within a plan, strip order. */
export function orderSheets(refs: readonly SheetRef[]): SheetRef[] {
  return [...refs].sort((a, b) =>
    PURPOSE_ORDER[a.plan.purpose] - PURPOSE_ORDER[b.plan.purpose]
    || Number(a.row.sort_order) - Number(b.row.sort_order))
}

/** What pdf-lib can embed. The 00249 trigger only admits these three. */
export function sourceKindFor(path: string): 'pdf' | 'png' | 'jpg' | null {
  if (/\.pdf$/i.test(path)) return 'pdf'
  if (/\.png$/i.test(path)) return 'png'
  if (/\.jpe?g$/i.test(path)) return 'jpg'
  return null
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

export async function loadStatusPlanRenderInputs(clients: PlanRenderClients, args: LoadPlanRenderArgs): Promise<PlanRenderLoadResult> {
  const db = clients.db as any
  const maxSheets = args.maxSheets ?? MAX_PLAN_SHEETS_PER_REPORT
  const maxSingle = args.maxSourceBytes ?? MAX_STATUS_PLAN_SOURCE_BYTES
  const maxTotal = args.maxTotalBytes ?? MAX_STATUS_PLAN_TOTAL_BYTES
  const empty: PlanRenderLoadResult = { inputs: [], omitted: [] }
  if (args.purposes.length === 0) return empty

  const { data: project } = await db.schema('projects').from('projects')
    .select('id, organisation_id, opening_date').eq('id', args.projectId).maybeSingle()
  if (!project) return empty
  const orgId = project.organisation_id as string
  const openingDate = (project.opening_date as string | null | undefined) ?? null

  let planQ = db.schema('tenants').from('status_plans').select(PLAN_COLUMNS)
    .eq('project_id', args.projectId).in('purpose', [...args.purposes])
  if (args.planIds) planQ = planQ.in('id', [...args.planIds])
  const { data: planRows, error: planErr } = await planQ
  if (planErr) throw new Error(`tenant plans could not be read: ${planErr.message}`)
  const plans = ((planRows ?? []) as StatusPlanRow[]).map(statusPlanFromRow)
  if (plans.length === 0) return empty
  const planById = new Map(plans.map((p) => [p.id, p]))

  let sheetQ = db.schema('tenants').from('status_plan_sheets').select(SHEET_COLUMNS).in('status_plan_id', plans.map((p) => p.id))
  if (args.sheetIds) sheetQ = sheetQ.in('id', [...args.sheetIds])
  const { data: sheetRows, error: sheetErr } = await sheetQ
  if (sheetErr) throw new Error(`tenant plan sheets could not be read: ${sheetErr.message}`)
  const refs = orderSheets(((sheetRows ?? []) as StatusPlanSheetRow[])
    .filter((row) => planById.has(row.status_plan_id))
    .map((row) => ({ plan: planById.get(row.status_plan_id)!, row })))
  if (refs.length === 0) return empty

  const omitted: PlanOmission[] = []
  const kept = refs.slice(0, maxSheets)
  for (const r of refs.slice(maxSheets)) {
    omitted.push({ title: planTitle(r.plan.name, r.plan.purpose, r.row.label), reason: `more than ${maxSheets} sheets — export the rest from the plan page` })
  }

  const [shapesRes, nodesRes] = await Promise.all([
    readAll<StatusPlanShapeRow>((from, to) =>
      db.schema('tenants').from('status_plan_shapes').select(SHAPE_COLUMNS)
        .in('sheet_id', kept.map((r) => r.row.id)).order('created_at').order('id').range(from, to)),
    readAll<any>((from, to) =>
      db.schema('structure').from('nodes')
        .select('id, code, kind, shop_number, shop_name, name, shop_area_m2, status')
        .eq('project_id', args.projectId).is('deleted_at', null).order('id').range(from, to)),
  ])
  if ('error' in shapesRes) throw new Error(`tenant plan shapes could not be read: ${shapesRes.error}`)
  if ('error' in nodesRes) throw new Error(`project boards could not be read: ${nodesRes.error}`)

  const shapesBySheet = new Map<string, CanvasShape[]>()
  for (const r of shapesRes.data) {
    const list = shapesBySheet.get(r.sheet_id) ?? []
    list.push(toCanvasShape(r))
    shapesBySheet.set(r.sheet_id, list)
  }

  // The same node sets load-plan-page.ts hands the canvas.
  const allNodes: PlanNode[] = nodesRes.data.map((n) => ({
    id: n.id,
    code: n.code ?? '—',
    kind: n.kind,
    shopNumber: n.shop_number ?? null,
    shopName: n.shop_name ?? n.name ?? null,
    scheduledM2: num(n.shop_area_m2),
    decommissioned: n.status === 'decommissioned',
  }))
  const nodesFor: Record<StatusPlanPurpose, Map<string, PlanNode>> = {
    tenant_layout: new Map(allNodes.filter((n) => n.kind === 'tenant_db').map((n) => [n.id, n])),
    distribution_schematic: new Map(allNodes.map((n) => [n.id, n])),
  }

  let shopLinks: Record<string, ShopLink> = {}
  if (kept.some((r) => r.plan.purpose === 'tenant_layout')) {
    const facts = await loadTenantShopFacts(clients.facts, { projectId: args.projectId, orgId, openingDate })
    shopLinks = Object.fromEntries([...nodesFor.tenant_layout.keys()].map((id) => [id, shopLinkFor(facts, id)]))
  }
  let dbOrders: Record<string, NodeOrderStatus> = {}
  if (kept.some((r) => r.plan.purpose === 'distribution_schematic')) {
    dbOrders = await loadProjectDbOrderStatus(clients.facts, { projectId: args.projectId, orgId })
  }

  const files = new Map<string, { bytes: Uint8Array } | { error: string }>()
  let totalBytes = 0
  const inputs: StatusPlanRenderInput[] = []

  for (const { plan, row } of kept) {
    const title = planTitle(plan.name, plan.purpose, row.label)
    const kind = sourceKindFor(row.file_path)
    if (!kind) { omitted.push({ title, reason: 'the sheet is not a PDF, PNG or JPEG file' }); continue }

    let file = files.get(row.file_path)
    if (!file) {
      const { data, error } = await clients.storage.from(TENANT_PLAN_FILES).download(row.file_path)
      if (error || !data) {
        file = { error: 'the sheet file could not be read' }
      } else {
        const bytes = new Uint8Array(await data.arrayBuffer())
        if (bytes.byteLength > maxSingle) {
          const reason = 'the sheet file is over the size cap for a report — export this sheet from its page'
          omitted.push({ title, reason })
          files.set(row.file_path, { error: reason })
          continue
        }
        if (totalBytes + bytes.byteLength > maxTotal) {
          omitted.push({ title, reason: 'the size cap for one PDF was reached — export this sheet from its page' })
          continue // not cached: a smaller later file may still fit
        }
        totalBytes += bytes.byteLength
        file = { bytes }
      }
      files.set(row.file_path, file)
    }
    if ('error' in file) { omitted.push({ title, reason: file.error }); continue }

    // `key` = the storage path: sheets sharing a file embed it once per output PDF.
    const source: PlanSource = kind === 'pdf'
      ? { kind, bytes: file.bytes, pageIndex: Number(row.page_index), key: row.file_path }
      : { kind, bytes: file.bytes, key: row.file_path }
    const ppm = num(row.pixels_per_meter)
    const ctx: ShapeViewContext = {
      purpose: plan.purpose,
      nodesById: nodesFor[plan.purpose],
      shopLinks: plan.purpose === 'tenant_layout' ? shopLinks : {},
      dbOrders: plan.purpose === 'distribution_schematic' ? dbOrders : {},
      today: args.today,
      pixelsPerMeter: ppm,
    }
    const shapes = shapesBySheet.get(row.id) ?? []
    const views = shapes.map((s) => resolveShapeView(s, ctx))
    const summary = legendSummary(views, plan.purpose)
    const rendered: RenderShape[] = shapes.map((s, i) => ({
      points: s.points, style: views[i]!.style, labelLines: views[i]!.labelLines, invalid: views[i]!.invalid,
    }))

    const warnings: string[] = []
    if (row.replaced_at) {
      warnings.push(`This sheet's file was replaced (revision ${row.revision}) since its shapes were checked; they may not line up.`)
    }
    const invalid = views.filter((v) => v.invalid).length
    if (invalid) {
      warnings.push(`${invalid} shape${invalid === 1 ? ' needs' : 's need'} redrawing: outlined in red where readable, not coloured or counted.`)
    }
    if (plan.purpose === 'tenant_layout' && ppm == null) warnings.push('This sheet has no scale, so areas are not measured.')

    inputs.push({
      planId: plan.id, sheetId: row.id, planName: plan.name, sheetLabel: row.label, purpose: plan.purpose,
      drawingName: row.file_name, pageIndex: Number(row.page_index), generatedOn: args.today, source, shapes: rendered,
      legend: plan.purpose === 'tenant_layout' ? TENANT_LEGEND : SCHEMATIC_LEGEND,
      counts: summary.counts,
      measured: plan.purpose === 'tenant_layout' && ppm != null ? { totalM2: summary.totalM2, unmeasured: summary.unmeasured } : null,
      warnings,
    })
  }
  return { inputs, omitted, organisationId: orgId }
}
