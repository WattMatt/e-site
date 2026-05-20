import { describe, expect, it } from 'vitest'
import { buildStructureTree, type StructureFeedSummary } from './cable-structure.service'

// Stub decorators — the graph logic is what's under test.
const summary: StructureFeedSummary = { cableCount: 1, sizeLabel: '1×25mm² Cu', vdPct: 1.2, underRated: false }
const decorate = {
  feedSummaryFor: () => summary,
  blastFor: () => ({ blastSupplies: 0, blastCables: 0 }),
}

describe('buildStructureTree', () => {
  it('nests nodes under the source/node that feeds them', () => {
    const sources = [{ id: 'S1', code: 'RMU', type: 'COUNCIL_RMU' }]
    const nodes = [
      { id: 'B1', code: 'MAIN', kind: 'main_board' },
      { id: 'B2', code: 'DB-1', kind: 'main_board' },
    ]
    const supplies = [
      { id: 'sup1', from_source_id: 'S1', from_node_id: null, to_node_id: 'B1' },
      { id: 'sup2', from_source_id: null, from_node_id: 'B1', to_node_id: 'B2' },
    ]
    const { roots, unfed } = buildStructureTree(sources, nodes, supplies, decorate)
    expect(unfed).toEqual([])
    expect(roots).toHaveLength(1)
    expect(roots[0]!.id).toBe('S1')
    expect(roots[0]!.feedSummary).toBeNull()        // sources have no incoming feed
    expect(roots[0]!.children).toHaveLength(1)
    expect(roots[0]!.children[0]!.id).toBe('B1')
    expect(roots[0]!.children[0]!.category).toBe('node')
    expect(roots[0]!.children[0]!.feedSummary).toEqual(summary)
    expect(roots[0]!.children[0]!.children[0]!.id).toBe('B2')
  })

  it('flags a node fed by two supplies as alsoFedElsewhere on the 2nd occurrence', () => {
    const sources = [
      { id: 'S1', code: 'COUNCIL', type: 'COUNCIL_RMU' },
      { id: 'S2', code: 'STANDBY', type: 'STANDBY' },
    ]
    const nodes = [{ id: 'B1', code: 'DB-3', kind: 'tenant_db' }]
    const supplies = [
      { id: 'sup1', from_source_id: 'S1', from_node_id: null, to_node_id: 'B1' },
      { id: 'sup2', from_source_id: 'S2', from_node_id: null, to_node_id: 'B1' },
    ]
    const { roots } = buildStructureTree(sources, nodes, supplies, decorate)
    expect(roots[0]!.children[0]!.alsoFedElsewhere).toBe(false)  // 1st occurrence — full
    expect(roots[1]!.children[0]!.alsoFedElsewhere).toBe(true)   // 2nd occurrence — marker
  })

  it('puts a node with no incoming supply in the unfed group, with its own subtree', () => {
    const sources: { id: string; code: string; type: string }[] = []
    const nodes = [
      { id: 'B1', code: 'ORPHAN', kind: 'main_board' },
      { id: 'B2', code: 'DB-9', kind: 'tenant_db' },
    ]
    const supplies = [
      { id: 'sup1', from_source_id: null, from_node_id: 'B1', to_node_id: 'B2' },
    ]
    const { roots, unfed } = buildStructureTree(sources, nodes, supplies, decorate)
    expect(roots).toEqual([])
    expect(unfed).toHaveLength(1)
    expect(unfed[0]!.id).toBe('B1')
    expect(unfed[0]!.category).toBe('node')
    expect(unfed[0]!.children[0]!.id).toBe('B2')
  })

  it('flattens an 11 kV ring main — all ring members become siblings under the entry parent', () => {
    // Models the real-world case from Centurion Industrial Park:
    //   Council RMU → Consumer RMU → T1 → T2 → T3 → T4 → T5 → Consumer RMU
    // (the last cable is the ring closure).
    // The cable schedule lists each segment as a daisy-chain cable, but
    // engineering convention is to render the 5 transformers as peers on the
    // ring under the Consumer RMU, with the closing cable annotated on T5.
    const sources = [{ id: 'SRC', code: 'COUNCIL', type: 'COUNCIL_RMU' }]
    const nodes = [
      { id: 'CRMU', code: 'CONSUMER',  kind: 'rmu' },
      { id: 'T1',   code: 'T1', kind: 'mini_sub' },
      { id: 'T2',   code: 'T2', kind: 'mini_sub' },
      { id: 'T3',   code: 'T3', kind: 'mini_sub' },
      { id: 'T4',   code: 'T4', kind: 'mini_sub' },
      { id: 'T5',   code: 'T5', kind: 'mini_sub' },
      { id: 'MB',   code: 'MB1', kind: 'main_board' }, // T1's non-ring branch
    ]
    const supplies = [
      { id: 's0',  from_source_id: 'SRC',  from_node_id: null,   to_node_id: 'CRMU' },
      { id: 's1',  from_source_id: null,   from_node_id: 'CRMU', to_node_id: 'T1' },
      { id: 's2',  from_source_id: null,   from_node_id: 'T1',   to_node_id: 'T2' },
      { id: 's3',  from_source_id: null,   from_node_id: 'T2',   to_node_id: 'T3' },
      { id: 's4',  from_source_id: null,   from_node_id: 'T3',   to_node_id: 'T4' },
      { id: 's5',  from_source_id: null,   from_node_id: 'T4',   to_node_id: 'T5' },
      { id: 's6',  from_source_id: null,   from_node_id: 'T5',   to_node_id: 'CRMU' }, // ring closure
      { id: 'sMB', from_source_id: null,   from_node_id: 'T1',   to_node_id: 'MB' },   // non-ring branch
    ]
    const { roots, unfed } = buildStructureTree(sources, nodes, supplies, decorate)
    expect(unfed).toEqual([])
    expect(roots).toHaveLength(1)

    const consumer = roots[0]!.children[0]!
    expect(consumer.id).toBe('CRMU')
    expect(consumer.category).toBe('node')
    // CONSUMER RMU should have all 5 transformers as direct children — in
    // cable order — and NOT have a duplicate "also fed elsewhere" entry from
    // the ring closure (that's annotated on T5 instead).
    expect(consumer.children.map((c) => c.id)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5'])

    // T1 keeps its non-ring branch.
    const t1 = consumer.children[0]!
    expect(t1.children.map((c) => c.id)).toEqual(['MB'])

    // T2–T4 have no children (pure ring members).
    expect(consumer.children[1]!.children).toEqual([])
    expect(consumer.children[2]!.children).toEqual([])
    expect(consumer.children[3]!.children).toEqual([])

    // T5 — the last ring member — carries the ring-closure annotation back
    // to CONSUMER (its display code), and has no children (the closing cable
    // is the annotation, not a tree edge).
    const t5 = consumer.children[4]!
    expect(t5.id).toBe('T5')
    expect(t5.children).toEqual([])
    expect(t5.ringClosesBackTo).toBe('CONSUMER')

    // Ring members are NOT flagged as alsoFedElsewhere — that flag is reserved
    // for genuinely multi-fed nodes (e.g. normal + standby).
    for (const m of consumer.children) expect(m.alsoFedElsewhere).toBe(false)
  })

  it('terminates on a cyclic supply graph instead of recursing forever (degenerate 2-node ring)', () => {
    // The simplest ring: A feeds B, B feeds A. After flattening, B is a
    // child of A and A annotates the closure. No recursion explosion.
    const sources = [{ id: 'S1', code: 'RMU', type: 'COUNCIL_RMU' }]
    const nodes = [
      { id: 'B1', code: 'A', kind: 'main_board' },
      { id: 'B2', code: 'B', kind: 'tenant_db' },
    ]
    const supplies = [
      { id: 'sup0', from_source_id: 'S1', from_node_id: null, to_node_id: 'B1' },
      { id: 'sup1', from_source_id: null, from_node_id: 'B1', to_node_id: 'B2' },
      { id: 'sup2', from_source_id: null, from_node_id: 'B2', to_node_id: 'B1' }, // ring B2 → B1
    ]
    const { roots } = buildStructureTree(sources, nodes, supplies, decorate)
    expect(roots).toHaveLength(1)
    const b1 = roots[0]!.children[0]!
    expect(b1.id).toBe('B1')
    expect(b1.category).toBe('node')
    // Ring members are B2 only (path was S1 → B1 → B2, then B2 → B1 back-edge).
    // B2 sits as a child of B1 (B1 is the ring entry parent).
    expect(b1.children).toHaveLength(1)
    const b2 = b1.children[0]!
    expect(b2.id).toBe('B2')
    expect(b2.children).toEqual([])
    expect(b2.ringClosesBackTo).toBe('A')   // closing cable goes back to B1
    expect(b2.alsoFedElsewhere).toBe(false) // ring closure isn't a multi-feed
  })
})
