import { describe, it, expect } from 'vitest'
import { detectShopLabels, parseAreaM2 } from './detect-shop-labels'
import { normaliseTag } from './match-nodes'
import type { ImageTextItem } from './text-space'

function item(str: string, x: number, baseline: number, w = str.length * 6, h = 10): ImageTextItem {
  return { str, x, baseline, top: baseline - h, width: w, height: h }
}

describe('detectShopLabels', () => {
  it('finds SHOP labels in both cases and keeps the tag as printed', () => {
    const r = detectShopLabels([item('SHOP 92A', 100, 100), item('Shop 10a', 300, 100), item('SHOP K04', 500, 100), item('SHOP 20/21', 700, 100)])
    expect(r.labels.map((l) => l.tag)).toEqual(['92A', '10a', 'K04', '20/21'])
    expect(r.textItemCount).toBe(4)
  })
  it('ignores bare numbers, DB tags and prose', () => {
    expect(detectShopLabels([item('92A', 0, 0), item('DB-10A', 0, 20), item('SHOPFRONT', 0, 40), item('SHOP', 0, 60)]).labels).toEqual([])
  })
  it('anchor is the centre of the label box', () => {
    const [l] = detectShopLabels([item('SHOP 46', 100, 110, 48, 10)]).labels
    expect(l.box).toEqual({ minX: 100, minY: 100, maxX: 148, maxY: 110 })
    expect(l.anchor).toEqual({ x: 124, y: 105 })
  })
  it('takes the nearest name and the m² figure within NEAR_PX', () => {
    const [l] = detectShopLabels([item('SHOP 38', 1000, 1000), item('PnP LIQUOR', 1000, 985), item('304.52 m²', 1000, 1015), item('281.15 m²', 1200, 1000), item('SHOP 38A', 1090, 1000)]).labels
    expect(l.name).toBe('PnP LIQUOR'); expect(l.drawingAreaM2).toBe(304.52)
  })
  it('parses the three m² spellings on the sheets', () => {
    expect(parseAreaM2('31.67 m²')).toBe(31.67); expect(parseAreaM2('2,825 m2')).toBe(2825); expect(parseAreaM2('28 m²')).toBe(28); expect(parseAreaM2('m²')).toBeNull(); expect(parseAreaM2('340 mm')).toBeNull()
  })
  it('reports duplicates and keeps both labels', () => {
    const r = detectShopLabels([item('SHOP 12', 0, 0), item('SHOP 012', 900, 900)])
    expect(r.labels).toHaveLength(2); expect(r.duplicates).toEqual({ [normaliseTag('12')]: 2 })
  })
  it('joins a split run on one baseline (synthetic; the real sheets do not split)', () => {
    const [l] = detectShopLabels([item('SHOP', 100, 100, 30, 10), item('92A', 134, 100, 20, 10)]).labels
    expect(l.tag).toBe('92A'); expect(l.box.maxX).toBe(154)
  })
  it('does not join across a gap wider than one label height', () => {
    expect(detectShopLabels([item('SHOP', 100, 100, 30, 10), item('92A', 150, 100, 20, 10)]).labels).toEqual([])
  })
})
