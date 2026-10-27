import { describe, it, expect } from 'vitest'
import { rectToPoints, type Box } from './geometry'
import type { MatchableNode } from './match-nodes'
import { planRealignment, realignSummary, type RealignDetected, type RealignShape } from './realign-shapes'

/** Invented boards, invented coordinates. */
const NODES: MatchableNode[] = [
  { id: 'n-71', kind: 'tenant_db', code: 'DB-71', shop_number: null, name: 'Alpha Store' },
  { id: 'n-72', kind: 'tenant_db', code: 'DB-72', shop_number: null, name: 'Bravo Shop' },
]

const box = (minX: number, minY: number, maxX: number, maxY: number): Box => ({ minX, minY, maxX, maxY })
const rect = (id: string, b: Box, nodeId: string | null = null, shape: RealignShape['shape'] = 'rect'): RealignShape => ({
  id, shape, points: rectToPoints(b.minX, b.minY, b.maxX, b.maxY), nodeId, updatedAt: `ts-${id}`,
})
const table = (b: Box, tag: string | null, snapped = true): RealignDetected => ({ box: b, tag, name: null, snapped })

const T71 = box(100, 100, 300, 220)
const T72 = box(500, 100, 700, 220)

describe('planRealignment', () => {
  it('moves a hand-drawn rectangle onto the table it mostly covers, keeping its link', () => {
    const plan = planRealignment([rect('a', box(104, 96, 280, 226), 'n-71')], [table(T71, 'DB-71')], NODES)
    const r = plan.results[0]!
    expect(r.shapeId).toBe('a')
    expect(r.kind).toBe('move')
    if (r.kind !== 'move') return
    expect(r.to).toEqual(rectToPoints(100, 100, 300, 220))
    expect(r.from).toEqual(rectToPoints(104, 96, 280, 226))
    expect(r.distancePx).toBe(20) // the right edge moved furthest: 280 → 300
    expect(r.expectedUpdatedAt).toBe('ts-a')
    expect(r.linkMismatch).toBeUndefined()
  })

  it('a rectangle already on the border (within 1 px) is unchanged', () => {
    const plan = planRealignment([rect('a', box(100.6, 99.4, 300.9, 220), 'n-71')], [table(T71, 'DB-71')], NODES)
    expect(plan.results[0]!.kind).toBe('unchanged')
  })

  it('just over 1 px is a move', () => {
    const plan = planRealignment([rect('a', box(101.2, 100, 300, 220), 'n-71')], [table(T71, 'DB-71')], NODES)
    expect(plan.results[0]!.kind).toBe('move')
  })

  it('needs at least half of the smaller area to overlap', () => {
    // 200×120 table; this shape overlaps 90×120 of it (45 %), and is the bigger one.
    const plan = planRealignment([rect('a', box(210, 100, 410, 220))], [table(T71, 'DB-71')], NODES)
    expect(plan.results[0]!.kind).toBe('no_table')
    // 110×120 = 55 % of the smaller → pairs.
    const ok = planRealignment([rect('a', box(190, 100, 390, 220))], [table(T71, 'DB-71')], NODES)
    expect(ok.results[0]!.kind).toBe('move')
  })

  it('only snapped tables are targets: a text box is not the drawing', () => {
    const plan = planRealignment([rect('a', box(104, 96, 280, 226))], [table(T71, 'DB-71', false)], NODES)
    expect(plan.results[0]!.kind).toBe('no_table')
  })

  it('a rectangle round two tables is ambiguous and left alone', () => {
    const plan = planRealignment([rect('big', box(90, 90, 710, 230))], [table(T71, 'DB-71'), table(T72, 'DB-72')], NODES)
    expect(plan.results[0]!.kind).toBe('ambiguous')
  })

  it('a clear winner beats a second-best more than 10 % behind it', () => {
    // Shape 100×100; overlaps table A fully-ish (ratio 1.0) and table B at 0.6 of B's area.
    const a = box(0, 0, 100, 100)
    const b = box(80, 0, 130, 100) // 50×100; overlap 20×100 = 0.4 of B → below 0.5, not a candidate
    const c = box(60, 0, 110, 100) // 50×100; overlap 40×100 = 0.8 of C → candidate, 20 % behind A
    const plan = planRealignment([rect('s', box(0, 0, 100, 100))], [table(a, 'DB-71'), table(b, null), table(c, null)], NODES)
    expect(plan.results[0]!.kind).toBe('unchanged')
    // Within 10 %: ambiguous.
    const d = box(55, 0, 105, 100) // overlap 45×100 = 0.9 of D → within 10 % of 1.0
    const amb = planRealignment([rect('s', box(0, 0, 100, 100))], [table(a, 'DB-71'), table(d, null)], NODES)
    expect(amb.results[0]!.kind).toBe('ambiguous')
  })

  it('two shapes claiming one table: the bigger overlap wins, the other is a conflict', () => {
    const plan = planRealignment(
      [rect('good', box(102, 100, 300, 222), 'n-71'), rect('half', box(100, 100, 210, 220))],
      [table(T71, 'DB-71')],
      NODES,
    )
    // Both pass the pairing test (each is the smaller and lies inside), so the
    // claim is settled on intersection-over-union: good ≈ 0.99, half 0.55.
    expect(plan.results.map((r) => [r.shapeId, r.kind])).toEqual([['good', 'move'], ['half', 'conflict']])
    // Order does not decide it: the weaker claim listed first still loses.
    const swapped = planRealignment(
      [rect('half', box(100, 100, 210, 220)), rect('good', box(102, 100, 300, 222), 'n-71')],
      [table(T71, 'DB-71')],
      NODES,
    )
    expect(swapped.results.map((r) => [r.shapeId, r.kind])).toEqual([['half', 'conflict'], ['good', 'move']])
  })

  it('an exact tie for one table leaves both alone', () => {
    const plan = planRealignment(
      [rect('l', box(100, 100, 200, 220)), rect('r', box(200, 100, 300, 220))],
      [table(T71, 'DB-71')],
      NODES,
    )
    expect(plan.results.map((r) => r.kind)).toEqual(['conflict', 'conflict'])
  })

  it('polygons and unreadable outlines are skipped, never moved', () => {
    const poly = rect('p', box(104, 96, 280, 226), null, 'polygon')
    const broken: RealignShape = { id: 'x', shape: 'rect', points: [], nodeId: null, updatedAt: 'ts-x' }
    const plan = planRealignment([poly, broken], [table(T71, 'DB-71')], NODES)
    expect(plan.results).toEqual([])
    expect(plan.summary.skipped).toBe(2)
  })

  it('flags a link the table disagrees with, and never changes it', () => {
    const plan = planRealignment([rect('a', box(104, 96, 280, 226), 'n-72')], [table(T71, 'DB-71')], NODES)
    const r = plan.results[0]!
    expect(r.kind).toBe('move')
    if (r.kind !== 'move') return
    expect(r.linkMismatch).toEqual({ tableTag: 'DB-71', suggestedNodeId: 'n-71' })
    expect(r.nodeId).toBe('n-72')
  })

  it('flags an unlinked shape whose table names a board; an unknown tag is not flagged', () => {
    const plan = planRealignment(
      [rect('a', box(100, 100, 300, 220)), rect('b', box(504, 96, 680, 226), 'n-72')],
      [table(T71, 'DB-71'), table(T72, 'DB-99')],
      NODES,
    )
    expect(plan.results[0]!.linkMismatch).toEqual({ tableTag: 'DB-71', suggestedNodeId: 'n-71' })
    expect(plan.results[1]!.linkMismatch).toBeUndefined()
  })

  it('summarises counts and the average move', () => {
    const plan = planRealignment(
      [
        rect('m1', box(110, 100, 300, 220), 'n-71'), // 10 px
        rect('m2', box(500, 100, 670, 220), 'n-72'), // 30 px
        rect('u', box(900, 900, 1000, 1000)), // no table
      ],
      [table(T71, 'DB-71'), table(T72, 'DB-72')],
      NODES,
    )
    expect(plan.summary).toEqual({ move: 2, unchanged: 0, noTable: 1, ambiguous: 0, conflict: 0, skipped: 0, avgMovePx: 20, linkMismatches: 0 })
    expect(realignSummary(plan.summary)).toBe('2 will snap to their table (avg 20 px) · 0 already aligned · 1 left as they are')
  })
})
