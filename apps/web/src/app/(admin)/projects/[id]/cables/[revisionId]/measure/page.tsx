import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { RouteMeasureWorkspace } from './RouteMeasureWorkspace'
import { SavedReportsPanel } from '@/components/reports/SavedReportsPanel'
import { lastSheetOf } from './route-canvas-logic'
import type { ActiveSheet, PlanRow, RunRow } from './types'
import type { OtherLeg } from '@/app/(admin)/projects/[id]/floor-plans/[planId]/RouteLayer'

export const metadata: Metadata = { title: 'Measure cable runs' }

interface Props {
  params: Promise<{ id: string; revisionId: string }>
  /**
   * `?supply=` the run, `?sheet=` the drawing, `?page=` its PDF page. The grid,
   * the Drawings tab and a pressed route on the viewer all deep-link here.
   */
  searchParams: Promise<{ supply?: string; sheet?: string; page?: string }>
}

/**
 * The cable schedule's measuring tool: worklist, sheet and run, on one page.
 *
 * Tracing used to happen on the drawing viewer in a borrowed "route mode";
 * the viewer served contractors' markup and engineers' measuring under two
 * role gates on one surface, and every sheet meant a trip between sections.
 * This page owns the whole flow now. The worklist is still a QUERY, not a
 * maintained list: a run is outstanding when it has no route, and measuring
 * one removes it.
 */
export default async function MeasureRunsPage({ params, searchParams }: Props) {
  const { id: projectId, revisionId } = await params
  const { supply: initialSupplyId, sheet: sheetParam, page: pageParam } = await searchParams
  const supabase = await createClient()

  const { data: revision } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, code, status, project_id, organisation_id')
    .eq('id', revisionId)
    .maybeSingle()
  if (!revision || revision.project_id !== projectId) notFound()

  // Same write gate as the rest of the schedule. The actions re-check and the
  // database policies gate the writes; a read-only role is simply not shown a
  // measuring workspace. `.ok` — the helper returns a result object.
  const roleGate = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!roleGate.ok) redirect(`/projects/${projectId}/cables/${revisionId}`)
  if (revision.status !== 'DRAFT') redirect(`/projects/${projectId}/cables/${revisionId}`)

  // Runs, with the node codes that name them and whatever length they carry.
  // Node codes are fetched separately: `supplies` has two FKs into the same
  // table, which makes a PostgREST embed alias ambiguous and version-sensitive.
  const { data: supplies } = await (supabase as any)
    .schema('cable_schedule')
    .from('supplies')
    .select('id, voltage_v, design_load_a, section, from_node_id, to_node_id')
    .eq('revision_id', revisionId)
  const supplyRows = (supplies ?? []) as any[]
  const nodeIds = [...new Set(supplyRows.flatMap((s) => [s.from_node_id, s.to_node_id]).filter(Boolean))] as string[]
  const { data: nodes } = nodeIds.length
    ? await (supabase as any).schema('structure').from('nodes').select('id, code').in('id', nodeIds)
    : { data: [] }
  const nodeCode = new Map<string, string>(((nodes ?? []) as any[]).map((n) => [n.id, n.code as string]))

  const { data: cables } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .select('id, supply_id, measured_length_m, length_status')
    .eq('revision_id', revisionId)
  const bySupply = new Map<string, { strands: number; lengthM: number | null }>()
  for (const c of ((cables ?? []) as any[])) {
    const cur = bySupply.get(c.supply_id) ?? { strands: 0, lengthM: null }
    cur.strands += 1
    if (cur.lengthM == null && c.measured_length_m != null) cur.lengthM = Number(c.measured_length_m)
    bySupply.set(c.supply_id, cur)
  }

  const { data: routes } = await (supabase as any)
    .schema('cable_schedule')
    .from('supply_routes')
    .select('id, supply_id, rise_m, drop_m, traced_length_m, total_length_m, updated_at')
    .eq('revision_id', revisionId)
  const routeRows = (routes ?? []) as any[]
  const routeBySupply = new Map<string, any>(routeRows.map((r) => [r.supply_id, r]))

  const routeIds = routeRows.map((r) => r.id)
  const { data: segments } = routeIds.length
    ? await (supabase as any)
        .schema('cable_schedule')
        .from('route_segments')
        .select('id, route_id, seq, floor_plan_id, floor_plan_name, page_index, points, pixels_per_meter, length_m')
        .in('route_id', routeIds)
        .order('seq')
    : { data: [] }
  const segsByRoute = new Map<string, any[]>()
  for (const s of ((segments ?? []) as any[])) {
    const arr = segsByRoute.get(s.route_id) ?? []
    arr.push(s)
    segsByRoute.set(s.route_id, arr)
  }

  const labelOf = (s: any) =>
    `${nodeCode.get(s.from_node_id) ?? (s.from_node_id ? '—' : 'Source')} → ${nodeCode.get(s.to_node_id) ?? '—'}`

  const runs: RunRow[] = supplyRows.map((s) => {
    const route = routeBySupply.get(s.id)
    const agg = bySupply.get(s.id) ?? { strands: 0, lengthM: null }
    return {
      supplyId: s.id,
      fromCode: nodeCode.get(s.from_node_id) ?? (s.from_node_id ? '—' : 'Source'),
      toCode: nodeCode.get(s.to_node_id) ?? '—',
      voltageV: Number(s.voltage_v),
      section: s.section ?? null,
      strands: agg.strands,
      scheduleLengthM: agg.lengthM,
      route: route
        ? {
            riseM: Number(route.rise_m),
            dropM: Number(route.drop_m),
            tracedM: Number(route.traced_length_m),
            totalM: Number(route.total_length_m),
            updatedAt: route.updated_at ?? null,
            segments: (segsByRoute.get(route.id) ?? []).map((g) => ({
              id: g.id,
              seq: g.seq,
              floorPlanId: g.floor_plan_id,
              floorPlanName: g.floor_plan_name ?? 'Drawing',
              pageIndex: g.page_index,
              points: (g.points ?? []) as number[],
              pixelsPerMeter: Number(g.pixels_per_meter),
              lengthM: Number(g.length_m),
            })),
          }
        : null,
    }
  })
  const selectedRun = runs.find((r) => r.supplyId === initialSupplyId) ?? null

  // Drawings, with their calibration so the list can say which have a scale.
  const { data: plans } = await (supabase as any)
    .schema('tenants')
    .from('floor_plans')
    .select('id, name, file_path, width_px, height_px, pixels_per_meter, calibration_points, calibration_metres, calibration_page_index')
    .eq('project_id', projectId)
    .eq('is_active', true)
    .order('name')
  const planRaw = (plans ?? []) as any[]
  const isPdfPath = (p: string) => /\.pdf$/i.test(p)
  const isImagePath = (p: string) => /\.(png|jpe?g|webp|svg)$/i.test(p)
  const planRows: PlanRow[] = planRaw.map((p) => ({
    id: p.id,
    name: p.name ?? 'Drawing',
    isPdf: isPdfPath(String(p.file_path ?? '')),
    renderable: isPdfPath(String(p.file_path ?? '')) || isImagePath(String(p.file_path ?? '')),
    filePath: p.file_path,
    pixelsPerMeter: p.pixels_per_meter == null ? null : Number(p.pixels_per_meter),
  }))

  // The sheet to open: the one asked for, else the run's last sheet, else the
  // first drawing the canvas can render. Only THIS sheet gets a signed URL.
  const last = lastSheetOf(selectedRun)
  const activePlan =
    planRaw.find((p) => p.id === sheetParam) ??
    (last ? planRaw.find((p) => p.id === last.planId) : undefined) ??
    planRaw.find((p) => isPdfPath(String(p.file_path ?? '')) || isImagePath(String(p.file_path ?? '')))
  let activeSheet: ActiveSheet | null = null
  let otherLegsOnSheet: OtherLeg[] = []
  if (activePlan) {
    const filePath = String(activePlan.file_path ?? '')
    const renderable = isPdfPath(filePath) || isImagePath(filePath)
    let signedUrl: string | null = null
    if (renderable) {
      const { data } = await supabase.storage.from('drawings').createSignedUrl(filePath, 3600)
      signedUrl = data?.signedUrl ?? null
    }
    const { data: scales } = await (supabase as any)
      .schema('tenants')
      .from('floor_plan_page_scales')
      .select('page_index, pixels_per_meter, calibration_points, calibration_metres')
      .eq('floor_plan_id', activePlan.id)
    const pts = activePlan.calibration_points
    activeSheet = {
      id: activePlan.id,
      name: activePlan.name ?? 'Drawing',
      signedUrl,
      isPdf: isPdfPath(filePath),
      width_px: activePlan.width_px ?? null,
      height_px: activePlan.height_px ?? null,
      pixels_per_meter: activePlan.pixels_per_meter == null ? null : Number(activePlan.pixels_per_meter),
      calibration_points: Array.isArray(pts) && pts.length === 4 ? pts.map(Number) : null,
      calibration_metres: activePlan.calibration_metres == null ? null : Number(activePlan.calibration_metres),
      calibration_page_index: activePlan.calibration_page_index == null ? null : Number(activePlan.calibration_page_index),
      page_scales: ((scales ?? []) as any[]).map((r) => ({
        pageIndex: Number(r.page_index),
        pixelsPerMeter: Number(r.pixels_per_meter),
        points: Array.isArray(r.calibration_points) && r.calibration_points.length === 4 ? r.calibration_points.map(Number) : null,
        metres: r.calibration_metres == null ? null : Number(r.calibration_metres),
      })),
    }
    // Every OTHER run's legs on this sheet, for context while tracing. Derived
    // from the segments already loaded — this revision's routes are the ones
    // that matter on this revision's measure page.
    const supplyOfRoute = new Map<string, string>(routeRows.map((r) => [r.id, r.supply_id]))
    const supplyById = new Map<string, any>(supplyRows.map((s) => [s.id, s]))
    otherLegsOnSheet = ((segments ?? []) as any[])
      .filter((g) => g.floor_plan_id === activePlan.id && Array.isArray(g.points) && g.points.length >= 4)
      .map((g) => ({ supplyId: supplyOfRoute.get(g.route_id) ?? '', pageIndex: Number(g.page_index), points: g.points as number[], lengthM: Number(g.length_m) }))
      .filter((g) => g.supplyId && g.supplyId !== initialSupplyId)
      .map((g) => ({ ...g, label: supplyById.get(g.supplyId) ? labelOf(supplyById.get(g.supplyId)) : 'run' }))
  }

  const parsedPage = Number(pageParam)
  const initialPage = Number.isInteger(parsedPage) && parsedPage >= 1
    ? parsedPage
    : last && activeSheet && last.planId === activeSheet.id ? last.page : 1

  const measured = runs.filter((r) => r.route && r.route.segments.length > 0).length

  return (
    <div style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
        <Link href={`/projects/${projectId}/cables/${revisionId}`} style={{ fontSize: 13, color: 'var(--c-text-dim)', textDecoration: 'none' }}>
          ← Schedule {revision.code}
        </Link>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Measure cable runs</h1>
        <span style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>
          {measured} of {runs.length} runs traced ·{' '}
          <strong>1</strong> trace each leg on the sheet, <strong>2</strong> add rise and drop, <strong>3</strong> assign the total to the schedule.
        </span>
      </div>

      <RouteMeasureWorkspace
        projectId={projectId}
        revisionId={revisionId}
        runs={runs}
        plans={planRows}
        initialSupplyId={selectedRun?.supplyId}
        activeSheet={activeSheet}
        initialPage={initialPage}
        otherLegsOnSheet={otherLegsOnSheet}
      />

      {/* Every sheet exported from the canvas, as versioned PDFs: the record of
          what was traced, re-openable and downloadable. */}
      <div style={{ marginTop: 20 }}>
        <SavedReportsPanel projectId={projectId} kind="cable_route_sheet" title="Exported sheets" />
      </div>
    </div>
  )
}
