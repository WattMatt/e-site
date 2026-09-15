import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { projectService, floorPlanService, rfiService, MARKUP_WRITE_ROLES, ORG_WRITE_ROLES } from '@esite/shared'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import {
  DrawingViewer,
  type EditingAnnotation,
  type RouteContext,
  type CableScheduleContext,
} from './DrawingViewer'
import type { OtherLeg } from './RouteLayer'
import type { ViewerMode } from './MarkupCanvas'

interface Props {
  params: Promise<{ id: string; planId: string }>
  searchParams: Promise<{ annotation?: string; mode?: string; supply?: string }>
}

type AnnotationRow = {
  id: string
  rfi_id: string
  attachment_id: string
  created_at: string
}

// Whitelist for the ?mode= querystring. Anything else (including absent)
// falls back to 'view' so a stale or hand-typed URL doesn't 404.
const VALID_MODES: ReadonlyArray<ViewerMode> = ['view', 'markup', 'rfi', 'route']
function parseMode(raw: string | undefined): ViewerMode {
  return (VALID_MODES as readonly string[]).includes(raw ?? '')
    ? (raw as ViewerMode)
    : 'view'
}

export default async function DrawingViewerPage({ params, searchParams }: Props) {
  const { id: projectId, planId } = await params
  const { annotation: editingId, mode: rawMode, supply: supplyId } = await searchParams
  const initialMode = parseMode(rawMode)
  const supabase = await createClient()

  const [project, planRaw, rfisRaw] = await Promise.all([
    projectService.getById(supabase as any, projectId).catch(() => null),
    floorPlanService.getById(supabase as any, planId).catch(() => null),
    rfiService.list(supabase as any, projectId).catch(() => []),
  ])
  if (!project || !planRaw || planRaw.project_id !== projectId) notFound()
  // Calibration columns are added in migration 00035; types will widen once
  // db types are regenerated. Until then, cast for the new fields.
  const plan = planRaw as typeof planRaw & {
    pixels_per_meter: number | null
    calibrated_at: string | null
    calibrated_by: string | null
  }

  // Effective project role decides whether the markup/RFI toolset is offered.
  // Read-only roles are pinned to 'view' regardless of the ?mode= querystring —
  // the server actions + RLS (00161/00162) enforce the same boundary; this
  // stops a hand-typed ?mode=markup from presenting tools that can't save.
  const gate = await requireEffectiveRole(supabase as any, projectId, MARKUP_WRITE_ROLES)
  const canWrite = gate.ok

  // ── Route mode ──────────────────────────────────────────────────────────
  // Entered from the cable-schedule measure worklist as
  // `?mode=route&supply=<id>`. It writes to the SCHEDULE, so it carries the
  // schedule's write role and not this page's: MARKUP_WRITE_ROLES admits
  // `contractor` (the primary markup author) while ORG_WRITE_ROLES does not.
  // Without this second gate, moving tracing onto the drawing viewer would
  // hand route-writing to every contractor. Anything that fails here falls
  // back to a normal view of the drawing rather than an error.
  // One gate, two consumers: the ⚡ tool that STARTS measuring from a drawing,
  // and the route session itself. Both are the schedule's business, so both
  // answer to ORG_WRITE_ROLES rather than this page's MARKUP_WRITE_ROLES.
  const scheduleGate = await requireEffectiveRole(supabase as any, projectId, ORG_WRITE_ROLES)
  const canMeasureCables = scheduleGate.ok

  const [cableSchedule, routeBase, calibration] = await Promise.all([
    canMeasureCables ? loadCableSchedule(supabase, projectId) : Promise.resolve(undefined),
    canMeasureCables && initialMode === 'route' && supplyId
      ? loadRouteContext(supabase, projectId, supplyId)
      : Promise.resolve(undefined),
    loadCalibration(supabase, planId),
  ])
  // Context for the sheet being traced: every OTHER run's legs on it, labelled
  // from the schedule already loaded. Needs both of the above, hence after.
  // Every saved leg on this sheet, for the overlay in ANY mode. RLS decides who
  // may read routes; the page asks regardless of role.
  const sheetLegs = await loadLegsOnSheet(supabase, planId)
  const route = routeBase
    ? { ...routeBase, otherLegsOnSheet: sheetLegs.filter((l) => l.supplyId !== routeBase.supplyId) }
    : undefined

  const effectiveMode: ViewerMode =
    route ? 'route' : canWrite && initialMode !== 'route' ? initialMode : 'view'

  // RFIs eligible for attachment: not closed.
  const rfis = (rfisRaw as Array<{ id: string; subject: string; status: string }>)
    .filter((r) => r.status !== 'closed')
    .map((r) => ({ id: r.id, subject: r.subject, status: r.status }))

  // Re-edit mode: hydrate from the existing annotation if `?annotation=` is set.
  let editing: EditingAnnotation | null = null
  if (editingId) {
    const { data: existing } = await (supabase as any)
      .from('rfi_annotations')
      .select('id, rfi_id, annotation_data, source_floor_plan_id')
      .eq('id', editingId)
      .single()
    if (existing && existing.source_floor_plan_id === planId) {
      editing = {
        id: existing.id,
        rfiId: existing.rfi_id,
        scene: existing.annotation_data,
      }
    }
  }

  const isPdf = /\.pdf$/i.test(plan.file_path)
  const isImage = /\.(png|jpe?g|webp|svg)$/i.test(plan.file_path)
  let signedUrl: string | null = null
  if (isPdf || isImage) {
    const { data } = await supabase.storage
      .from('drawings')
      .createSignedUrl(plan.file_path, 3600)
    signedUrl = data?.signedUrl ?? null
  }

  // Existing markups attached to this drawing (right rail).
  // `rfi_annotations` table types live behind `as any` until db types
  // regenerate post-migration 00033/00035.
  const { data: annotationsData } = await (supabase as any)
    .from('rfi_annotations')
    .select('id, rfi_id, attachment_id, created_at')
    .eq('source_floor_plan_id', planId)
    .order('created_at', { ascending: false })
  const annotations: AnnotationRow[] = (annotationsData ?? []) as AnnotationRow[]

  // Snag pins on this drawing (read-only overlay)
  const snagPins = await floorPlanService
    .getSnagPins(supabase as any, planId)
    .catch(() => [])

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/floor-plans`}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            textDecoration: 'none',
            letterSpacing: '0.06em',
          }}
        >
          ← Floor Plans
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{plan.name}</h1>
          <p className="page-subtitle">
            {project.name}
            {plan.level ? ` · ${plan.level}` : ''}
            {plan.scale ? ` · Scale ${plan.scale}` : ''}
            {plan.pixels_per_meter
              ? ` · Calibrated (${plan.pixels_per_meter.toFixed(1)} px/m)`
              : ' · Uncalibrated'}
          </p>
        </div>
      </div>

      {!isPdf && !isImage ? (
        // Non-PDF/image (e.g. DWG/DXF) — the markup canvas can't render it.
        // Show a fallback panel and offer the original download via the
        // existing /floor-plans list page (Download button there forces an
        // attachment Content-Disposition).
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 8 }} aria-hidden="true">📄</div>
            <div style={{ fontSize: 13, color: 'var(--c-text)', marginBottom: 6 }}>
              Preview not supported for this file type yet.
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
              In-browser preview is currently available for PDF, PNG, JPG, WebP and SVG.
            </div>
            <Link
              href={`/projects/${projectId}/floor-plans`}
              className="btn-primary-amber"
              style={{ display: 'inline-block', marginTop: 18, textDecoration: 'none' }}
            >
              Back to drawings list to download original
            </Link>
          </div>
        </div>
      ) : (
      <DrawingViewer
        plan={{
          id: plan.id,
          name: plan.name,
          width_px: plan.width_px,
          height_px: plan.height_px,
          pixels_per_meter: plan.pixels_per_meter ?? null,
          signedUrl,
          isPdf,
          calibration_points: calibration.points,
          calibration_metres: calibration.metres,
          calibration_page_index: calibration.pageIndex,
        }}
        projectId={projectId}
        annotations={annotations}
        snagPins={snagPins as Array<{ id: string; title: string; status: string; priority: string; floor_plan_pin: { x: number; y: number } }>}
        rfis={rfis}
        editing={editing}
        initialMode={effectiveMode}
        canWrite={canWrite}
        route={route}
        cableSchedule={cableSchedule}
        sheetLegs={sheetLegs}
      />
      )}
    </div>
  )
}

/**
 * Load the run being measured, its route so far, and the label for the banner.
 *
 * Returns `undefined` — a plain drawing view, not an error — when the supply
 * does not exist, belongs to another project, or its revision is no longer
 * DRAFT. A drawing is a harmless thing to land on. The schedule write role is
 * checked by the caller.
 */
async function loadRouteContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  supplyId: string,
): Promise<Omit<RouteContext, 'otherLegsOnSheet'> | undefined> {
  const { data: supply } = await (supabase as any)
    .schema('cable_schedule')
    .from('supplies')
    .select('id, revision_id, from_node_id, to_node_id, revision:revisions(id, status, project_id)')
    .eq('id', supplyId)
    .maybeSingle()
  if (!supply) return undefined
  const rev = (supply as any).revision
  if (!rev || rev.project_id !== projectId || rev.status !== 'DRAFT') return undefined

  const nodeIds = [supply.from_node_id, supply.to_node_id].filter(Boolean) as string[]
  const { data: nodes } = nodeIds.length
    ? await (supabase as any).schema('structure').from('nodes').select('id, code').in('id', nodeIds)
    : { data: [] }
  const codeOf = new Map<string, string>(((nodes ?? []) as any[]).map((n) => [n.id, n.code as string]))
  const runLabel = `${supply.from_node_id ? (codeOf.get(supply.from_node_id) ?? '—') : 'Source'} → ${
    supply.to_node_id ? (codeOf.get(supply.to_node_id) ?? '—') : '—'
  }`

  const { data: routeRow } = await (supabase as any)
    .schema('cable_schedule')
    .from('supply_routes')
    .select('id, rise_m, drop_m')
    .eq('supply_id', supplyId)
    .maybeSingle()

  // What the schedule holds for this run, so the drawing can say whether the
  // trace is on it yet. Parallels share a route; any strand's figure is the run's.
  const { data: cables } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .select('measured_length_m')
    .eq('supply_id', supplyId)
  const cableRows = ((cables ?? []) as any[])
  const scheduleLengthM = cableRows.find((c) => c.measured_length_m != null)?.measured_length_m
  const { data: sheetRows } = await (supabase as any)
    .schema('tenants')
    .from('floor_plans')
    .select('id, name, pixels_per_meter')
    .eq('project_id', projectId)
    .eq('is_active', true)
    .order('name')

  const { data: segments } = routeRow
    ? await (supabase as any)
        .schema('cable_schedule')
        .from('route_segments')
        .select('id, seq, floor_plan_id, floor_plan_name, page_index, points, pixels_per_meter, length_m')
        .eq('route_id', routeRow.id)
        .order('seq')
    : { data: [] }

  return {
    supplyId,
    revisionId: supply.revision_id as string,
    runLabel,
    riseM: routeRow ? Number(routeRow.rise_m) : 0,
    dropM: routeRow ? Number(routeRow.drop_m) : 0,
    scheduleLengthM: scheduleLengthM == null ? null : Number(scheduleLengthM),
    strands: cableRows.length,
    sheets: ((sheetRows ?? []) as any[]).map((p) => ({ id: p.id, name: p.name ?? 'Drawing', calibrated: p.pixels_per_meter != null })),
    // Carry the supply back so "Done" lands on the run just traced, with its
    // legs and total in front of the user, rather than an unselected list.
    doneHref: `/projects/${projectId}/cables/${supply.revision_id}/measure?supply=${supplyId}`,
    segments: ((segments ?? []) as any[]).map((g) => ({
      id: g.id,
      floorPlanId: g.floor_plan_id,
      floorPlanName: g.floor_plan_name ?? 'Drawing',
      pageIndex: g.page_index,
      points: (g.points ?? []) as number[],
      pixelsPerMeter: Number(g.pixels_per_meter),
      lengthM: Number(g.length_m),
    })),
  }
}

/** Where this sheet's scale was taken (00198). All-null before it is set. */
async function loadCalibration(
  supabase: Awaited<ReturnType<typeof createClient>>,
  planId: string,
): Promise<{ points: number[] | null; metres: number | null; pageIndex: number | null }> {
  const { data } = await (supabase as any)
    .schema('tenants')
    .from('floor_plans')
    .select('calibration_points, calibration_metres, calibration_page_index')
    .eq('id', planId)
    .maybeSingle()
  const pts = data?.calibration_points
  return {
    points: Array.isArray(pts) && pts.length === 4 ? pts.map(Number) : null,
    metres: data?.calibration_metres == null ? null : Number(data.calibration_metres),
    pageIndex: data?.calibration_page_index == null ? null : Number(data.calibration_page_index),
  }
}

/**
 * Every saved route leg on this sheet, labelled by run — the record the
 * drawing shows in any mode. Labels are resolved here rather than borrowed
 * from the ⚡ picker's list, which exists only for schedule writers.
 */
async function loadLegsOnSheet(
  supabase: Awaited<ReturnType<typeof createClient>>,
  planId: string,
): Promise<OtherLeg[]> {
  const { data: segs } = await (supabase as any)
    .schema('cable_schedule')
    .from('route_segments')
    .select('route_id, page_index, points, length_m')
    .eq('floor_plan_id', planId)
  const rows = ((segs ?? []) as any[]).filter((r) => Array.isArray(r.points) && r.points.length >= 4)
  if (rows.length === 0) return []
  const routeIds = [...new Set(rows.map((r) => r.route_id))]
  const { data: routes } = await (supabase as any)
    .schema('cable_schedule')
    .from('supply_routes')
    .select('id, supply_id')
    .in('id', routeIds)
  const supplyOf = new Map<string, string>(((routes ?? []) as any[]).map((r) => [r.id, r.supply_id]))
  const supplyIds = [...new Set([...supplyOf.values()])]
  const { data: supplies } = supplyIds.length
    ? await (supabase as any).schema('cable_schedule').from('supplies').select('id, from_node_id, to_node_id').in('id', supplyIds)
    : { data: [] }
  const supplyRows = ((supplies ?? []) as any[])
  const nodeIds = [...new Set(supplyRows.flatMap((x) => [x.from_node_id, x.to_node_id]).filter(Boolean))] as string[]
  const { data: nodes } = nodeIds.length
    ? await (supabase as any).schema('structure').from('nodes').select('id, code').in('id', nodeIds)
    : { data: [] }
  const codeOf = new Map<string, string>(((nodes ?? []) as any[]).map((n) => [n.id, n.code as string]))
  const labelOf = new Map<string, string>(
    supplyRows.map((x) => [
      x.id,
      `${x.from_node_id ? (codeOf.get(x.from_node_id) ?? '—') : 'Source'} → ${x.to_node_id ? (codeOf.get(x.to_node_id) ?? '—') : '—'}`,
    ]),
  )
  return rows
    .map((r) => ({ supplyId: supplyOf.get(r.route_id) ?? '', pageIndex: Number(r.page_index), points: r.points as number[], lengthM: Number(r.length_m) }))
    .filter((r) => r.supplyId)
    .map((r) => ({ ...r, label: labelOf.get(r.supplyId) ?? 'run' }))
}

/**
 * The project's DRAFT cable schedule, for the in-drawing ⚡ tool.
 *
 * A run is offered whether or not it already has a length: the re-measure case
 * is exactly the one a hand-typed schedule needs, and hiding traced runs would
 * make the tool disappear on every project that has ever recorded a length.
 * Returns `undefined` when the project has no DRAFT revision, so the tool is
 * absent rather than empty.
 */
async function loadCableSchedule(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<CableScheduleContext | undefined> {
  const { data: revision } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, code')
    .eq('project_id', projectId)
    .eq('status', 'DRAFT')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!revision) return undefined

  const { data: supplies } = await (supabase as any)
    .schema('cable_schedule')
    .from('supplies')
    .select('id, from_node_id, to_node_id')
    .eq('revision_id', revision.id)
  const supplyRows = ((supplies ?? []) as any[])
  if (supplyRows.length === 0) return undefined

  // Node codes name the run. Fetched separately rather than through a
  // PostgREST embed: `supplies` has two FKs into the same table, which makes
  // the embed alias ambiguous and version-sensitive.
  const nodeIds = [...new Set(supplyRows.flatMap((s) => [s.from_node_id, s.to_node_id]).filter(Boolean))] as string[]
  const { data: nodes } = nodeIds.length
    ? await (supabase as any).schema('structure').from('nodes').select('id, code').in('id', nodeIds)
    : { data: [] }
  const codeOf = new Map<string, string>(((nodes ?? []) as any[]).map((n) => [n.id, n.code as string]))

  const { data: routes } = await (supabase as any)
    .schema('cable_schedule')
    .from('supply_routes')
    .select('supply_id, traced_length_m')
    .eq('revision_id', revision.id)
  // Traced means a route WITH geometry — an empty route is still outstanding,
  // the same rule the worklist uses.
  const tracedSupplies = new Set(
    ((routes ?? []) as any[]).filter((r) => Number(r.traced_length_m) > 0).map((r) => r.supply_id),
  )

  const { data: cables } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .select('supply_id, measured_length_m')
    .eq('revision_id', revision.id)
  const lengthOf = new Map<string, number>()
  for (const c of ((cables ?? []) as any[])) {
    if (c.measured_length_m != null && !lengthOf.has(c.supply_id)) {
      lengthOf.set(c.supply_id, Number(c.measured_length_m))
    }
  }

  return {
    revisionId: revision.id,
    revisionCode: revision.code,
    runs: supplyRows
      .map((s) => ({
        supplyId: s.id,
        label: `${s.from_node_id ? (codeOf.get(s.from_node_id) ?? '—') : 'Source'} → ${
          s.to_node_id ? (codeOf.get(s.to_node_id) ?? '—') : '—'
        }`,
        traced: tracedSupplies.has(s.id),
        scheduleLengthM: lengthOf.get(s.id) ?? null,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  }
}
