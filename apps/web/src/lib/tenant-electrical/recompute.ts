/**
 * recompute.ts — server-only. Recomputes the persisted incomer_* electrical
 * fields on a project's tenant nodes from the latest cable revision (any status).
 *
 * Not marked with `import 'server-only'` because the backfill script imports it
 * directly under tsx (plain Node); it is nonetheless server-only by construction
 * (needs the service-role key) and is only referenced from server actions + the
 * backfill.
 *
 * Cross-schema WRITE gotcha (CLAUDE.md 2026-05-18): supabase-js `.schema('structure')`
 * silently drops the service-role auth header on UPDATE → RLS denies. Writes here
 * use raw PostgREST PATCH with Content-Profile: structure + the service-role key.
 * Reads go through the service client (RLS-bypassing).
 */
import { createServiceClient } from '@/lib/supabase/server'
import { computeTenantElectrical, type SupplyRow, type CableRow } from '@esite/shared'

function serverEnv(): { supabaseUrl: string; serviceKey: string } | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return null
  return { supabaseUrl, serviceKey }
}

export async function recomputeTenantElectrical(
  projectId: string,
): Promise<{ updated: number } | { error: string }> {
  const env = serverEnv()
  if (!env) return { error: 'Server misconfigured' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  // Tenant nodes (active + decommissioned; deleted excluded).
  const { data: nodeRows, error: nodeErr } = await service
    .schema('structure')
    .from('nodes')
    .select('id')
    .eq('project_id', projectId)
    .eq('kind', 'tenant_db')
    .is('deleted_at', null)
  if (nodeErr) return { error: nodeErr.message }
  const nodeIds = (nodeRows ?? []).map((n: { id: string }) => n.id)
  if (nodeIds.length === 0) return { updated: 0 }

  // Latest revision of any status for this project.
  const { data: rev } = await service
    .schema('cable_schedule')
    .from('revisions')
    .select('id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const revisionId = (rev as { id: string } | null)?.id ?? null

  let supplies: SupplyRow[] = []
  const cablesBySupply = new Map<string, CableRow[]>()
  if (revisionId) {
    const { data: supplyRows } = await service
      .schema('cable_schedule')
      .from('supplies')
      .select('id, to_node_id, design_load_a')
      .eq('revision_id', revisionId)
      .in('to_node_id', nodeIds)
    supplies = (supplyRows ?? []) as SupplyRow[]

    const supplyIds = supplies.map((s) => s.id)
    if (supplyIds.length > 0) {
      const { data: cableRows } = await service
        .schema('cable_schedule')
        .from('cables')
        .select('supply_id, derated_current_rating_a, cores')
        .eq('revision_id', revisionId)
        .in('supply_id', supplyIds)
      for (const c of (cableRows ?? []) as Array<CableRow & { supply_id: string }>) {
        const list = cablesBySupply.get(c.supply_id) ?? []
        list.push({ derated_current_rating_a: c.derated_current_rating_a, cores: c.cores })
        cablesBySupply.set(c.supply_id, list)
      }
    }
  }

  const computed = computeTenantElectrical(nodeIds, supplies, cablesBySupply, revisionId)
  const now = new Date().toISOString()

  // PATCH each tenant node (raw PostgREST — Content-Profile: structure).
  const headers: HeadersInit = {
    apikey: env.serviceKey,
    Authorization: `Bearer ${env.serviceKey}`,
    'Content-Type': 'application/json',
    'Content-Profile': 'structure',
    Prefer: 'return=minimal',
  }

  let updated = 0
  for (const nodeId of nodeIds) {
    const e = computed.get(nodeId)
    const patch = e
      ? {
          incomer_breaker_a: e.breakerA,
          incomer_pole_config: e.poleConfig,
          incomer_load_a: e.loadA,
          incomer_capacity_a: e.capacityA,
          incomer_under_protected: e.underProtected,
          incomer_multiple_feeds: e.multipleFeeds,
          incomer_source_revision_id: e.sourceRevisionId,
          incomer_computed_at: now,
        }
      : {
          incomer_breaker_a: null,
          incomer_pole_config: null,
          incomer_load_a: null,
          incomer_capacity_a: null,
          incomer_under_protected: false,
          incomer_multiple_feeds: false,
          incomer_source_revision_id: revisionId,
          incomer_computed_at: now,
        }
    const res = await fetch(`${env.supabaseUrl}/rest/v1/nodes?id=eq.${nodeId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(patch),
    })
    if (res.ok) updated += 1
  }
  return { updated }
}
