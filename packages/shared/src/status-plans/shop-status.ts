/**
 * Shop status for tenant layout plans (spec 2026-10-09 §3.1). Pure.
 *
 * A missing order row is NOT evidence of done: a shop with no DB (or no
 * lights) order counts that item as not yet complete.
 */
import type { NodeOrderStatus, ScopeState } from './types'

export type ShopStatus = 'complete' | 'in_progress' | 'decommissioned' | 'unlinked'

/** The per-shop facts the tenant schedule report already computes (its ShopRow is assignable to this). */
export interface ShopProgressFacts {
  scope: ScopeState
  layoutIssued: boolean
  db: NodeOrderStatus | null
  lights: NodeOrderStatus | null
  /** Effective beneficial-occupation date, ISO yyyy-mm-dd, or null. */
  boDate: string | null
}

/** What a shape's link resolves to, before status is computed. */
export type ShopLink =
  | { state: 'unlinked' }
  | { state: 'decommissioned' }
  | { state: 'active'; facts: ShopProgressFacts }

export interface ShopStatusResult {
  status: ShopStatus
  /** Not complete and the BO date has passed. Drawn as an overlay over the base fill. */
  overdue: boolean
}

export const SHOP_STATUS_LABEL: Record<ShopStatus, string> = {
  complete: 'Complete',
  in_progress: 'In progress',
  decommissioned: 'Decommissioned',
  unlinked: 'Unassigned',
}

const ORDER_DONE: ReadonlySet<NodeOrderStatus> = new Set<NodeOrderStatus>(['received', 'by_tenant'])

export function isShopComplete(f: ShopProgressFacts): boolean {
  const scopeDone = f.scope === 'received' || f.scope === 'not_required'
  const dbDone = f.db !== null && ORDER_DONE.has(f.db)
  const lightsDone = f.lights !== null && ORDER_DONE.has(f.lights)
  return scopeDone && f.layoutIssued && dbDone && lightsDone
}

/** `today` is ISO yyyy-mm-dd; compared as a string, exactly as the report does. */
export function shopStatus(link: ShopLink, today: string): ShopStatusResult {
  if (link.state === 'unlinked') return { status: 'unlinked', overdue: false }
  if (link.state === 'decommissioned') return { status: 'decommissioned', overdue: false }
  if (isShopComplete(link.facts)) return { status: 'complete', overdue: false }
  const bo = link.facts.boDate
  return { status: 'in_progress', overdue: bo !== null && bo < today }
}
