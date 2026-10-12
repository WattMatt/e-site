/**
 * shopLinkFor — what a status-plan shape's node link resolves to, from the
 * same facts the tenant schedule report reads (loadTenantShopFacts). Pure.
 */
import type { ShopLink } from '@esite/shared/status-plans'
import { shopProgressFor } from '@/lib/reports/tenant-schedule-report-compute'
import type { TenantShopFacts } from '@/lib/tenant-schedule/shop-facts'

export function shopLinkFor(facts: TenantShopFacts, nodeId: string | null): ShopLink {
  if (!nodeId) return { state: 'unlinked' }
  if (facts.decommissionedNodeIds.includes(nodeId)) return { state: 'decommissioned' }
  if (!facts.activeNodes.some((n) => n.id === nodeId)) return { state: 'unlinked' }
  return { state: 'active', facts: shopProgressFor(facts, nodeId) }
}
