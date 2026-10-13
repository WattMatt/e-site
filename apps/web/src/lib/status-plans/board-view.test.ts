import { describe, it, expect } from 'vitest'
import {
  FEED_UNKNOWN_LABEL, FEED_UNKNOWN_STYLE, areaShapeStyle, boardShapeStyle, tenantShapeStyle,
} from '@esite/shared/status-plans'
import { resolveShapeView, type ShapeViewContext } from './shape-view'
import { boardLegendEntries, boardLegendRows, boardView, FEED_UNKNOWN_KEY } from './board-view'
import type { CanvasShape, PlanFeed, PlanNode } from './types'

const node = (id: string, decommissioned = false): PlanNode =>
  ({ id, code: `DB-${id}`, kind: 'tenant_db', shopNumber: id.toUpperCase(), shopName: `Shop ${id}`, scheduledM2: 50, decommissioned })
const shape = (id: string, over: Partial<CanvasShape> = {}): CanvasShape => ({
  id, sheetId: 'sh1', shape: 'rect', points: [0, 0, 200, 0, 200, 100, 0, 100], nodeId: null, areaType: null,
  detectedTag: null, source: 'manual', updatedAt: 't', ...over,
})
const NODES = [node('a'), node('b'), node('c', true)]
const ctx: ShapeViewContext = {
  purpose: 'tenant_layout',
  nodesById: new Map(NODES.map((n) => [n.id, n])),
  shopLinks: {
    a: { state: 'active', facts: { scope: 'awaited', layoutIssued: false, db: null, lights: null, boDate: '2026-01-01' } },
    b: { state: 'active', facts: { scope: 'awaited', layoutIssued: false, db: null, lights: null, boDate: null } },
    c: { state: 'decommissioned' },
  },
  dbOrders: {},
  today: '2026-10-13',
  pixelsPerMeter: 20, // 200 × 100 px = 10 m × 5 m = 50 m²
}
const FEED: Extract<PlanFeed, { state: 'ok' }> = {
  state: 'ok',
  revisionCode: 'Rev 2',
  boards: [{ id: 'mb1', name: 'MB 1.1', colour: '#1F5FBF' }, { id: 'mb2', name: 'MB 2.1', colour: '#C000B0' }],
  byNode: { a: { boardId: 'mb1', also: ['mb2'] }, b: null, c: { boardId: 'mb2', also: [] } },
}
const view = (s: CanvasShape) => boardView(resolveShapeView(s, ctx), s.nodeId, FEED)

describe('boardView', () => {
  it('a linked shop takes its board colour; overdue and its hatch are dropped; "also" names the others', () => {
    const before = resolveShapeView(shape('s1', { nodeId: 'a' }), ctx)
    expect(before.overdue).toBe(true)
    const v = view(shape('s1', { nodeId: 'a' }))
    expect(v.style).toEqual(boardShapeStyle('#1F5FBF'))
    expect(v).toMatchObject({ legendKey: 'board:mb1', overdue: false, statusLabel: 'Fed from MB 1.1', feedAlso: ['MB 2.1'] })
    expect(v.labelLines).toEqual(before.labelLines)
    expect(v.areaM2).toBe(before.areaM2)
  })
  it('a shop with no path is grey and says so', () => {
    const v = view(shape('s2', { nodeId: 'b' }))
    expect(v.style).toEqual(FEED_UNKNOWN_STYLE)
    expect(v).toMatchObject({ legendKey: FEED_UNKNOWN_KEY, statusLabel: FEED_UNKNOWN_LABEL, feedAlso: [] })
  })
  it('a decommissioned shop keeps its struck-through label', () => {
    expect(view(shape('s3', { nodeId: 'c' })).style).toEqual(boardShapeStyle('#C000B0', true))
  })
  it('area shapes, unlinked shapes and invalid outlines are unchanged', () => {
    for (const s of [shape('s4', { areaType: 'common' }), shape('s5'), shape('s6', { nodeId: 'a', invalidReason: 'crosses itself', points: [] })]) {
      expect(view(s)).toEqual(resolveShapeView(s, ctx))
    }
    expect(view(shape('s4', { areaType: 'common' })).style).toEqual(areaShapeStyle('common'))
    expect(view(shape('s5')).style).toEqual(tenantShapeStyle({ status: 'unlinked', overdue: false }))
  })
})

describe('boardLegendRows', () => {
  const shapes = [
    shape('s1', { nodeId: 'a' }), shape('s2', { nodeId: 'b' }), shape('s3', { nodeId: 'c' }),
    shape('s4', { areaType: 'common' }), shape('s5'), shape('s6', { nodeId: 'a', invalidReason: 'x', points: [] }),
  ]
  const rows = boardLegendRows(shapes.map(view), FEED)
  it('one row per board in the feed\'s order, then no-feed, unassigned and the area types', () => {
    expect(rows.map((r) => r.key)).toEqual(['board:mb1', 'board:mb2', FEED_UNKNOWN_KEY, 'unlinked', 'common', 'plant_room', 'services', 'vacant'])
  })
  it('counts shapes (invalid ones never) and measures each board\'s shops', () => {
    expect(rows.map((r) => r.count)).toEqual([1, 1, 1, 1, 1, 0, 0, 0])
    expect(rows[0]).toMatchObject({ label: 'MB 1.1', m2: 50, style: boardShapeStyle('#1F5FBF') })
    expect(rows[2]!.m2).toBe(50)
    expect(rows[3]!.m2).toBeNull() // unlinked shapes are never measured GLA
    expect(rows[4]!.m2).toBeNull()
  })
  it('as PDF legend entries: the area goes into the label, counts by key', () => {
    const { legend, counts } = boardLegendEntries(rows)
    expect(legend[0]).toEqual({ key: 'board:mb1', label: 'MB 1.1 (50.0 m²)', style: boardShapeStyle('#1F5FBF') })
    expect(legend[3]!.label).toBe('Unassigned')
    expect(counts).toMatchObject({ 'board:mb1': 1, 'board:mb2': 1, [FEED_UNKNOWN_KEY]: 1, common: 1, vacant: 0 })
  })
})
