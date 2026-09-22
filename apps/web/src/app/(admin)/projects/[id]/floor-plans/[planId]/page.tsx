import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { projectService, floorPlanService, rfiService, MARKUP_WRITE_ROLES, ORG_WRITE_ROLES } from '@esite/shared'
import { listFloorPlanMarkupsAction } from '@/actions/floor-plan-markup.actions'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { DrawingViewer, type EditingAnnotation } from './DrawingViewer'
import type { OtherLeg } from './RouteLayer'
import type { ViewerMode } from './MarkupCanvas'

interface Props {
  params: Promise<{ id: string; planId: string }>
  searchParams: Promise<{ annotation?: string; mode?: string; markup?: string }>
}

type AnnotationRow = {
  id: string
  rfi_id: string
  attachment_id: string
  created_at: string
}

// Whitelist for the ?mode= querystring. Anything else (including absent)
// falls back to 'view' so a stale or hand-typed URL doesn't 404.
const VALID_MODES: ReadonlyArray<ViewerMode> = ['view', 'markup', 'rfi']
function parseMode(raw: string | undefined): ViewerMode {
  return (VALID_MODES as readonly string[]).includes(raw ?? '')
    ? (raw as ViewerMode)
    : 'view'
}

export default async function DrawingViewerPage({ params, searchParams }: Props) {
  const { id: projectId, planId } = await params
  const { annotation: editingId, mode: rawMode, markup: openMarkupId } = await searchParams
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

  // Cable routes are DRAWN here in every mode — the drawing is the record —
  // but TRACED on the cable schedule's measure page. Pressing a route opens it
  // there, which is the schedule's business and answers to ORG_WRITE_ROLES
  // (owner/admin/PM), not this page's MARKUP_WRITE_ROLES (which admits
  // contractors). Without a draft revision there is nothing to open.
  const scheduleGate = await requireEffectiveRole(supabase as any, projectId, ORG_WRITE_ROLES)
  const [draftRevisionId, calibration, sheetLegs] = await Promise.all([
    scheduleGate.ok ? loadDraftRevisionId(supabase, projectId) : Promise.resolve(null),
    loadCalibration(supabase, planId),
    // Every saved leg on this sheet, for the overlay in ANY mode. RLS decides
    // who may read routes; the page asks regardless of role.
    loadLegsOnSheet(supabase, planId),
  ])
  // A string, not a function: this crosses the server → client boundary.
  const measureHrefBase = draftRevisionId
    ? `/projects/${projectId}/cables/${draftRevisionId}/measure?sheet=${planId}`
    : null

  const effectiveMode: ViewerMode = canWrite ? initialMode : 'view'

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

  // Saved markup layers (00205). Read through the caller's own session, so
  // RLS is the gate; `staleAgainstDrawing` is computed against the drawing's
  // CURRENT file_path, which is what makes the warning banner mean anything.
  const { markups: savedMarkups = [] } = await listFloorPlanMarkupsAction({ floorPlanId: planId })
  const openMarkup = openMarkupId ? savedMarkups.find((m) => m.id === openMarkupId) ?? null : null

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
        markups={savedMarkups}
        openMarkup={openMarkup}
        measureHrefBase={measureHrefBase}
        sheetLegs={sheetLegs}
      />
      )}
    </div>
  )
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
 * drawing shows in any mode.
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

/** The project's DRAFT cable revision, if any — where a pressed route opens. */
async function loadDraftRevisionId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<string | null> {
  const { data: revision } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id')
    .eq('project_id', projectId)
    .eq('status', 'DRAFT')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return revision?.id ?? null
}
