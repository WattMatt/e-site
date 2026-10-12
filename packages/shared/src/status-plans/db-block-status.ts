/**
 * DB block status for distribution schematic plans (spec 2026-10-09 §3.2).
 * Driven by the linked node's DB order (scope_item_types.key = 'db'). Pure.
 */
import type { NodeOrderStatus } from './types'

export type DbBlockStatus = NodeOrderStatus | 'no_order' | 'unlinked'

export const DB_BLOCK_STATUS_LABEL: Record<DbBlockStatus, string> = {
  required: 'Required',
  ordered: 'Ordered',
  received: 'Received',
  by_tenant: 'By tenant',
  no_order: 'No DB order',
  unlinked: 'Unlinked',
}

export function dbBlockStatus(linked: boolean, dbOrder: NodeOrderStatus | null): DbBlockStatus {
  if (!linked) return 'unlinked'
  return dbOrder ?? 'no_order'
}
