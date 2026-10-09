/**
 * loadProjectDbOrderStatus — the DB order status of every node on a project
 * that has one, for distribution-schematic plans (spec §3.2).
 *
 * The tenant schedule's loadTenantShopFacts reads tenant nodes only; a
 * schematic links main boards and common-area boards too. "DB order" is the
 * node_orders row whose scope item type has key 'db' in the project's org
 * (00083: unique per node and scope type, so a node has at most one).
 *
 * A failed read THROWS: answering {} would draw every block as "No DB order",
 * a confident wrong picture. The caller must have gated project access; RLS on
 * the session client is that gate here.
 */
import type { NodeOrderStatus } from '@esite/shared/status-plans'
import { readAll } from '@/lib/tender/read-all'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ProjectDbOrderArgs {
  projectId: string
  orgId: string
}

export async function loadProjectDbOrderStatus(
  client: unknown,
  args: ProjectDbOrderArgs,
): Promise<Record<string, NodeOrderStatus>> {
  const db = client as any
  const types = await db.schema('structure').from('scope_item_types')
    .select('id').eq('organisation_id', args.orgId).eq('key', 'db')
  if (types.error) throw new Error(`DB orders: ${types.error.message}`)
  const typeIds = ((types.data ?? []) as Array<{ id: string }>).map((t) => t.id)
  if (typeIds.length === 0) return {}

  const rows = await readAll<{ id: string; node_id: string; status: NodeOrderStatus }>((from, to) =>
    db.schema('structure').from('node_orders')
      .select('id, node_id, status')
      .eq('project_id', args.projectId)
      .in('scope_item_type_id', typeIds)
      .order('id')
      .range(from, to),
  )
  if ('error' in rows) throw new Error(`DB orders: ${rows.error}`)

  const out: Record<string, NodeOrderStatus> = {}
  for (const r of rows.data) out[r.node_id] = r.status
  return out
}
