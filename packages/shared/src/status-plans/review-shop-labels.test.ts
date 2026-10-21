import { describe, it, expect } from 'vitest'
import type { DetectedShopLabel, ShopLabelResult } from './detect-shop-labels'
import { rectToPoints } from './geometry'
import { normaliseTag, stripLeadingZeros } from './match-nodes'
import { reviewShopLabels, shopReviewSummary, type ShopReview, type ShopReviewNode, type ShopReviewShape, type ShopRowState } from './review-shop-labels'

function rect(id: string, x0: number, y0: number, x1: number, y1: number, nodeId: string | null = null, areaType: string | null = null): ShopReviewShape {
  return { id, points: rectToPoints(x0, y0, x1, y1), nodeId, areaType }
}
function node(id: string, shop_number: string, scheduledM2: number | null = null, decommissioned = false): ShopReviewNode {
  return { id, code: null, shop_number, name: null, kind: 'tenant_db', scheduledM2, decommissioned }
}
function label(tag: string, x: number, y: number, drawingAreaM2: number | null = null): DetectedShopLabel {
  return { tag, box: { minX: x - 10, minY: y - 5, maxX: x + 10, maxY: y + 5 }, anchor: { x, y }, name: null, drawingAreaM2 }
}
function review(labels: DetectedShopLabel[], nodes: ShopReviewNode[], shapes: ShopReviewShape[], replaced = false) {
  const counts = new Map<string, number>()
  for (const l of labels) {
    const k = stripLeadingZeros(normaliseTag(l.tag))
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const duplicates: Record<string, number> = {}
  for (const [k, c] of counts) if (c > 1) duplicates[k] = c
  const result: ShopLabelResult = { labels, duplicates, textItemCount: labels.length }
  return reviewShopLabels({ labels: result, nodes, shapes, replaced })
}

describe('reviewShopLabels', () => {
  it('linked: the containing shape already carries the matched node', () => {
    const r = review([label('12', 50, 50)], [node('n12', '12')], [rect('s1', 0, 0, 100, 100, 'n12')])
    expect(r.rows[0]).toMatchObject({ state: 'linked', nodeId: 'n12', shapeId: 's1', otherShapeId: null, reason: null })
  })

  it('link: containing shape is unlinked and the node is free', () => {
    const r = review([label('12', 50, 50)], [node('n12', '12')], [rect('s1', 0, 0, 100, 100)])
    expect(r.rows[0]).toMatchObject({ state: 'link', nodeId: 'n12', shapeId: 's1', otherShapeId: null })
  })

  it('conflict: containing shape is linked to another tenant', () => {
    const r = review([label('12', 50, 50)], [node('n12', '12'), node('n13', '13')], [rect('s1', 0, 0, 100, 100, 'n13')])
    const row = r.rows[0]!
    expect(row).toMatchObject({ state: 'conflict', nodeId: 'n12', shapeId: 's1', otherShapeId: null })
    expect(row.reason).toContain('12')
    expect(row.reason).toContain('13')
  })

  it('conflict: node already on a different shape while an unlinked shape contains the label', () => {
    const r = review([label('12', 50, 50)], [node('n12', '12')], [rect('s1', 0, 0, 100, 100), rect('s2', 500, 500, 600, 600, 'n12')])
    expect(r.rows[0]).toMatchObject({ state: 'conflict', nodeId: 'n12', shapeId: 's1', otherShapeId: 's2' })
  })

  it('linked_outside: node linked elsewhere and nothing contains the label', () => {
    const r = review([label('12', 300, 300)], [node('n12', '12')], [rect('s2', 500, 500, 600, 600, 'n12')])
    expect(r.rows[0]).toMatchObject({ state: 'linked_outside', nodeId: 'n12', shapeId: 's2', otherShapeId: null, reason: 'label outside the shape' })
    expect(r.unlabelled).toEqual([])
  })

  it('moved: linked_outside on a replaced sheet', () => {
    const r = review([label('12', 300, 300)], [node('n12', '12')], [rect('s2', 500, 500, 600, 600, 'n12')], true)
    expect(r.rows[0]).toMatchObject({ state: 'moved', nodeId: 'n12', shapeId: 's2' })
  })

  it('draw: unique match, nothing contains the label', () => {
    const r = review([label('12', 300, 300)], [node('n12', '12')], [rect('s1', 0, 0, 100, 100)])
    expect(r.rows[0]).toMatchObject({ state: 'draw', nodeId: 'n12', shapeId: null })
    expect(r.unlabelled).toEqual(['s1'])
  })

  it('needs_you: ambiguous match lists candidates; duplicate label never links', () => {
    const amb = review([label('12', 50, 50)], [node('a', '12'), node('b', '12')], [rect('s1', 0, 0, 100, 100)])
    expect(amb.rows[0]).toMatchObject({ state: 'needs_you', nodeId: null })
    expect([...amb.rows[0]!.candidateIds].sort()).toEqual(['a', 'b'])

    const dup = review([label('12', 50, 50), label('012', 250, 50)], [node('n12', '12')], [rect('s1', 0, 0, 100, 100), rect('s2', 200, 0, 300, 100)])
    expect(dup.duplicates).toEqual({ '12': 2 })
    expect(dup.rows.map((r) => r.state)).toEqual(['needs_you', 'needs_you'])
    expect(dup.rows.every((r) => r.nodeId === null)).toBe(true)
    expect(new Set(dup.rows.map((r) => r.key)).size).toBe(2)
  })

  it('not_on_schedule: no node for the tag; decommissioned node gives the reason "decommissioned"', () => {
    const none = review([label('99', 50, 50)], [node('n12', '12')], [])
    expect(none.rows[0]).toMatchObject({ state: 'not_on_schedule', nodeId: null })
    expect(none.rows[0]!.reason).not.toBe('decommissioned')

    const gone = review([label('12', 50, 50)], [node('n12', '12', null, true)], [rect('s1', 0, 0, 100, 100)])
    expect(gone.rows[0]).toMatchObject({ state: 'not_on_schedule', nodeId: null, reason: 'decommissioned' })
  })

  it('the smaller of two containing shapes wins; the larger is reported unlabelled', () => {
    const r = review([label('12', 50, 50)], [node('n12', '12')], [rect('big', 0, 0, 1000, 1000), rect('small', 0, 0, 100, 100)])
    expect(r.rows[0]).toMatchObject({ state: 'link', shapeId: 'small' })
    expect(r.unlabelled).toEqual(['big'])
  })

  it('area-typed shapes are never unlabelled and never contain a shop', () => {
    const r = review([label('12', 50, 50)], [node('n12', '12')], [rect('mall', 0, 0, 1000, 1000, null, 'mall'), rect('store', 400, 400, 500, 500, null, 'store_room')])
    expect(r.rows[0]).toMatchObject({ state: 'draw', shapeId: null })
    expect(r.unlabelled).toEqual([])
  })

  it('areaNote when drawing m² and scheduled m² differ by more than 2 %', () => {
    const r = review([label('12', 50, 50, 304.52)], [node('n12', '12', 281.15)], [rect('s1', 0, 0, 100, 100)])
    expect(r.rows[0]!.areaNote).toBe('drawing says 304.52 m², schedule says 281.15 m²')
  })

  it('no areaNote within 2 % or when either figure is missing', () => {
    const near = review([label('12', 50, 50, 281.9)], [node('n12', '12', 281.15)], [rect('s1', 0, 0, 100, 100)])
    expect(near.rows[0]!.areaNote).toBeNull()
    const noDrawing = review([label('12', 50, 50, null)], [node('n12', '12', 281.15)], [rect('s1', 0, 0, 100, 100)])
    expect(noDrawing.rows[0]!.areaNote).toBeNull()
    const noSchedule = review([label('12', 50, 50, 304.52)], [node('n12', '12', null)], [rect('s1', 0, 0, 100, 100)])
    expect(noSchedule.rows[0]!.areaNote).toBeNull()
  })

  it('counts carries every state, zero when absent', () => {
    const r = review([label('12', 50, 50)], [node('n12', '12')], [rect('s1', 0, 0, 100, 100)])
    const states: ShopRowState[] = ['linked', 'linked_outside', 'link', 'conflict', 'draw', 'needs_you', 'not_on_schedule', 'moved']
    expect(Object.keys(r.counts).sort()).toEqual([...states].sort())
    expect(r.counts.link).toBe(1)
    expect(r.counts.linked).toBe(0)
    expect(r.labelCount).toBe(1)
  })

  it('summary for zero labels tells the person to draw by hand', () => {
    expect(shopReviewSummary(review([], [], []))).toBe('No SHOP labels found on this sheet; draw the shops by hand.')
  })

  it('summary counts every state', () => {
    const r: ShopReview = {
      rows: [], unlabelled: [], duplicates: {}, labelCount: 109, textItemCount: 1949,
      counts: { linked: 3, linked_outside: 0, link: 42, conflict: 0, draw: 64, needs_you: 0, not_on_schedule: 1, moved: 0 },
    }
    expect(shopReviewSummary(r)).toBe('109 labels · 1,949 items read · 3 on the plan · 42 to link · 64 to draw · 0 conflicts · 0 need you · 1 not on the schedule · 0 duplicates')
  })
})
