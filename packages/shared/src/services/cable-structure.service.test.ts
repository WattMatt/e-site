import { describe, expect, it } from 'vitest'
import { buildStructureTree, type StructureFeedSummary } from './cable-structure.service'

// Stub decorators — the graph logic is what's under test.
const summary: StructureFeedSummary = { cableCount: 1, sizeLabel: '1×25mm² Cu', vdPct: 1.2, underRated: false }
const decorate = {
  feedSummaryFor: () => summary,
  blastFor: () => ({ blastSupplies: 0, blastCables: 0 }),
}

describe('buildStructureTree', () => {
  it('nests boards under the source/board that feeds them', () => {
    const sources = [{ id: 'S1', code: 'RMU', type: 'COUNCIL_RMU' }]
    const boards = [
      { id: 'B1', code: 'MAIN', kind: 'MAIN_BOARD' },
      { id: 'B2', code: 'DB-1', kind: 'SUB_BOARD' },
    ]
    const supplies = [
      { id: 'sup1', from_source_id: 'S1', from_board_id: null, to_board_id: 'B1' },
      { id: 'sup2', from_source_id: null, from_board_id: 'B1', to_board_id: 'B2' },
    ]
    const { roots, unfed } = buildStructureTree(sources, boards, supplies, decorate)
    expect(unfed).toEqual([])
    expect(roots).toHaveLength(1)
    expect(roots[0]!.id).toBe('S1')
    expect(roots[0]!.feedSummary).toBeNull()        // sources have no incoming feed
    expect(roots[0]!.children).toHaveLength(1)
    expect(roots[0]!.children[0]!.id).toBe('B1')
    expect(roots[0]!.children[0]!.feedSummary).toEqual(summary)
    expect(roots[0]!.children[0]!.children[0]!.id).toBe('B2')
  })

  it('flags a board fed by two supplies as alsoFedElsewhere on the 2nd occurrence', () => {
    const sources = [
      { id: 'S1', code: 'COUNCIL', type: 'COUNCIL_RMU' },
      { id: 'S2', code: 'STANDBY', type: 'STANDBY' },
    ]
    const boards = [{ id: 'B1', code: 'DB-3', kind: 'SUB_BOARD' }]
    const supplies = [
      { id: 'sup1', from_source_id: 'S1', from_board_id: null, to_board_id: 'B1' },
      { id: 'sup2', from_source_id: 'S2', from_board_id: null, to_board_id: 'B1' },
    ]
    const { roots } = buildStructureTree(sources, boards, supplies, decorate)
    expect(roots[0]!.children[0]!.alsoFedElsewhere).toBe(false)  // 1st occurrence — full
    expect(roots[1]!.children[0]!.alsoFedElsewhere).toBe(true)   // 2nd occurrence — marker
  })

  it('puts a board with no incoming supply in the unfed group, with its own subtree', () => {
    const sources: { id: string; code: string; type: string }[] = []
    const boards = [
      { id: 'B1', code: 'ORPHAN', kind: 'MAIN_BOARD' },
      { id: 'B2', code: 'DB-9', kind: 'SUB_BOARD' },
    ]
    const supplies = [
      { id: 'sup1', from_source_id: null, from_board_id: 'B1', to_board_id: 'B2' },
    ]
    const { roots, unfed } = buildStructureTree(sources, boards, supplies, decorate)
    expect(roots).toEqual([])
    expect(unfed).toHaveLength(1)
    expect(unfed[0]!.id).toBe('B1')
    expect(unfed[0]!.children[0]!.id).toBe('B2')
  })

  it('terminates on a cyclic supply graph instead of recursing forever', () => {
    const sources = [{ id: 'S1', code: 'RMU', type: 'COUNCIL_RMU' }]
    const boards = [
      { id: 'B1', code: 'A', kind: 'MAIN_BOARD' },
      { id: 'B2', code: 'B', kind: 'SUB_BOARD' },
    ]
    const supplies = [
      { id: 'sup0', from_source_id: 'S1', from_board_id: null, to_board_id: 'B1' },
      { id: 'sup1', from_source_id: null, from_board_id: 'B1', to_board_id: 'B2' },
      { id: 'sup2', from_source_id: null, from_board_id: 'B2', to_board_id: 'B1' }, // cycle B2 -> B1
    ]
    // Must return (not hang). B1 under S1 expands B2; B2's B1 child is the cycle — rendered as a leaf marker.
    const { roots } = buildStructureTree(sources, boards, supplies, decorate)
    expect(roots).toHaveLength(1)
    const b1 = roots[0]!.children[0]!
    expect(b1.id).toBe('B1')
    const b2 = b1.children[0]!
    expect(b2.id).toBe('B2')
    expect(b2.children[0]!.id).toBe('B1')
    expect(b2.children[0]!.alsoFedElsewhere).toBe(true) // the cycle back-edge is a leaf marker
    expect(b2.children[0]!.children).toEqual([])
  })
})
