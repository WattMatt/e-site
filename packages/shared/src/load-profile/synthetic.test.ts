import { describe, expect, it } from 'vitest'
import { buildS3 } from '../services/solar/load/site-series'
import { expandArchetype, getArchetype } from '../services/solar/load/archetypes'
import { referenceYearDates, dayTypeOf } from '../services/solar/load/calendar'
import { synthesiseTenant } from '../services/solar/load/synthesis'
import { admdSeries, sumSeries, tenantScheduleSeries } from './synthetic'

describe('tenantScheduleSeries', () => {
  const r = tenantScheduleSeries([
    { label: 'Shop 1', areaM2: 100, category: 'standard', densityWPerM2: 20 },
    { label: 'Shop 2', areaM2: null, category: 'fast_food' },
  ], 2025, { commonAreaPct: 10 })

  it('is the Solar S3 model exactly (area × density × archetype, + common area)', () => {
    const solo = synthesiseTenant({ areaM2: 100, densityWPerM2: 20, shape: expandArchetype(getArchetype('retail'), 2025) }, 2025)
    expect(Array.from(r.series)).toEqual(Array.from(buildS3({ synths: [solo], commonAreaPct: 10 })))
  })
  it('averages area × density over operating hours (retail weekday/saturday 09:00–18:00)', () => {
    const s = synthesiseTenant({ areaM2: 100, densityWPerM2: 20, shape: expandArchetype(getArchetype('retail'), 2025) }, 2025)
    let sum = 0, n = 0
    referenceYearDates(2025).forEach((d, di) => {
      const t = dayTypeOf(d)
      if (t !== 'weekday' && t !== 'saturday') return
      for (let h = 9; h < 18; h++) { sum += s[di * 24 + h]; n++ }
    })
    expect(sum / n).toBeCloseTo(2, 9) // 100 m² × 20 W/m² = 2 kW
  })
  it('skips a tenant with no area and says why; maps category to archetype', () => {
    expect(r.skipped).toEqual([{ label: 'Shop 2', reason: 'no shop area' }])
    expect(r.lines[0]).toMatchObject({ label: 'Shop 1', archetype: 'retail', densityWPerM2: 20 })
  })
})

describe('admdSeries', () => {
  it('peaks at units × ADMD × PF', () => {
    const s = admdSeries({ units: 50, admdKva: 2, powerFactor: 0.95, archetype: 'anchor_24h' }, 2025)
    expect(Math.max(...s)).toBeCloseTo(95, 9)
  })
  it('refuses zero units', () => {
    expect(() => admdSeries({ units: 0, admdKva: 2, powerFactor: 0.95, archetype: 'retail' }, 2025)).toThrow(/positive/)
  })
  it('sumSeries adds hour by hour and refuses the wrong length', () => {
    expect(sumSeries([new Float64Array(8760).fill(1), new Float64Array(8760).fill(2)])[100]).toBe(3)
    expect(() => sumSeries([new Float64Array(10)])).toThrow(/8760/)
  })
})
