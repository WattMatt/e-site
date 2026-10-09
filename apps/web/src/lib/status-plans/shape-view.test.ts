import { describe, it, expect } from 'vitest'
import {
  tenantShapeStyle, areaShapeStyle, dbBlockStyle, COLOURS, TENANT_LEGEND, SCHEMATIC_LEGEND,
} from '@esite/shared/status-plans'
import { resolveShapeView, legendSummary, needsAttention, fillRgba, swatchCss, type ShapeViewContext } from './shape-view'
import type { CanvasShape, PlanNode } from './types'

// A 10 m × 8 m rectangle at 20 px/m = 200 × 160 px → 80 m².
const RECT = [100, 100, 300, 100, 300, 260, 100, 260]
const shape = (o: Partial<CanvasShape>): CanvasShape => ({
  id: 's1', shape: 'rect', points: RECT, nodeId: null, areaType: null,
  detectedTag: null, source: 'manual', updatedAt: 't', ...o,
})
const node = (o: Partial<PlanNode>): PlanNode => ({
  id: 'n1', code: 'DB-ZZ01', kind: 'tenant_db', shopNumber: 'ZZ01', shopName: 'Lantern Books',
  scheduledM2: 80, decommissioned: false, ...o,
})
const DONE = { scope: 'received', layoutIssued: true, db: 'received', lights: 'by_tenant', boDate: '2026-05-01' } as const
const OPEN = { scope: 'awaited', layoutIssued: false, db: 'ordered', lights: null, boDate: '2026-05-01' } as const

function ctx(o: Partial<ShapeViewContext> = {}): ShapeViewContext {
  return {
    purpose: 'tenant_layout',
    nodesById: new Map([['n1', node({})]]),
    shopLinks: { n1: { state: 'active', facts: DONE } },
    dbOrders: {},
    today: '2026-06-20',
    pixelsPerMeter: 20,
    ...o,
  }
}

describe('tenant layout shapes', () => {
  it('a complete shop: green, labelled, measured, area matches', () => {
    const v = resolveShapeView(shape({ nodeId: 'n1' }), ctx())
    expect(v.style).toEqual(tenantShapeStyle({ status: 'complete', overdue: false }))
    expect(v.legendKey).toBe('complete')
    expect(v.labelLines).toEqual(['ZZ01', 'Lantern Books', '80.0 m²'])
    expect(v.areaM2).toBeCloseTo(80, 9)
    expect(v.check?.state).toBe('matches')
    expect(v.statusLabel).toBe('Complete')
  })

  it('an open shop past its BO date is in progress AND overdue', () => {
    const v = resolveShapeView(shape({ nodeId: 'n1' }), ctx({ shopLinks: { n1: { state: 'active', facts: OPEN } } }))
    expect(v.style).toEqual(tenantShapeStyle({ status: 'in_progress', overdue: true }))
    expect(v.legendKey).toBe('in_progress')
    expect(v.overdue).toBe(true)
    expect(v.statusLabel).toBe('In progress · overdue')
  })

  it('area differs beyond 2 % is flagged (panel and legend only)', () => {
    const v = resolveShapeView(shape({ nodeId: 'n1' }), ctx({ nodesById: new Map([['n1', node({ scheduledM2: 70 })]]) }))
    expect(v.check?.state).toBe('differs')
  })

  it('no scale: no area, no comparison, no m² line', () => {
    const v = resolveShapeView(shape({ nodeId: 'n1' }), ctx({ pixelsPerMeter: null }))
    expect(v.areaM2).toBeNull()
    expect(v.check?.state).toBe('no_scale')
    expect(v.labelLines).toEqual(['ZZ01', 'Lantern Books'])
  })

  it('an unassigned shape is grey and says so', () => {
    const v = resolveShapeView(shape({}), ctx())
    expect(v.style).toEqual(tenantShapeStyle({ status: 'unlinked', overdue: false }))
    expect(v.legendKey).toBe('unlinked')
    expect(v.labelLines[0]).toBe('Unassigned')
    expect(v.linkedNodeMissing).toBe(false)
  })

  it('a link to a board that is no longer live falls to unlinked and needs attention', () => {
    const v = resolveShapeView(shape({ nodeId: 'gone' }), ctx())
    expect(v.legendKey).toBe('unlinked')
    expect(v.linkedNodeMissing).toBe(true)
    expect(v.statusLabel).toBe('Board deleted')
  })

  it('a decommissioned shop strikes its label', () => {
    const v = resolveShapeView(shape({ nodeId: 'n1' }), ctx({ shopLinks: { n1: { state: 'decommissioned' } } }))
    expect(v.style.strikeLabel).toBe(true)
    expect(v.legendKey).toBe('decommissioned')
  })

  it('an area shape uses the area palette and is measured but never checked', () => {
    const v = resolveShapeView(shape({ areaType: 'plant_room' }), ctx())
    expect(v.style).toEqual(areaShapeStyle('plant_room'))
    expect(v.legendKey).toBe('plant_room')
    expect(v.labelLines).toEqual(['Plant / electrical room', '80.0 m²'])
    expect(v.check).toBeNull()
  })
})

describe('distribution schematic shapes', () => {
  const sctx = (o: Partial<ShapeViewContext> = {}) => ctx({
    purpose: 'distribution_schematic',
    nodesById: new Map([['m1', node({ id: 'm1', code: 'MB-3.1', kind: 'main_board', shopNumber: null, shopName: null })]]),
    shopLinks: {},
    ...o,
  })

  it('a linked block takes its DB order hatch and the board code', () => {
    const v = resolveShapeView(shape({ nodeId: 'm1' }), sctx({ dbOrders: { m1: 'ordered' } }))
    expect(v.style).toEqual(dbBlockStyle('ordered'))
    expect(v.legendKey).toBe('ordered')
    expect(v.labelLines).toEqual(['MB-3.1'])
    expect(v.areaM2).toBeNull()
  })

  it('a linked board without a DB order is "no order"', () => {
    expect(resolveShapeView(shape({ nodeId: 'm1' }), sctx()).legendKey).toBe('no_order')
  })

  it('an unlinked block shows its detected tag as a hint', () => {
    const v = resolveShapeView(shape({ detectedTag: 'DB-90/91' }), sctx())
    expect(v.legendKey).toBe('unlinked')
    expect(v.labelLines).toEqual(['DB-90/91'])
  })
})

describe('legendSummary', () => {
  it('counts every legend key, overdue on top of its base status, and sums area', () => {
    const views = [
      resolveShapeView(shape({ id: 'a', nodeId: 'n1' }), ctx()),
      resolveShapeView(shape({ id: 'b', nodeId: 'n1' }), ctx({ shopLinks: { n1: { state: 'active', facts: OPEN } } })),
      resolveShapeView(shape({ id: 'c', areaType: 'common' }), ctx()),
      resolveShapeView(shape({ id: 'd' }), ctx({ pixelsPerMeter: null })),
    ]
    const s = legendSummary(views, 'tenant_layout')
    expect(Object.keys(s.counts).sort()).toEqual(TENANT_LEGEND.map((e) => e.key).sort())
    expect(s.counts).toMatchObject({ complete: 1, in_progress: 1, overdue: 1, common: 1, unlinked: 1 })
    expect(s.totalM2).toBeCloseTo(240, 9)
    expect(s.unmeasured).toBe(1)
  })

  it('a schematic summary has the schematic keys and no area', () => {
    const s = legendSummary([], 'distribution_schematic')
    expect(Object.keys(s.counts).sort()).toEqual(SCHEMATIC_LEGEND.map((e) => e.key).sort())
    expect(s.totalM2).toBe(0)
  })
})

describe('needsAttention', () => {
  it('lists deleted boards and area mismatches, nothing else', () => {
    const shapes = [shape({ id: 'ok', nodeId: 'n1' }), shape({ id: 'gone', nodeId: 'x' }), shape({ id: 'off', nodeId: 'n2' })]
    const c = ctx({
      nodesById: new Map([['n1', node({})], ['n2', node({ id: 'n2', shopNumber: 'ZZ02', scheduledM2: 60 })]]),
      shopLinks: { n1: { state: 'active', facts: DONE }, n2: { state: 'active', facts: DONE } },
    })
    const views = Object.fromEntries(shapes.map((s) => [s.id, resolveShapeView(s, c)]))
    const items = needsAttention(shapes, views)
    expect(items.map((i) => i.shapeId)).toEqual(['gone', 'off'])
    expect(items[0]!.reason).toMatch(/deleted/)
    expect(items[1]!.reason).toMatch(/80\.0 m² measured, 60\.0 m² scheduled \(\+33\.3 %\)/)
  })
})

describe('colour helpers', () => {
  it('fillRgba applies the style opacity; no fill is transparent', () => {
    expect(fillRgba({ ...tenantShapeStyle({ status: 'complete', overdue: false }), fill: COLOURS.complete, fillOpacity: 0.5 }))
      .toBe('rgba(46, 158, 79, 0.5)')
    expect(fillRgba(dbBlockStyle('required'))).toBe('transparent')
  })
  it('swatchCss marks dashed outlines and hatches', () => {
    expect(swatchCss(dbBlockStyle('unlinked')).border).toMatch(/dashed/)
    expect(swatchCss(dbBlockStyle('ordered')).backgroundImage).toMatch(/repeating-linear-gradient/)
  })
})
