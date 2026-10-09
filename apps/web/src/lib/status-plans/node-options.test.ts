import { describe, it, expect } from 'vitest'
import { buildNodeOptions, filterNodeOptions } from './node-options'
import type { CanvasShape, PlanNode } from './types'

const n = (o: Partial<PlanNode>): PlanNode => ({
  id: 'x', code: 'DB-X', kind: 'tenant_db', shopNumber: null, shopName: null, scheduledM2: null, decommissioned: false, ...o,
})
const NODES: PlanNode[] = [
  n({ id: 'n10', code: 'DB-10', shopNumber: '10', shopName: 'Copper Kettle' }),
  n({ id: 'n2', code: 'DB-2', shopNumber: '2', shopName: 'Lantern Books' }),
  n({ id: 'n3', code: 'DB-3', shopNumber: '3', shopName: 'Old Mill', decommissioned: true }),
  n({ id: 'm1', code: 'MB-3.1', kind: 'main_board' }),
]
const s = (id: string, nodeId: string | null): CanvasShape => ({
  id, shape: 'polygon', points: [0, 0, 1, 0, 1, 1], nodeId, areaType: null, detectedTag: null, source: 'manual', updatedAt: 't',
})

describe('buildNodeOptions', () => {
  it('tenant layout: tenant boards only, natural order, number — name', () => {
    const opts = buildNodeOptions(NODES, [], null, 'tenant_layout')
    expect(opts.map((o) => o.label)).toEqual(['2 — Lantern Books', '3 — Old Mill', '10 — Copper Kettle'])
    expect(opts.find((o) => o.id === 'n3')!.sub).toBe('DB-3 · decommissioned')
  })

  it('a board already on another shape is disabled with a reason', () => {
    const opts = buildNodeOptions(NODES, [s('a', 'n2'), s('b', null)], 'b', 'tenant_layout')
    const n2 = opts.find((o) => o.id === 'n2')!
    expect(n2.disabled).toBe(true)
    expect(n2.reason).toBe('Already on this plan')
  })

  it("the selected shape's own board stays enabled", () => {
    const opts = buildNodeOptions(NODES, [s('a', 'n2')], 'a', 'tenant_layout')
    expect(opts.find((o) => o.id === 'n2')!.disabled).toBe(false)
  })

  it('schematic: every board, labelled by code with its kind', () => {
    const opts = buildNodeOptions(NODES, [], null, 'distribution_schematic')
    expect(opts.map((o) => o.label)).toEqual(['DB-2', 'DB-3', 'DB-10', 'MB-3.1'])
    expect(opts.find((o) => o.id === 'm1')!.sub).toBe('Main board')
  })
})

describe('filterNodeOptions', () => {
  const opts = buildNodeOptions(NODES, [], null, 'tenant_layout')
  it('empty query keeps everything', () => {
    expect(filterNodeOptions(opts, '   ')).toHaveLength(3)
  })
  it('every term must match, case-insensitive, label or sub', () => {
    expect(filterNodeOptions(opts, 'lantern').map((o) => o.id)).toEqual(['n2'])
    expect(filterNodeOptions(opts, 'db-3 DECOMM').map((o) => o.id)).toEqual(['n3'])
    expect(filterNodeOptions(opts, 'kettle mill')).toEqual([])
  })
})
