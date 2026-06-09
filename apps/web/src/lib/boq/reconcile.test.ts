import { describe, it, expect } from 'vitest'
import { reconcile } from './reconcile'
import type { ParsedBoq } from './types'

const parsed: ParsedBoq = {
  grandTotalExpected: 350, totalExVatExpected: 350, vatExpected: 52.5, totalInclVatExpected: 402.5,
  bills: [{ tempId: 'b1', code: '1', title: 'MALL', expectedTotal: 350,
    sections: [{ tempId: 'c1', parentTempId: 'b1', kind: 'category', code: 'C1', title: 'cat', sortOrder: 0 }],
    items: [
      { sectionTempId: 'c1', code: 'C1.1', description: 'x', unit: 'm', quantity: 1, quantityMode: 'measured',
        rateModel: 'supply_install', supplyRate: 100, installRate: 50, rate: null, amount: 150, sortOrder: 0 },
      { sectionTempId: 'c1', code: 'C1.2', description: 'y', unit: 'm', quantity: 2, quantityMode: 'measured',
        rateModel: 'supply_install', supplyRate: 100, installRate: 0, rate: null, amount: 200, sortOrder: 1 },
    ] }],
  skippedSheets: ['NOTES TO TENDERER'],
}

describe('reconcile', () => {
  it('matches when computed totals equal expected', () => {
    const r = reconcile(parsed)
    expect(r.matched).toBe(true)
    expect(r.grandTotalComputed).toBe(350)
  })
  it('flags a bill whose items do not sum to its expected total', () => {
    const bad = structuredClone(parsed); bad.bills[0].expectedTotal = 999
    const r = reconcile(bad)
    expect(r.matched).toBe(false)
    expect(r.billResults.find(b => b.tempId === 'b1')!.matched).toBe(false)
  })
})
