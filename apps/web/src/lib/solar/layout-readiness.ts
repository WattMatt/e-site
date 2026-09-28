import 'server-only'
/**
 * The Layout readiness step from solar.layouts.summary (a server-computed cache,
 * 00211) and the roof sources' north — never the geometry, so the tab dot costs
 * two small reads on every Solar page. Returns null on a read error (the step
 * then stays grey rather than guessing).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LayoutReadinessInput } from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export async function loadLayoutReadiness(supabase: AnyClient, projectId: string): Promise<LayoutReadinessInput | null> {
  const [lr, rr] = await Promise.all([
    supabase.schema('solar').from('layouts').select('roof_source_id, summary').eq('project_id', projectId),
    supabase.schema('solar').from('roof_sources').select('id, north_bearing_deg').eq('project_id', projectId),
  ])
  if (lr.error || rr.error) return null
  const layouts = (lr.data ?? []) as Array<{ roof_source_id: string; summary: Record<string, unknown> | null }>
  const north = new Map(((rr.data ?? []) as Array<{ id: string; north_bearing_deg: unknown }>).map((r) => [r.id, r.north_bearing_deg !== null]))
  return {
    layouts: layouts.length,
    arraysWithModules: layouts.reduce((s, l) => s + (Number(l.summary?.arraysWithModules) || 0), 0),
    // Spec §2.3 green = ≥ 1 array with modules and a north reference: ONE complete
    // layout is enough; an empty draft on an un-north'd sheet must not hold it back.
    northSet: layouts.some((l) => north.get(l.roof_source_id) === true && (Number(l.summary?.arraysWithModules) || 0) > 0)
      || (layouts.length > 0 && layouts.every((l) => north.get(l.roof_source_id) === true)),
    arrayOutsideRoof: layouts.some((l) => l.summary?.arrayOutsideRoof === true),
  }
}
