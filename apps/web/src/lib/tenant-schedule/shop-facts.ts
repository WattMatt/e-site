/**
 * loadTenantShopFacts — the ONE read of per-shop progress facts.
 *
 * The tenant schedule report and status plans both call it, so the report, the
 * plan and any screen built on it cannot drift (spec 2026-10-09 §6).
 *
 * The CALLER must already have gated project access: the client passed in may
 * be the service client, which bypasses RLS and site scope.
 */
import { listNodes, computeBoDate } from '@esite/shared'
import type { ComputeInput, OrderStatus } from '@/lib/reports/tenant-schedule-report-compute'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface TenantShopFacts extends Omit<ComputeInput, 'today'> {
  /** Tenant nodes whose status is decommissioned (soft-deleted nodes are excluded entirely). */
  decommissionedNodeIds: string[]
}

export interface LoadTenantShopFactsArgs {
  projectId: string
  orgId: string
  /** projects.opening_date, used to derive BO dates from bo_period_days. */
  openingDate: string | null
}

export async function loadTenantShopFacts(client: unknown, args: LoadTenantShopFactsArgs): Promise<TenantShopFacts> {
  const db = client as any
  const { projectId, orgId, openingDate } = args

  // Tenant nodes (active + decommissioned carry a `status`; soft-deleted are excluded by listNodes).
  const allNodes = await listNodes(db as never, projectId, { kind: 'tenant_db' })
  const isDecommissioned = (n: unknown) => (n as { status?: string }).status === 'decommissioned'
  const activeNodesRaw = allNodes.filter((n) => !isDecommissioned(n))
  const decommissionedNodeIds = allNodes.filter(isDecommissioned).map((n) => n.id)
  const nodeIds = activeNodesRaw.map((n) => n.id)

  const [typesRes, detailsRes, ordersRes] = await Promise.all([
    db.schema('structure').from('scope_item_types')
      .select('id, key').eq('organisation_id', orgId),
    nodeIds.length
      ? db.schema('structure').from('tenant_details')
          .select('node_id, scope_status, scope_not_required, layout_status, bo_period_days, bo_date_override').in('node_id', nodeIds)
      : Promise.resolve({ data: [] }),
    nodeIds.length
      ? db.schema('structure').from('node_orders')
          .select('node_id, scope_item_type_id, status').in('node_id', nodeIds).not('scope_item_type_id', 'is', null)
      : Promise.resolve({ data: [] }),
  ])

  const types = (typesRes.data ?? []) as Array<{ id: string; key: string }>
  const scopeTypeIdByKey = {
    db: types.find((t) => t.key === 'db')?.id ?? null,
    lighting: types.find((t) => t.key === 'lighting')?.id ?? null,
  }

  const detailsByNode: ComputeInput['detailsByNode'] = new Map()
  const boByNode: ComputeInput['boByNode'] = new Map()
  for (const d of (detailsRes.data ?? []) as Array<{
    node_id: string; scope_status: string | null; scope_not_required: boolean | null; layout_status: string | null
    bo_period_days: number | null; bo_date_override: string | null
  }>) {
    detailsByNode.set(d.node_id, {
      scopeReceived: d.scope_status === 'received',
      scopeNotRequired: d.scope_not_required === true,
      layoutIssued: d.layout_status === 'issued',
    })
    boByNode.set(d.node_id, {
      effectiveDate: computeBoDate(openingDate, d.bo_period_days ?? null, d.bo_date_override ?? null),
    })
  }

  const orderStatusByNodeScope: ComputeInput['orderStatusByNodeScope'] = new Map()
  for (const o of (ordersRes.data ?? []) as Array<{ node_id: string; scope_item_type_id: string; status: OrderStatus }>) {
    orderStatusByNodeScope.set(`${o.node_id}:${o.scope_item_type_id}`, o.status)
  }

  return {
    activeNodes: activeNodesRaw.map((n) => ({
      id: n.id,
      shopNumber: (n as { shop_number?: string | null }).shop_number ?? (n as { code?: string }).code ?? '—',
      shopName: (n as { shop_name?: string | null }).shop_name ?? (n as { name?: string | null }).name ?? '—',
      glaM2: (n as { shop_area_m2?: number | null }).shop_area_m2 ?? null,
      // Incoming-supply electrical: a manual node breaker wins; otherwise the
      // value derived from the cable schedule (persisted incomer_* columns).
      breakerA:
        (n as { breaker_rating_a?: number | null }).breaker_rating_a ??
        (n as { incomer_breaker_a?: number | null }).incomer_breaker_a ?? null,
      poleConfig:
        (n as { pole_config?: string | null }).pole_config ??
        (n as { incomer_pole_config?: string | null }).incomer_pole_config ?? null,
      loadA: (n as { incomer_load_a?: number | null }).incomer_load_a ?? null,
    })),
    decommissionedCount: decommissionedNodeIds.length,
    decommissionedNodeIds,
    scopeTypeIdByKey,
    detailsByNode,
    orderStatusByNodeScope,
    boByNode,
  }
}
