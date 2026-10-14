/**
 * DB block status for distribution schematic plans (spec 2026-10-09 §3.2).
 * Driven by the linked board's order status (boardOrderStatus). Pure.
 */
import type { NodeOrderStatus } from './types'

export type DbBlockStatus = NodeOrderStatus | 'no_order' | 'unlinked'

export const DB_BLOCK_STATUS_LABEL: Record<DbBlockStatus, string> = {
  required: 'Required — not yet ordered',
  ordered: 'Ordered',
  received: 'Received',
  by_tenant: 'Supplied by tenant',
  no_order: 'No order line',
  unlinked: 'Not linked to a board',
}

export function dbBlockStatus(linked: boolean, dbOrder: NodeOrderStatus | null): DbBlockStatus {
  if (!linked) return 'unlinked'
  return dbOrder ?? 'no_order'
}
