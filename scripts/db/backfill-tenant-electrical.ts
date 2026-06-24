/**
 * backfill-tenant-electrical.ts — one-off: populate the persisted incomer_*
 * electrical fields on every project's tenant nodes (or a single project via
 * PROJECT_ID). Run after migration 00144.
 *
 * Self-contained (raw PostgREST + the shared pure compute) so it runs under tsx
 * without Next's `@/` aliases or runtime. Reuses computeTenantElectrical so the
 * derivation logic stays single-sourced; only the read/PATCH plumbing is local.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     pnpm --filter @esite/shared exec tsx ../../scripts/db/backfill-tenant-electrical.ts
 *   (optional) PROJECT_ID=<uuid> to limit to one project.
 */
// Import the specific source module (not the '@esite/shared' barrel) so tsx
// resolves cleanly without pulling the whole package.
import {
  computeTenantElectrical,
  type SupplyRow,
  type CableRow,
} from '../../packages/shared/src/structure/tenant-electrical'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const auth = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function restGet<T>(profile: string, table: string, query: string): Promise<T[]> {
  const res = await fetch(`${URL}/rest/v1/${table}?${query}`, {
    headers: { ...auth, 'Accept-Profile': profile },
  })
  if (!res.ok) throw new Error(`GET ${profile}.${table} ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json() as Promise<T[]>
}

async function restPatch(profile: string, table: string, query: string, body: unknown): Promise<void> {
  const res = await fetch(`${URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json', 'Content-Profile': profile, Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${profile}.${table} ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

async function backfillProject(projectId: string): Promise<number> {
  const nodes = await restGet<{ id: string }>(
    'structure', 'nodes',
    `select=id&project_id=eq.${projectId}&kind=eq.tenant_db&deleted_at=is.null`,
  )
  const nodeIds = nodes.map((n) => n.id)
  if (nodeIds.length === 0) return 0

  const revs = await restGet<{ id: string }>(
    'cable_schedule', 'revisions',
    `select=id&project_id=eq.${projectId}&order=created_at.desc&limit=1`,
  )
  const revisionId = revs[0]?.id ?? null

  let supplies: SupplyRow[] = []
  const cablesBySupply = new Map<string, CableRow[]>()
  if (revisionId) {
    supplies = await restGet<SupplyRow>(
      'cable_schedule', 'supplies',
      `select=id,to_node_id,design_load_a&revision_id=eq.${revisionId}&to_node_id=in.(${nodeIds.join(',')})`,
    )
    const supplyIds = supplies.map((s) => s.id)
    if (supplyIds.length > 0) {
      const cables = await restGet<CableRow & { supply_id: string }>(
        'cable_schedule', 'cables',
        `select=supply_id,derated_current_rating_a,cores&revision_id=eq.${revisionId}&supply_id=in.(${supplyIds.join(',')})`,
      )
      for (const c of cables) {
        const list = cablesBySupply.get(c.supply_id) ?? []
        list.push({ derated_current_rating_a: c.derated_current_rating_a, cores: c.cores })
        cablesBySupply.set(c.supply_id, list)
      }
    }
  }

  const computed = computeTenantElectrical(nodeIds, supplies, cablesBySupply, revisionId)
  const now = new Date().toISOString()
  let updated = 0
  for (const nodeId of nodeIds) {
    const e = computed.get(nodeId)
    const patch = e
      ? {
          incomer_breaker_a: e.breakerA, incomer_pole_config: e.poleConfig,
          incomer_load_a: e.loadA, incomer_capacity_a: e.capacityA,
          incomer_under_protected: e.underProtected, incomer_multiple_feeds: e.multipleFeeds,
          incomer_source_revision_id: e.sourceRevisionId, incomer_computed_at: now,
        }
      : {
          incomer_breaker_a: null, incomer_pole_config: null, incomer_load_a: null,
          incomer_capacity_a: null, incomer_under_protected: false, incomer_multiple_feeds: false,
          incomer_source_revision_id: revisionId, incomer_computed_at: now,
        }
    await restPatch('structure', 'nodes', `id=eq.${nodeId}`, patch)
    updated += 1
  }
  return updated
}

async function main() {
  const only = process.env.PROJECT_ID
  let projectIds: string[]
  if (only) {
    projectIds = [only]
  } else {
    const projects = await restGet<{ id: string }>('projects', 'projects', 'select=id')
    projectIds = projects.map((p) => p.id)
  }
  for (const id of projectIds) {
    const updated = await backfillProject(id)
    console.log(`${id}: ${updated} tenant node(s) recomputed`)
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
