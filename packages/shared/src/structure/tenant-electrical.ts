/**
 * tenant-electrical.ts — pure per-project derivation of each tenant's incoming
 * supply electrical sizing (breaker / load / amps).
 *
 * A tenant node may be fed by more than one supply; the highest-design-load feed
 * is treated as the incomer (and `multipleFeeds` is flagged). No I/O.
 */
import { deriveIncomerBreaker, type PoleConfig } from './breaker-sizing'
import { supplyParallelCapacity } from '../services/cable-calc.service'

export interface SupplyRow {
  id: string
  to_node_id: string | null
  design_load_a: number | null
}

export interface CableRow {
  derated_current_rating_a: number | null
  cores: string | null
}

export interface TenantElectrical {
  breakerA: number | null
  poleConfig: PoleConfig | null
  loadA: number | null
  capacityA: number | null
  underProtected: boolean
  multipleFeeds: boolean
  sourceRevisionId: string | null
}

/**
 * Resolve each tenant node's incomer (max design_load_a if several feed it) and
 * derive its breaker/load/amps. Returns one entry per node that has >= 1 supply.
 */
export function computeTenantElectrical(
  tenantNodeIds: string[],
  supplies: SupplyRow[],
  cablesBySupply: Map<string, CableRow[]>,
  revisionId: string | null,
): Map<string, TenantElectrical> {
  const tenantSet = new Set(tenantNodeIds)
  const byNode = new Map<string, SupplyRow[]>()
  for (const s of supplies) {
    if (s.to_node_id == null || !tenantSet.has(s.to_node_id)) continue
    const list = byNode.get(s.to_node_id) ?? []
    list.push(s)
    byNode.set(s.to_node_id, list)
  }

  const result = new Map<string, TenantElectrical>()
  for (const [nodeId, feeds] of byNode) {
    const incomer = feeds.reduce((best, s) =>
      (s.design_load_a ?? -Infinity) > (best.design_load_a ?? -Infinity) ? s : best,
    )
    const cables = cablesBySupply.get(incomer.id) ?? []
    const capacityA = cables.length > 0 ? supplyParallelCapacity(cables) : null
    const cores = cables.find((c) => c.cores != null)?.cores ?? null
    const derived = deriveIncomerBreaker({
      designLoadA: incomer.design_load_a,
      cores,
      capacityA,
    })
    result.set(nodeId, {
      breakerA: derived.breakerA,
      poleConfig: derived.poleConfig,
      loadA: incomer.design_load_a,
      capacityA,
      underProtected: derived.underProtected,
      multipleFeeds: feeds.length > 1,
      sourceRevisionId: revisionId,
    })
  }
  return result
}
