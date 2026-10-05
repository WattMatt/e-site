import { describe, expect, it } from 'vitest'
import { proposeRates, type PricingLine, type LibraryObservation } from './price-from-library'
import { cpiFromTable } from './escalate'

const cpi = cpiFromTable({ 2026: [100, 100, 100, 100, 100, 110] })
const line = (over: Partial<PricingLine>): PricingLine => ({
  boqItemId: 'b1', origin: null, rateModel: 'supply_install', sectionPath: ['CONDUIT'], description: '20mm Ø', unit: 'm',
  quantityMode: 'measured', supplyRate: null, installRate: null, rate: null, ...over,
})
const obs = (supply: number | null, install: number | null, rate: number, pricedOn = '2026-01-15'): LibraryObservation =>
  ({ signature: 'conduit|m|dia=20|material=pvc', itemId: 'i1', itemCode: 'CONDUIT-20-PVC-M', supplyRate: supply, installRate: install, rate, pricedOn })

describe('proposeRates', () => {
  it('proposes escalated supply and install medians for a supply/install line', () => {
    const [p] = proposeRates([line({})], [obs(4, 2, 6), obs(6, 4, 10), obs(8, 6, 14)], cpi, 'median')
    // CPI 100 → 110: ×1.1
    expect(p).toMatchObject({ boqItemId: 'b1', status: 'priced', itemCode: 'CONDUIT-20-PVC-M', n: 3, proposed: { supplyRate: 6.6, installRate: 4.4, rate: null } })
  })
  it('P75 is selectable per estimate', () => {
    const [p] = proposeRates([line({})], [obs(4, 2, 6), obs(6, 4, 10), obs(8, 6, 14)], cpi, 'p75')
    expect(p.proposed).toEqual({ supplyRate: 7.7, installRate: 5.5, rate: null })
  })
  it('a single-rate line gets the total', () => {
    const [p] = proposeRates([line({ rateModel: 'single' })], [obs(4, 2, 6), obs(null, null, 10)], cpi, 'median')
    expect(p.proposed).toEqual({ supplyRate: null, installRate: null, rate: 8.8 })
  })
  it('never invents a split the library does not have', () => {
    const [p] = proposeRates([line({})], [obs(null, null, 10)], cpi, 'median')
    expect(p).toMatchObject({ status: 'skipped', reason: 'no_split_in_library' })
  })
  it('says why a line is not priced', () => {
    const r = proposeRates([
      line({ boqItemId: 'v', origin: 'variation' }),
      line({ boqItemId: 'x', description: 'Prime cost', quantityMode: 'pc_sum', unit: 'Sum' }),
      line({ boqItemId: 'u', sectionPath: ['LIGHT FITTINGS'], description: 'Type A' }),
      line({ boqItemId: 'e', sectionPath: ['CONDUIT'], description: '25mm Ø' }),
      line({ boqItemId: 'a', rateModel: 'amount_only' }),
    ], [obs(4, 2, 6)], cpi, 'median')
    expect(r.map(x => [x.boqItemId, x.status, x.reason])).toEqual([
      ['v', 'skipped', 'variation_item'], ['x', 'skipped', 'not_a_rate'], ['u', 'skipped', 'no_library_item'],
      ['e', 'skipped', 'no_observations'], ['a', 'skipped', 'amount_only'],
    ])
  })
  it('matches a BOQ line even when it carries no rate yet', () => {
    const [p] = proposeRates([line({ supplyRate: null, installRate: null, rate: null })], [obs(4, 2, 6)], cpi, 'median')
    expect(p.status).toBe('priced')
  })
})
