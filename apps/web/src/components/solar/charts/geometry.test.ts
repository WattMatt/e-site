import { describe, it, expect } from 'vitest'
import { linearScale, niceTicks, linePath, extentWithZero, waterfallBars, tornadoLayout } from './geometry'

describe('chart geometry', () => {
  it('linearScale maps domain to range (inverted y works)', () => {
    const y = linearScale([0, 100], [200, 0])
    expect(y(0)).toBe(200); expect(y(100)).toBe(0); expect(y(50)).toBe(100)
    expect(linearScale([5, 5], [0, 10])(5)).toBe(0)
  })
  it('niceTicks returns round steps covering the domain', () => {
    expect(niceTicks(0, 97, 5)).toEqual([0, 20, 40, 60, 80, 100])
    expect(niceTicks(-3, 7, 5)).toEqual([-4, -2, 0, 2, 4, 6, 8])
  })
  it('extentWithZero always includes zero', () => {
    expect(extentWithZero([[3, 5], [4]])).toEqual([0, 5])
    expect(extentWithZero([[-2, 1]])).toEqual([-2, 1])
    expect(extentWithZero([[]])).toEqual([0, 1])
  })
  it('linePath', () => {
    expect(linePath([1, 2], (i) => i * 10, (v) => v)).toBe('M0,1L10,2')
  })
  it('waterfallBars: start/subtotal/end from 0, losses step down', () => {
    expect(waterfallBars([
      { kwh: 100, kind: 'start' }, { kwh: 10, kind: 'loss' }, { kwh: 90, kind: 'subtotal' }, { kwh: 5, kind: 'loss' }, { kwh: 85, kind: 'end' },
    ])).toEqual([{ from: 0, to: 100 }, { from: 90, to: 100 }, { from: 0, to: 90 }, { from: 85, to: 90 }, { from: 0, to: 85 }])
  })
  it('tornadoLayout sorts by spread and centres on the base', () => {
    const t = tornadoLayout(0, [{ variable: 'a', lowNpvZar: -1, highNpvZar: 1, spreadZar: 2 }, { variable: 'b', lowNpvZar: -5, highNpvZar: 3, spreadZar: 8 }])
    expect(t.rows.map((r) => r.variable)).toEqual(['b', 'a'])
    expect(t.domain).toEqual([-5, 3])
  })
})
