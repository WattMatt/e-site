/**
 * Which main board feeds a shop (spec 2026-10-13 §1). Pure.
 *
 * structure.nodes.parent_node_id is NULL for every node (measured 2026-10-13), so the
 * feed path comes from the cable schedule: each supply is an edge from_node_id →
 * to_node_id. Walking UPSTREAM from a tenant DB, breadth-first, the first hop that
 * reaches a main board decides it. Several boards at that hop: the first by name
 * (compareBoardNames) wins and the others are reported as `also` ("Also fed from").
 * At most FEED_MAX_HOPS hops; a visited set makes cycles harmless.
 */

export const FEED_MAX_HOPS = 12

/** One supply: from_node_id → to_node_id. */
export interface FeedEdge {
  from: string
  to: string
}

/** A main board: its node id and the name shown in the legend. */
export interface FeedBoard {
  id: string
  name: string
}

export interface FeedMatch {
  boardId: string
  /** Other main boards at the same distance, by name. */
  also: string[]
  /** Supplies walked; 0 when the node is itself a main board. */
  hops: number
}

/** "MB 2.1" before "MB 10.1"; case-insensitive; id breaks a tie so the order is total. */
export function compareBoardNames(a: FeedBoard, b: FeedBoard): number {
  return a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

function upstreamIndex(edges: readonly FeedEdge[]): Map<string, string[]> {
  const up = new Map<string, string[]>()
  for (const edge of edges) {
    if (!edge.from || !edge.to || edge.from === edge.to) continue
    const list = up.get(edge.to)
    if (!list) up.set(edge.to, [edge.from])
    else if (!list.includes(edge.from)) list.push(edge.from)
  }
  return up
}

function walk(
  up: ReadonlyMap<string, readonly string[]>,
  boards: ReadonlyMap<string, FeedBoard>,
  start: string,
  maxHops: number,
): FeedMatch | null {
  if (boards.has(start)) return { boardId: start, also: [], hops: 0 }
  const seen = new Set<string>([start])
  let frontier = [start]
  for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
    const next: string[] = []
    for (const node of frontier) {
      for (const parent of up.get(node) ?? []) {
        if (seen.has(parent)) continue
        seen.add(parent)
        next.push(parent)
      }
    }
    const found = next.flatMap((id) => {
      const b = boards.get(id)
      return b ? [b] : []
    }).sort(compareBoardNames)
    if (found.length > 0) return { boardId: found[0]!.id, also: found.slice(1).map((b) => b.id), hops: hop }
    frontier = next
  }
  return null
}

/** The nearest main board upstream of `nodeId`, or null when none is within maxHops. */
export function feedingMainBoard(
  edges: readonly FeedEdge[],
  boards: readonly FeedBoard[],
  nodeId: string,
  maxHops: number = FEED_MAX_HOPS,
): FeedMatch | null {
  return walk(upstreamIndex(edges), new Map(boards.map((b) => [b.id, b])), nodeId, maxHops)
}

/** feedingMainBoard for many nodes, building the index once. */
export function feedsFor(
  edges: readonly FeedEdge[],
  boards: readonly FeedBoard[],
  nodeIds: readonly string[],
  maxHops: number = FEED_MAX_HOPS,
): Record<string, FeedMatch | null> {
  const up = upstreamIndex(edges)
  const byId = new Map(boards.map((b) => [b.id, b]))
  return Object.fromEntries(nodeIds.map((id) => [id, walk(up, byId, id, maxHops)]))
}
