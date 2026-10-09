/**
 * Status plans → render inputs for the PDF renderer (report appendix, Export sheet, portal).
 *
 * Reads:
 *   clients.db      — the CALLER's session client: project, plans, shapes, drawings, page scales and
 *                     nodes under RLS + site_scope (00245 opens SELECT to every project role).
 *   clients.facts   — order / scope facts (loadTenantShopFacts, loadProjectDbOrderStatus); the service
 *                     client, passed ONLY after the route's project gate, as the tenant report does.
 *   clients.storage — drawing bytes from the `drawings` bucket (service client).
 *
 * What a shape looks like is decided by shape-view.ts (resolveShapeView / legendSummary), fed exactly
 * the inputs load-plan-page.ts gives the canvas — tenant layouts see tenant_db nodes only, schematics
 * every live node — so the PDF and the screen cannot disagree. Rows go through toCanvasShape, which
 * keeps an outline that fails today's checks (invalidReason) instead of throwing.
 *
 * Never throws for one drawing: a missing, unreadable, unsupported or over-budget drawing becomes a
 * "not included" line with a sentence. It throws only when the plan list (or the facts it needs)
 * cannot be read; the callers turn that into a single "not included" line too, never a 500.
 *
 * Colours are computed for `today` at render time (spec §8): a saved report is a snapshot.
 */
import {
  SCHEMATIC_LEGEND, TENANT_LEGEND, statusPlanFromRow,
  type NodeOrderStatus, type ShopLink, type StatusPlan, type StatusPlanPurpose, type StatusPlanRow, type StatusPlanShapeRow,
} from '@esite/shared/status-plans'
import { loadTenantShopFacts } from '@/lib/tenant-schedule/shop-facts'
import { pageScaleFor, type PageScaleRow } from '@/lib/sheet/page-scale'
import { readAll } from '@/lib/tender/read-all'
import { shopLinkFor } from './shop-link'
import { loadProjectDbOrderStatus } from './project-db-orders'
import { SHAPE_COLUMNS, toCanvasShape } from './canvas-shape'
import { fileLabel } from './plan-urls'
import { legendSummary, resolveShapeView, type ShapeViewContext } from './shape-view'
import { planTitle, type PlanSource, type RenderShape, type StatusPlanRenderInput } from './render-plan-page'
import type { CanvasShape, PlanNode } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

export const DRAWINGS_BUCKET = 'drawings'
export const MAX_STATUS_PLANS_PER_REPORT = 20
/** Σ unique drawing files downloaded for one render. */
export const MAX_STATUS_PLAN_SOURCE_BYTES = 60 * 1024 * 1024

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
  maxPlans?: number
  maxSourceBytes?: number
}
export interface PlanOmission { title: string; reason: string }
export interface PlanRenderLoadResult { inputs: StatusPlanRenderInput[]; omitted: PlanOmission[] }

const PLAN_COLUMNS = 'id, project_id, organisation_id, floor_plan_id, page_index, purpose, name, source_file_path, created_by, created_at, updated_at'
const PURPOSE_ORDER: Record<StatusPlanPurpose, number> = { tenant_layout: 0, distribution_schematic: 1 }

interface DrawingRow { id: string; name: string | null; file_path: string; pixels_per_meter: number | string | null }

export function orderPlans<T extends Pick<StatusPlan, 'purpose' | 'name' | 'pageIndex'>>(plans: readonly T[]): T[] {
  return [...plans].sort((a, b) =>
    PURPOSE_ORDER[a.purpose] - PURPOSE_ORDER[b.purpose]
    || a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' })
    || a.pageIndex - b.pageIndex)
}

/** What pdf-lib can embed. WebP, SVG and CAD files are drawable on screen but not here. */
export function sourceKindFor(path: string): 'pdf' | 'png' | 'jpg' | null {
  if (/\.pdf$/i.test(path)) return 'pdf'
  if (/\.png$/i.test(path)) return 'png'
  if (/\.jpe?g$/i.test(path)) return 'jpg'
  return null
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

export async function loadStatusPlanRenderInputs(clients: PlanRenderClients, args: LoadPlanRenderArgs): Promise<PlanRenderLoadResult> {
  const db = clients.db as any
  const maxPlans = args.maxPlans ?? MAX_STATUS_PLANS_PER_REPORT
  const maxBytes = args.maxSourceBytes ?? MAX_STATUS_PLAN_SOURCE_BYTES
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
  if (planErr) throw new Error(`status plans could not be read: ${planErr.message}`)
  const ordered = orderPlans(((planRows ?? []) as StatusPlanRow[]).map(statusPlanFromRow))
  if (ordered.length === 0) return empty

  const omitted: PlanOmission[] = []
  const plans = ordered.slice(0, maxPlans)
  for (const p of ordered.slice(maxPlans)) {
    omitted.push({ title: planTitle(p.name, p.purpose, p.pageIndex), reason: `more than ${maxPlans} plans — export the rest from the status plans page` })
  }

  const fpIds = [...new Set(plans.map((p) => p.floorPlanId))]
  const [fpRes, scaleRes, shapesRes, nodesRes] = await Promise.all([
    db.schema('tenants').from('floor_plans').select('id, name, file_path, pixels_per_meter').in('id', fpIds),
    db.schema('tenants').from('floor_plan_page_scales').select('floor_plan_id, page_index, pixels_per_meter').in('floor_plan_id', fpIds),
    readAll<StatusPlanShapeRow>((from, to) =>
      db.schema('tenants').from('status_plan_shapes').select(SHAPE_COLUMNS)
        .in('status_plan_id', plans.map((p) => p.id)).order('created_at').order('id').range(from, to)),
    readAll<any>((from, to) =>
      db.schema('structure').from('nodes')
        .select('id, code, kind, shop_number, shop_name, name, shop_area_m2, status')
        .eq('project_id', args.projectId).is('deleted_at', null).order('id').range(from, to)),
  ])
  if ('error' in shapesRes) throw new Error(`status plan shapes could not be read: ${shapesRes.error}`)
  if ('error' in nodesRes) throw new Error(`project boards could not be read: ${nodesRes.error}`)

  const fpById = new Map(((fpRes.data ?? []) as DrawingRow[]).map((r) => [r.id, r]))
  const scalesByFp = new Map<string, PageScaleRow[]>()
  for (const s of (scaleRes.data ?? []) as Array<{ floor_plan_id: string; page_index: number; pixels_per_meter: number | string }>) {
    const list = scalesByFp.get(s.floor_plan_id) ?? []
    list.push({ pageIndex: Number(s.page_index), pixelsPerMeter: Number(s.pixels_per_meter) })
    scalesByFp.set(s.floor_plan_id, list)
  }

  const shapesByPlan = new Map<string, CanvasShape[]>()
  for (const r of shapesRes.data) {
    const list = shapesByPlan.get(r.status_plan_id) ?? []
    list.push(toCanvasShape(r))
    shapesByPlan.set(r.status_plan_id, list)
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
  if (plans.some((p) => p.purpose === 'tenant_layout')) {
    const facts = await loadTenantShopFacts(clients.facts, { projectId: args.projectId, orgId, openingDate })
    shopLinks = Object.fromEntries([...nodesFor.tenant_layout.keys()].map((id) => [id, shopLinkFor(facts, id)]))
  }
  let dbOrders: Record<string, NodeOrderStatus> = {}
  if (plans.some((p) => p.purpose === 'distribution_schematic')) {
    dbOrders = await loadProjectDbOrderStatus(clients.facts, { projectId: args.projectId, orgId })
  }

  const files = new Map<string, { bytes: Uint8Array } | { error: string }>()
  let totalBytes = 0
  const inputs: StatusPlanRenderInput[] = []

  for (const plan of plans) {
    const title = planTitle(plan.name, plan.purpose, plan.pageIndex)
    const fp = fpById.get(plan.floorPlanId)
    if (!fp) { omitted.push({ title, reason: 'the drawing is no longer available' }); continue }
    const kind = sourceKindFor(fp.file_path)
    if (!kind) { omitted.push({ title, reason: `the drawing is not a PDF, PNG or JPEG file (${fileLabel(fp.file_path)})` }); continue }

    let file = files.get(fp.file_path)
    if (!file) {
      const { data, error } = await clients.storage.from(DRAWINGS_BUCKET).download(fp.file_path)
      if (error || !data) {
        file = { error: `the drawing file could not be read (${error?.message ?? 'empty'})` }
      } else {
        const bytes = new Uint8Array(await data.arrayBuffer())
        if (totalBytes + bytes.byteLength > maxBytes) {
          omitted.push({ title, reason: 'the size cap for one PDF was reached — export this plan from its page' })
          continue // not cached: a smaller later drawing may still fit
        }
        totalBytes += bytes.byteLength
        file = { bytes }
      }
      files.set(fp.file_path, file)
    }
    if ('error' in file) { omitted.push({ title, reason: file.error }); continue }

    // `key` = the storage path: plans sharing a drawing page embed it once per output PDF.
    const source: PlanSource = kind === 'pdf'
      ? { kind, bytes: file.bytes, pageIndex: plan.pageIndex, key: fp.file_path }
      : { kind, bytes: file.bytes, key: fp.file_path }
    const ppm = pageScaleFor({ pixels_per_meter: num(fp.pixels_per_meter), page_scales: scalesByFp.get(fp.id) ?? [] }, plan.pageIndex)
    const ctx: ShapeViewContext = {
      purpose: plan.purpose,
      nodesById: nodesFor[plan.purpose],
      shopLinks: plan.purpose === 'tenant_layout' ? shopLinks : {},
      dbOrders: plan.purpose === 'distribution_schematic' ? dbOrders : {},
      today: args.today,
      pixelsPerMeter: ppm,
    }
    const shapes = shapesByPlan.get(plan.id) ?? []
    const views = shapes.map((s) => resolveShapeView(s, ctx))
    const summary = legendSummary(views, plan.purpose)
    const rendered: RenderShape[] = shapes.map((s, i) => ({
      points: s.points, style: views[i]!.style, labelLines: views[i]!.labelLines, invalid: views[i]!.invalid,
    }))

    const warnings: string[] = []
    if (fp.file_path !== plan.sourceFilePath) {
      warnings.push(`The drawing file changed since this plan was drawn (${fileLabel(plan.sourceFilePath)} -> ${fileLabel(fp.file_path)}); shapes may not line up.`)
    }
    const invalid = views.filter((v) => v.invalid).length
    if (invalid) {
      warnings.push(`${invalid} shape${invalid === 1 ? ' needs' : 's need'} redrawing: outlined in red where readable, not coloured or counted.`)
    }
    if (plan.purpose === 'tenant_layout' && ppm == null) warnings.push('This page has no scale, so areas are not measured.')

    inputs.push({
      planId: plan.id, planName: plan.name, purpose: plan.purpose, drawingName: fp.name ?? fileLabel(fp.file_path),
      pageIndex: plan.pageIndex, generatedOn: args.today, source, shapes: rendered,
      legend: plan.purpose === 'tenant_layout' ? TENANT_LEGEND : SCHEMATIC_LEGEND,
      counts: summary.counts,
      measured: plan.purpose === 'tenant_layout' && ppm != null ? { totalM2: summary.totalM2, unmeasured: summary.unmeasured } : null,
      warnings,
    })
  }
  return { inputs, omitted }
}
