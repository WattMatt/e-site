/**
 * Cable Schedule structure tree — pure functions over raw row data.
 *
 * The "structure" of a revision is its supply graph: each `supply` row is a
 * feed edge from a source/board to a board. `buildStructureTree` turns the
 * flat sources/boards/supplies into a forest:
 *   - roots  = every source, with its fed subtree
 *   - unfed  = boards with no incoming supply, each with its own subtree
 *
 * A board fed by more than one supply appears under each feeder; the
 * 2nd-and-later occurrences are flagged `alsoFedElsewhere` and not
 * re-expanded. A visited/expanded guard makes a cyclic graph terminate.
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
  category: 'source' | 'board'
  /** source.type or board.kind */
  nodeType: string
  /** The supply edge feeding this node — null for sources and unfed-board roots. */
  feedSummary: StructureFeedSummary | null
  children: StructureTreeNode[]
  /** True when this is a 2nd-or-later occurrence of a multi-fed board (or a cycle back-edge). */
  alsoFedElsewhere: boolean
  /** Cascade-delete counts for the remove-confirm modal. */
  blastSupplies: number
  blastCables: number
}

interface TreeSource { id: string; code: string; type: string }
interface TreeBoard { id: string; code: string; kind: string }
interface TreeSupply {
  id: string
  from_source_id: string | null
  from_board_id: string | null
  to_board_id: string
}

export function buildStructureTree(
  sources: TreeSource[],
  boards: TreeBoard[],
  supplies: TreeSupply[],
  decorate: {
    feedSummaryFor: (supplyId: string) => StructureFeedSummary | null
    blastFor: (id: string, category: 'source' | 'board') => { blastSupplies: number; blastCables: number }
  },
): { roots: StructureTreeNode[]; unfed: StructureTreeNode[] } {
  const boardById = new Map(boards.map((b) => [b.id, b] as const))

  // supplies grouped by their from-node id (source XOR board)
  const suppliesByFrom = new Map<string, TreeSupply[]>()
  for (const s of supplies) {
    const fromId = s.from_source_id ?? s.from_board_id
    if (!fromId) continue
    const list = suppliesByFrom.get(fromId) ?? []
    list.push(s)
    suppliesByFrom.set(fromId, list)
  }

  const fedBoardIds = new Set(supplies.map((s) => s.to_board_id))
  // boards whose full subtree has already been emitted somewhere in the forest
  const expanded = new Set<string>()

  function build(
    id: string,
    code: string,
    category: 'source' | 'board',
    nodeType: string,
    feedingSupplyId: string | null,
    visiting: Set<string>,
  ): StructureTreeNode {
    // A board already expanded elsewhere, or a cycle back-edge into a node we're
    // currently inside, becomes a leaf marker — no children, flagged.
    const isRepeat = category === 'board' && (expanded.has(id) || visiting.has(id))
    const node: StructureTreeNode = {
      id,
      code,
      category,
      nodeType,
      feedSummary: feedingSupplyId ? decorate.feedSummaryFor(feedingSupplyId) : null,
      children: [],
      alsoFedElsewhere: isRepeat,
      ...decorate.blastFor(id, category),
    }
    if (isRepeat) return node
    if (category === 'board') expanded.add(id)
    const nextVisiting = new Set(visiting)
    nextVisiting.add(id)
    for (const sup of suppliesByFrom.get(id) ?? []) {
      const child = boardById.get(sup.to_board_id)
      if (!child) continue
      node.children.push(build(child.id, child.code, 'board', child.kind, sup.id, nextVisiting))
    }
    return node
  }

  const roots = sources.map((s) => build(s.id, s.code, 'source', s.type, null, new Set()))

  const unfed: StructureTreeNode[] = []
  for (const b of boards) {
    if (fedBoardIds.has(b.id)) continue // fed → already sits in some subtree
    if (expanded.has(b.id)) continue // defensive — already emitted
    unfed.push(build(b.id, b.code, 'board', b.kind, null, new Set()))
  }

  return { roots, unfed }
}
