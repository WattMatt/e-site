import { describe, expect, it } from 'vitest'
import { monthlyMaxDemandKva, subHourlyAfterSolar } from './max-demand'

const N = 8760

describe('maximum demand after solar', () => {
  it('spreads the hour\'s net PV/battery contribution evenly over its sub-intervals', () => {
    const kw = new Float64Array(N * 2).fill(100)
    kw[2 * 5000] = 150 // a 30-min spike
    const load = new Float64Array(N).fill(100)
    const imp = new Float64Array(N).fill(100)
    imp[5000] = 40 // PV + battery covered 60 kW on average in hour 5000
    const after = subHourlyAfterSolar({ intervalMin: 30, kw }, { load, import: imp })
    expect(after.kw[10000]).toBe(90) // 150 − 60: the spike survives — MD falls less than energy
    expect(after.kw[10001]).toBe(40)
    expect(after.kw[0]).toBe(100)
  })

  it('never goes negative and grows when the hour grid-charges (import > load)', () => {
    const kw = new Float64Array(N * 4).fill(10)
    const load = new Float64Array(N).fill(10)
    const imp = new Float64Array(N).fill(10)
    imp[0] = 0
    load[1] = 10
    imp[1] = 25
    const after = subHourlyAfterSolar({ intervalMin: 15, kw }, { load, import: imp })
    expect(after.kw[0]).toBe(0)
    expect(after.kw[4]).toBe(25)
  })

  it('monthly MD = highest chargeable interval / PF, per month', () => {
    const kw = new Float64Array(N).fill(50)
    kw[10] = 95 // January
    kw[800] = 190 // February, but not chargeable below
    const chargeable = Array.from({ length: N }, (_, h) => h !== 800)
    const md = monthlyMaxDemandKva({ intervalMin: 60, kw }, 0.95, chargeable)
    expect(md[0]).toBeCloseTo(100, 12)
    expect(md[1]).toBeCloseTo(50 / 0.95, 12)
  })

  it('refuses a series of the wrong length for its interval', () => {
    expect(() => monthlyMaxDemandKva({ intervalMin: 30, kw: new Float64Array(N) }, 0.95)).toThrow(/must have 17520 values/)
  })
})
