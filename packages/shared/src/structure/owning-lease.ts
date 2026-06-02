/**
 * owning-lease.ts — pure helpers for the anchor-tenant containment tree (migration 00116).
 *
 * Design spec: docs/superpowers/specs/2026-06-02-anchor-tenant-sub-boards-design.md §4.1, §4.3.
 *
 * A node's "owning lease" is its nearest `tenant_db` at-or-above it in the
 * parent_node_id containment tree. Scope/party/BO date live on that tenant_db and
 * flow down to its descendants, stopping at every nested tenant_db (a concession
 * is its own lease). The board *feed* (cable_schedule supplies) is a separate
 * relationship and is NOT consulted here.
 *
 * Pure + in-memory over a node list the caller has already fetched — no DB access.
 */

import type { Node } from './types';
import { computeOrderRequiredBy } from './bo.service';

/**
 * The nearest `tenant_db` at-or-above `node` (inclusive) via parent_node_id.
 * Returns null when there is no tenant_db ancestor (a common-area subtree, or a
 * standalone equipment node). `nodesById` must map id → Node for every node
 * referenced by a parent_node_id; a dangling id ends the walk (null). A `seen`
 * set guards against a malformed cyclic chain so the helper never hangs.
 */
export function resolveOwningLease(
  node: Node,
  nodesById: Map<string, Node>,
): Node | null {
  let cur: Node | undefined = node;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    if (cur.kind === 'tenant_db') return cur;
    if (cur.parent_node_id === null) return null;
    seen.add(cur.id);
    cur = nodesById.get(cur.parent_node_id);
  }
  return null;
}

/** One anchor/lease grouping: a tenant_db and the nodes that resolve to it. */
export interface AnchorGroup {
  /** The owning tenant_db lease. */
  lease: Node;
  /**
   * Nodes whose owning lease is `lease` — the lease node itself plus its
   * descendant boards, but NOT nodes inside a nested tenant_db (a concession),
   * which form their own group. Order follows the input `nodes` order.
   */
  members: Node[];
}

/**
 * Group `nodes` by owning lease. Every tenant_db becomes a group (even childless —
 * its `members` is then just `[itself]`). Nodes with no owning lease (equipment,
 * common-area subtrees) are returned in `ungrouped`. Spec §4.3. Group order and
 * member order follow the input order.
 */
export function buildAnchorGroups(nodes: Node[]): {
  groups: AnchorGroup[];
  ungrouped: Node[];
} {
  const nodesById = new Map(nodes.map((n) => [n.id, n] as const));
  const groupByLeaseId = new Map<string, AnchorGroup>();
  const ungrouped: Node[] = [];

  // Seed a group per tenant_db first, so empty anchors appear in input order.
  for (const n of nodes) {
    if (n.kind === 'tenant_db') {
      groupByLeaseId.set(n.id, { lease: n, members: [] });
    }
  }
  for (const n of nodes) {
    const lease = resolveOwningLease(n, nodesById);
    if (lease) {
      groupByLeaseId.get(lease.id)!.members.push(n);
    } else {
      ungrouped.push(n);
    }
  }
  return { groups: [...groupByLeaseId.values()], ungrouped };
}

/** BO inputs for a tenant lease, supplied by the caller (wired in PR-D). */
export interface LeaseBoInputs {
  boPeriodDays: number | null;
  boDateOverride: string | null;
}

/**
 * The required-by date for a node's material order, honouring lease inheritance
 * (spec §4.3):
 *   - a node under a tenant_db lease → that lease's effective BO date;
 *   - a node with no owning lease (equipment / common-area) → the project opening date.
 *
 * `boInputsFor(leaseId)` resolves the BO inputs for a tenant_db lease id — the
 * caller owns where those live. Returns null when the underlying date is unset
 * (delegates to computeOrderRequiredBy / computeBoDate).
 */
export function computeNodeOrderRequiredBy(
  node: Node,
  nodesById: Map<string, Node>,
  openingDate: string | null,
  boInputsFor: (leaseId: string) => LeaseBoInputs | null,
): string | null {
  const lease = resolveOwningLease(node, nodesById);
  const tenant = lease ? boInputsFor(lease.id) : null;
  return computeOrderRequiredBy({ openingDate, tenant });
}
