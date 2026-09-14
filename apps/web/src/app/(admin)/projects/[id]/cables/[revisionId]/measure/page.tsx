import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { RouteMeasureWorkspace, type RunRow, type PlanRow } from './RouteMeasureWorkspace'

export const metadata: Metadata = { title: 'Measure cable runs' }

interface Props {
  params: Promise<{ id: string; revisionId: string }>
}

/**
 * Measure cable runs against the project's drawings.
 *
 * A dedicated surface rather than a mode inside the general markup canvas.
 * The markup canvas is a 2,795-line general-purpose tool with seventeen tools
 * and three save paths; this flow needs one tool, one save path, and a worklist
 * that drives the whole session. Bolting it in would have coupled a schedule
 * feature to every future change in RFI and QC markup, and would have inherited
 * that canvas's scene-graph storage, which cannot express a route that crosses
 * sheets.
 *
 * The worklist is a QUERY, not a maintained list: a run is outstanding when it
 * has no route. Measuring one removes it. That is what narrows the list as the
 * work proceeds.
 */
export default async function MeasureRunsPage({ params }: Props) {
  const { id: projectId, revisionId } = await params
  const supabase = await createClient()

  const { data: revision } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, code, status, project_id, organisation_id')
    .eq('id', revisionId)
    .maybeSingle()
  if (!revision || revision.project_id !== projectId) notFound()

  // Same write gate as the rest of the schedule. Page gating is not a gate on
  // its own — the actions re-check and the database policies gate the writes —
  // but a read-only role should not be shown a measuring workspace at all.
  // `.ok` — the helper returns a result object, so bare truthiness never fires.
  const roleGate = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!roleGate.ok) redirect(`/projects/${projectId}/cables/${revisionId}`)

  if (revision.status !== 'DRAFT') {
    redirect(`/projects/${projectId}/cables/${revisionId}`)
  }

  // Runs, with the node codes that name them and whatever length they already
  // carry. `supplies` holds no length: lengths live on the strands, and
  // parallels share a route, so the run's figure is any strand's figure.
  // Node codes are fetched separately rather than through a PostgREST embed.
  // `supplies` has two foreign keys into the same table (from_node_id and
  // to_node_id), which makes the embed name ambiguous and version-sensitive; a
  // second small query is cheaper than a page that silently renders every run
  // as "unknown" the day that alias changes.
  const { data: supplies } = await (supabase as any)
    .schema('cable_schedule')
    .from('supplies')
    .select('id, voltage_v, design_load_a, section, from_node_id, to_node_id')
    .eq('revision_id', revisionId)

  const supplyRows = (supplies ?? []) as any[]
  const nodeIds = [
    ...new Set(
      supplyRows.flatMap((s) => [s.from_node_id, s.to_node_id]).filter(Boolean),
    ),
  ] as string[]

  const { data: nodes } = nodeIds.length
    ? await (supabase as any)
        .schema('structure')
        .from('nodes')
        .select('id, code')
        .in('id', nodeIds)
    : { data: [] }
  const nodeCode = new Map<string, string>(
    ((nodes ?? []) as any[]).map((n) => [n.id, n.code as string]),
  )

  const { data: cables } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .select('id, supply_id, measured_length_m, length_status')
    .eq('revision_id', revisionId)

  const bySupply = new Map<string, { strands: number; lengthM: number | null }>()
  for (const c of ((cables ?? []) as any[])) {
    const cur = bySupply.get(c.supply_id) ?? { strands: 0, lengthM: null }
    cur.strands += 1
    if (cur.lengthM == null && c.measured_length_m != null) {
      cur.lengthM = Number(c.measured_length_m)
    }
    bySupply.set(c.supply_id, cur)
  }

  const { data: routes } = await (supabase as any)
    .schema('cable_schedule')
    .from('supply_routes')
    .select('id, supply_id, rise_m, drop_m, traced_length_m, total_length_m')
    .eq('revision_id', revisionId)
  const routeBySupply = new Map<string, any>(
    ((routes ?? []) as any[]).map((r) => [r.supply_id, r]),
  )

  const routeIds = ((routes ?? []) as any[]).map((r) => r.id)
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
            segments: (segsByRoute.get(route.id) ?? []).map((g) => ({
              id: g.id,
              seq: g.seq,
              floorPlanId: g.floor_plan_id,
              floorPlanName: g.floor_plan_name,
              pageIndex: g.page_index,
              points: (g.points ?? []) as number[],
              pixelsPerMeter: Number(g.pixels_per_meter),
              lengthM: Number(g.length_m),
            })),
          }
        : null,
    }
  })

  // Drawings. Every drawing in the cable projects is a PDF, so this list is
  // effectively a sheet list; the name carries the drawing number.
  const { data: plans } = await (supabase as any)
    .schema('tenants')
    .from('floor_plans')
    .select('id, name, file_path, pixels_per_meter')
    .eq('project_id', projectId)
    .eq('is_active', true)
    .order('name')

  const planRows: PlanRow[] = ((plans ?? []) as any[]).map((p) => ({
    id: p.id,
    name: p.name ?? 'Drawing',
    isPdf: String(p.file_path ?? '').toLowerCase().endsWith('.pdf'),
    filePath: p.file_path,
    pixelsPerMeter: p.pixels_per_meter == null ? null : Number(p.pixels_per_meter),
  }))

  const measured = runs.filter((r) => r.route && r.route.segments.length > 0).length

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/cables/${revisionId}`}
          style={{ fontSize: 13, color: 'var(--c-text-dim)', textDecoration: 'none' }}
        >
          ← Back to schedule {revision.code}
        </Link>
        <h1 style={{ margin: '8px 0 2px', fontSize: 20, fontWeight: 700 }}>Measure cable runs</h1>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--c-text-dim)' }}>
          {measured} of {runs.length} runs traced. Pick a run, trace its route on the drawing, add
          the rise and drop, then assign the length to the schedule.
        </p>
      </div>

      <RouteMeasureWorkspace
        projectId={projectId}
        revisionId={revisionId}
        runs={runs}
        plans={planRows}
      />
    </div>
  )
}
