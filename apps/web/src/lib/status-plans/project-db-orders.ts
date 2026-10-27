/**
 * loadProjectDbOrderStatus — the order status of every live board on a project,
 * for distribution-schematic (line diagram) plans (spec §3.2).
 *
 * The status comes from boardOrderStatus (@esite/shared/status-plans), the same
 * rule the Equipment & Materials schedule uses, fed the same rows in the same
 * order (node_orders by label, then id):
 *   - a tenant board shows its DB line (scope type key 'db'); none → no entry,
 *     drawn as "No order line";
 *   - every other board (main boards, mini subs, RMUs, common-area boards,
 *     generators, custom) shows its board line — orders the board itself as an
 *     untyped node_orders line — and with no line at all reads 'required'.
 * Before 2026-10-14 only 'db'-typed lines were read, so every equipment board
 * was drawn as having no order while the schedule showed it correctly.
 *
 * A failed read THROWS: answering {} would draw every block as unordered, a
 * confident wrong picture. The caller must have gated project access; RLS on
 * the session client is that gate here.
 */
import { boardOrderStatus, type NodeOrderStatus } from '@esite/shared/status-plans'
import { readAll } from '@/lib/tender/read-all'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ProjectDbOrderArgs {
  projectId: string
  orgId: string
}

export interface BoardOrderRows {
  nodes: ReadonlyArray<{ id: string; kind: string }>
  /** In schedule order: label asc, then id. */
  orders: ReadonlyArray<{ node_id: string; scope_item_type_id: string | null; status: NodeOrderStatus }>
  /** scope_item_types id → key, for the project's org. */
  scopeKeyById: ReadonlyMap<string, string>
}

/** Pure: the status of every given node that has one. */
export function boardOrderStatusByNode(rows: BoardOrderRows): Record<string, NodeOrderStatus> {
  const linesByNode = new Map<string, Array<{ scopeKey: string | null; status: NodeOrderStatus }>>()
  for (const o of rows.orders) {
    const list = linesByNode.get(o.node_id) ?? []
    // An unknown type id (another org's) is still a typed line, never the board line.
    const scopeKey = o.scope_item_type_id === null ? null : rows.scopeKeyById.get(o.scope_item_type_id) ?? '?'
    list.push({ scopeKey, status: o.status })
    linesByNode.set(o.node_id, list)
  }
  const out: Record<string, NodeOrderStatus> = {}
  for (const n of rows.nodes) {
    const status = boardOrderStatus({ kind: n.kind, lines: linesByNode.get(n.id) ?? [] })
    if (status !== null) out[n.id] = status
  }
  return out
}

export async function loadProjectDbOrderStatus(
  client: unknown,
  args: ProjectDbOrderArgs,
): Promise<Record<string, NodeOrderStatus>> {
  const db = client as any
  const types = await db.schema('structure').from('scope_item_types')
    .select('id, key').eq('organisation_id', args.orgId)
  if (types.error) throw new Error(`DB orders: ${types.error.message}`)
  const scopeKeyById = new Map(((types.data ?? []) as Array<{ id: string; key: string }>).map((t) => [t.id, t.key]))

  const nodes = await readAll<{ id: string; kind: string }>((from, to) =>
    db.schema('structure').from('nodes')
      .select('id, kind')
      .eq('project_id', args.projectId)
      .is('deleted_at', null)
      .order('id')
      .range(from, to),
  )
  if ('error' in nodes) throw new Error(`DB orders: ${nodes.error}`)

  const orders = await readAll<{ id: string; node_id: string; scope_item_type_id: string | null; status: NodeOrderStatus }>((from, to) =>
    db.schema('structure').from('node_orders')
      .select('id, node_id, label, scope_item_type_id, status')
      .eq('project_id', args.projectId)
      .order('label')
      .order('id')
      .range(from, to),
  )
  if ('error' in orders) throw new Error(`DB orders: ${orders.error}`)

  return boardOrderStatusByNode({ nodes: nodes.data, orders: orders.data, scopeKeyById })
}
