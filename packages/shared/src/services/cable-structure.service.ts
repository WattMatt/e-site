/**
 * Cable Schedule structure tree — pure functions over raw row data.
 *
 * The "structure" of a revision is its supply graph: each `supply` row is a
 * feed edge from a source/node to a node. `buildStructureTree` turns the
 * flat sources/nodes/supplies into a forest:
 *   - roots  = every source, with its fed subtree
 *   - unfed  = nodes with no incoming supply, each with their own subtree
 *
 * ### Ring topology
 *
 * Cable schedules model **ring mains** as cable daisy-chains with a closing
 * back-edge — e.g. RMU → T1 → T2 → T3 → T4 → T5 → RMU (the last cable is the
 * ring closure). Rendering this literally as a deep nested tree is misleading
 * — to an engineer the 5 transformers are *peers on the ring*, not parents
 * and grandchildren of each other.
 *
 * This function detects rings (cycles in the directed supply graph reached
 * via DFS from a source) and flattens them: every ring member becomes a
 * direct child of the **ring entry parent** (the node where the ring closes
 * back), in cable-order. The closing back-edge is annotated on the last
 * ring member via `ringClosesBackTo` so the ring topology is still visible.
 *
 * Each ring member keeps its own non-ring downstream subtree (e.g. a
 * transformer's main board + sub-boards still nest under that transformer).
 *
 * ### Multi-fed boards (non-ring)
 *
 * A board fed by more than one supply that **doesn't** form a ring (e.g.
 * normal + standby feeds) still appears under each feeder; the 2nd-and-later
 * occurrences are flagged `alsoFedElsewhere` and not re-expanded.
 *
 * No DB access — the per-edge `feedSummary` and the blast-radius counts are
 * supplied by the caller via the `decorate` callbacks, so this stays pure
 * and unit-testable.
 */

export interface StructureFeedSummary {
  /** Number of cables on the feeding supply. */
  cableCount: number
  /** Human label for the feeding cable(s), e.g. "5×300mm² Cu" or "—". */
  sizeLabel: string
  /** Per-supply volt-drop %. */
  vdPct: number
  /** True when the supply's combined capacity is below its design load. */
  underRated: boolean
}

export interface StructureTreeNode {
  id: string
  code: string
  category: 'source' | 'node'
  /** source.type or structure.nodes.kind */
  nodeType: string
  /** The supply edge feeding this node — null for sources and unfed-board roots. */
  feedSummary: StructureFeedSummary | null
  children: StructureTreeNode[]
  /**
   * True when this is a 2nd-or-later occurrence of a board genuinely fed by
   * more than one supply (e.g. normal + standby). Distinct from a ring
   * closure: ring members are flattened into siblings, not marked here.
   */
  alsoFedElsewhere: boolean
  /**
   * Set on the last member of a detected ring — value is the `code` of the
   * ring entry parent that the closing back-edge cable connects to.
   * Renderers should show this as "↻ closes ring back to <code>".
   */
  ringClosesBackTo: string | null
  /** Cascade-delete counts for the remove-confirm modal. */
  blastSupplies: number
  blastCables: number
}

interface TreeSource { id: string; code: string; type: string }
interface TreeNode { id: string; code: string; kind: string }
interface TreeSupply {
  id: string
  from_source_id: string | null
  from_node_id: string | null
  to_node_id: string
}

export function buildStructureTree(
  sources: TreeSource[],
  nodes: TreeNode[],
  supplies: TreeSupply[],
  decorate: {
    feedSummaryFor: (supplyId: string) => StructureFeedSummary | null
    blastFor: (id: string, category: 'source' | 'node') => { blastSupplies: number; blastCables: number }
  },
): { roots: StructureTreeNode[]; unfed: StructureTreeNode[] } {
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const))
  const sourceById = new Map(sources.map((s) => [s.id, s] as const))
  const nameOf = (id: string): string =>
    sourceById.get(id)?.code ?? nodeById.get(id)?.code ?? '?'

  // supplies grouped by their from-id (source XOR node)
  const suppliesByFrom = new Map<string, TreeSupply[]>()
  for (const s of supplies) {
    const fromId = s.from_source_id ?? s.from_node_id
    if (!fromId) continue
    const list = suppliesByFrom.get(fromId) ?? []
    list.push(s)
    suppliesByFrom.set(fromId, list)
  }

  // -------------------------------------------------------------------------
  // Pass 1 — Detect rings via DFS from every source.
  //
  // A ring is signalled by a back-edge: a supply whose `to_board_id` is
  // already on the current DFS path (an ancestor of the supply's `from`).
  // When we see one, the ring members are the path slice between the
  // back-edge target (the entry parent) and the supply's from-node, in
  // cable order.
  //
  // Outputs:
  //   ringMember:        member_id  →  { entryParent_id, order }
  //   ringEntry:         entry_id   →  ordered member ids (for sibling render)
  //   closureSupplyIds:  supply ids that are ring closures (skip when walking
  //                      a ring member's children — they don't recurse)
  //   closureAnnotation: last_member_id → entry parent's display code
  // -------------------------------------------------------------------------

  const ringMember = new Map<string, { entryParent: string; order: number }>()
  const ringEntry = new Map<string, string[]>()
  const closureSupplyIds = new Set<string>()
  const closureAnnotation = new Map<string, string>()

  function detectRingsFrom(rootId: string) {
    const path: string[] = []
    const pathSet = new Set<string>()

    function walk(currentId: string) {
      path.push(currentId)
      pathSet.add(currentId)

      for (const sup of suppliesByFrom.get(currentId) ?? []) {
        const to = sup.to_node_id
        if (pathSet.has(to)) {
          // Back-edge → ring closure cable.
          closureSupplyIds.add(sup.id)
          const idx = path.indexOf(to)
          if (idx >= 0) {
            const entryParentId = to
            const members = path.slice(idx + 1) // chain from first ring member to currentId
            const existingOrder = ringEntry.get(entryParentId) ?? []
            for (const memberId of members) {
              if (!ringMember.has(memberId)) {
                ringMember.set(memberId, { entryParent: entryParentId, order: existingOrder.length })
                existingOrder.push(memberId)
              }
            }
            ringEntry.set(entryParentId, existingOrder)
            const lastMember = members[members.length - 1]
            if (lastMember && !closureAnnotation.has(lastMember)) {
              closureAnnotation.set(lastMember, nameOf(entryParentId))
            }
          }
          // Don't recurse — `to` is on the path
        } else {
          walk(to)
        }
      }

      path.pop()
      pathSet.delete(currentId)
    }

    walk(rootId)
  }

  for (const s of sources) detectRingsFrom(s.id)

  // -------------------------------------------------------------------------
  // Pass 2 — Build the tree, applying ring flattening.
  // -------------------------------------------------------------------------

  // The first supply whose to_node_id == X — used as the "feeding supply"
  // when a ring member is added under its entry parent instead of its
  // immediate supply-graph parent.
  const firstSupplyTo = new Map<string, string>()
  for (const s of supplies) {
    if (!firstSupplyTo.has(s.to_node_id)) firstSupplyTo.set(s.to_node_id, s.id)
  }

  // Boards whose subtree has already been emitted (cross-tree dedupe).
  const expanded = new Set<string>()

  function build(
    id: string,
    code: string,
    category: 'source' | 'node',
    nodeType: string,
    feedingSupplyId: string | null,
    visiting: Set<string>,
  ): StructureTreeNode {
    const isRepeat = category === 'node' && (expanded.has(id) || visiting.has(id))
    const node: StructureTreeNode = {
      id,
      code,
      category,
      nodeType,
      feedSummary: feedingSupplyId ? decorate.feedSummaryFor(feedingSupplyId) : null,
      children: [],
      alsoFedElsewhere: isRepeat,
      ringClosesBackTo: closureAnnotation.get(id) ?? null,
      ...decorate.blastFor(id, category),
    }
    if (isRepeat) return node
    if (category === 'node') expanded.add(id)

    const nextVisiting = new Set(visiting)
    nextVisiting.add(id)

    const childrenAdded = new Set<string>()

    // (a) If this node is a ring entry parent, render every ring member as a
    //     direct child in cable-order. Each member is fed by whichever supply
    //     targets it (the first cable in firstSupplyTo).
    for (const memberId of ringEntry.get(id) ?? []) {
      if (childrenAdded.has(memberId)) continue
      const memberNode = nodeById.get(memberId)
      if (!memberNode) continue
      childrenAdded.add(memberId)
      const feedId = firstSupplyTo.get(memberId) ?? null
      node.children.push(build(
        memberNode.id, memberNode.code, 'node', memberNode.kind,
        feedId, nextVisiting,
      ))
    }

    // (b) Process this node's outgoing supplies for all non-ring children.
    for (const sup of suppliesByFrom.get(id) ?? []) {
      // Skip the ring-closure cable from this ring member back to the entry
      // parent — already annotated via `ringClosesBackTo`.
      if (closureSupplyIds.has(sup.id)) continue
      const childId = sup.to_node_id
      if (childrenAdded.has(childId)) continue
      // If childId is a ring member whose entry parent isn't us, skip — its
      // entry parent already added it (or will). This breaks the daisy-chain
      // edge from one ring member to the next.
      const childRing = ringMember.get(childId)
      if (childRing && childRing.entryParent !== id) continue
      const child = nodeById.get(childId)
      if (!child) continue
      childrenAdded.add(childId)
      node.children.push(build(
        child.id, child.code, 'node', child.kind, sup.id, nextVisiting,
      ))
    }

    return node
  }

  const roots = sources.map((s) => build(s.id, s.code, 'source', s.type, null, new Set()))

  const fedNodeIds = new Set(supplies.map((s) => s.to_node_id))
  const unfed: StructureTreeNode[] = []
  for (const n of nodes) {
    if (fedNodeIds.has(n.id)) continue
    if (expanded.has(n.id)) continue
    unfed.push(build(n.id, n.code, 'node', n.kind, null, new Set()))
  }

  return { roots, unfed }
}
