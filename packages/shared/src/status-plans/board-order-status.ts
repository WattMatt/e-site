/**
 * boardOrderStatus — the ONE rule for "what is this board's order status".
 *
 * The Equipment & Materials schedule (apps/web gather-unified-boards.ts) and
 * the line-diagram status plan both call it, so the plan cannot drift from the
 * schedule again (2026-10-14: the plan read only scope-type 'db' lines, so main
 * boards, mini subs, RMUs, common-area boards and generators — which order the
 * board itself as an untyped line — were all drawn as "no order").
 *
 * - tenant_db: the status of its DB line (scope type key 'db'); none → null.
 * - every other kind: the status of its FIRST line in schedule order (label,
 *   then id) — exactly the schedule's summary; no line → 'required', because an
 *   orderless equipment board is still a buy-list item that needs ordering.
 * Pure.
 */
import type { NodeOrderStatus } from './types'

export interface BoardOrderLine {
  /** scope_item_types.key of the line; null = the untyped board line. */
  scopeKey: string | null
  status: NodeOrderStatus
}

export interface BoardOrderInput {
  kind: string
  /** The node's lines, in schedule order (label asc, then id). */
  lines: readonly BoardOrderLine[]
}

export const TENANT_BOARD_KIND = 'tenant_db'
export const DB_SCOPE_KEY = 'db'

export function boardOrderStatus(input: BoardOrderInput): NodeOrderStatus | null {
  if (input.kind === TENANT_BOARD_KIND) {
    return input.lines.find((l) => l.scopeKey === DB_SCOPE_KEY)?.status ?? null
  }
  return input.lines[0]?.status ?? 'required'
}
