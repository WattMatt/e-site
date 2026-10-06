import { describe, expect, it } from 'vitest'
import type { Charge } from '../types'
import type { ChargeGroupView, ChargeRowView, YoyCell } from './charge-rows'
import { energyRangeText, signedPct, summariseYoy, tariffHeadline } from './headline'

const ch = (p: Partial<Charge> & Pick<Charge, 'component' | 'unit' | 'amountExclVat'>): Charge => ({
  season: 'all', tou: 'all', dayType: 'all', blockMinKwh: null, blockMaxKwh: null, blockBasis: null, demandBasis: null, vatRate: 0.15,
  vatBasis: 'stated_excl', unitInferred: false, inferenceReason: null, sourceLocator: {}, extractionMethod: 'parser', ...p,
})

describe('tariffHeadline', () => {
  it('spans every energy charge in c/kWh, reading rand and cent units alike', () => {
    const h = tariffHeadline({ charges: [
      ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 123.45, tou: 'peak' }),
      ch({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 0.4321, tou: 'off_peak' }),
      ch({ component: 'legacy', unit: 'c_per_kWh', amountExclVat: 9 }),
    ] })
    expect(h.energy).toEqual({ min: 43.21, max: 123.45 })
    expect(energyRangeText(h.energy!)).toBe('43.21–123.45 c/kWh')
  })
  it('a single energy price is one value, not a range', () => {
    expect(energyRangeText({ min: 50, max: 50 })).toBe('50.00 c/kWh')
  })
  it('has no energy figure when no energy charge is per kWh', () => {
    expect(tariffHeadline({ charges: [ch({ component: 'basic', unit: 'R_per_month', amountExclVat: 10 })] }).energy).toBeNull()
  })
  it('lists every per-month or per-day charge in reading order, as one value or a range in its own unit', () => {
    const h = tariffHeadline({ charges: [
      ch({ component: 'network_capacity', unit: 'R_per_POD_day', amountExclVat: 3.25 }),
      ch({ component: 'admin', unit: 'R_per_day', amountExclVat: 7.5 }),
      ch({ component: 'basic', unit: 'R_per_month', amountExclVat: 1200, season: 'high' }),
      ch({ component: 'basic', unit: 'R_per_month', amountExclVat: 900, season: 'low' }),
    ] })
    expect(h.fixed).toEqual([
      { component: 'basic', label: 'Basic charge', text: 'R900.00–R1,200.00/month' },
      { component: 'admin', label: 'Administration charge', text: 'R7.50/day' },
      { component: 'network_capacity', label: 'Network capacity', text: 'R3.25/POD/day' },
    ])
  })
  it('flags capacity or demand charges from per-kVA, per-kW or per-amp units, and keeps them out of the fixed lines', () => {
    const kva = tariffHeadline({ charges: [ch({ component: 'network_capacity', unit: 'R_per_kVA_month', amountExclVat: 20 })] })
    expect(kva.capacityOrDemand).toBe(true)
    expect(kva.fixed).toEqual([])
    expect(tariffHeadline({ charges: [ch({ component: 'capacity_amp', unit: 'R_per_A_month', amountExclVat: 2 })] }).capacityOrDemand).toBe(true)
    expect(tariffHeadline({ charges: [ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 2 })] }).capacityOrDemand).toBe(false)
  })
})

const row = (yoy: YoyCell): ChargeRowView => ({
  id: 'x', component: 'energy', season: '', period: '', dayType: '', block: '', amount: '', vatBasis: 'stated_excl', unitNote: null,
  yoy, citation: '', canViewSource: false, sourceDocumentId: null, locator: {},
})
const group = (...cells: YoyCell[]): ChargeGroupView[] => [{ component: 'energy', label: 'Energy', rows: cells.map(row) }]

describe('summariseYoy', () => {
  it('takes the median of the compared charges and counts the new ones', () => {
    expect(summariseYoy(group({ kind: 'changed', pct: 10 }, { kind: 'changed', pct: 4 }, { kind: 'new' }, { kind: 'unit_changed' })))
      .toEqual({ medianPct: 7, minPct: 4, maxPct: 10, compared: 2, added: 1 })
  })
  it('one outlier does not drag the typical change', () => {
    expect(summariseYoy(group(...[4, 4, 5, 80].map((pct) => ({ kind: 'changed' as const, pct }))))?.medianPct).toBe(4.5)
    expect(summariseYoy(group(...[4, 5, 80].map((pct) => ({ kind: 'changed' as const, pct }))))?.medianPct).toBe(5)
  })
  it('is null without a previous year, so nothing claims 0 %', () => {
    expect(summariseYoy(group({ kind: 'no_previous' }, { kind: 'no_previous' }))).toBeNull()
    expect(summariseYoy([])).toBeNull()
  })
  it('a year of only new charges compares nothing', () => {
    expect(summariseYoy(group({ kind: 'new' }))).toEqual({ medianPct: 0, minPct: 0, maxPct: 0, compared: 0, added: 1 })
  })
})

describe('signedPct', () => {
  it('signs and rounds to one decimal, never "-0.0"', () => {
    expect(signedPct(8.746)).toBe('+8.7 %')
    expect(signedPct(-1.24)).toBe('-1.2 %')
    expect(signedPct(-0.01)).toBe('0.0 %')
  })
})
