import { describe, it, expect } from 'vitest'
import { reconcile } from './reconcile'
import type { ParsedBoq } from './types'

// The bill's stored amounts are what reconcile must sum — note the second item
// is a provisional allowance with NO qty/rate (qty×rate would be null/0), so a
// total of 350 only holds if reconcile sums the STORED amounts, not recomputes.
const parsed: ParsedBoq = {
  grandTotalExpected: 350, totalExVatExpected: 350, vatExpected: 52.5, totalInclVatExpected: 402.5,
  bills: [{ tempId: 'b1', code: '1', title: 'MALL', expectedTotal: 350,
    sections: [{ tempId: 'c1', parentTempId: 'b1', kind: 'category', code: 'C1', title: 'cat', sortOrder: 0 }],
    items: [
      { sectionTempId: 'c1', code: 'C1.1', description: 'x', unit: 'm', quantity: 1, quantityMode: 'measured',
        rateModel: 'supply_install', supplyRate: 100, installRate: 50, rate: null, amount: 150, sortOrder: 0 },
      { sectionTempId: 'c1', code: 'C1.2', description: 'PROVISIONAL allowance', unit: null, quantity: null, quantityMode: 'provisional',
        rateModel: 'supply_install', supplyRate: null, installRate: null, rate: null, amount: 200, sortOrder: 1 },
    ] }],
  skippedSheets: ['NOTES TO TENDERER'],
  unclassifiedRows: [],
}

describe('reconcile', () => {
  it('matches by summing STORED amounts (including non-measured rows)', () => {
    const r = reconcile(parsed)
    expect(r.matched).toBe(true)
    // 150 (measured) + 200 (provisional, qty×rate would be 0) = 350.
    expect(r.grandTotalComputed).toBe(350)
    expect(r.billResults.find(b => b.tempId === 'b1')!.computed).toBe(350)
  })

  it('flags a bill whose stored amounts do not sum to its expected total', () => {
    const bad = structuredClone(parsed); bad.bills[0].expectedTotal = 999
    const r = reconcile(bad)
    expect(r.matched).toBe(false)
    expect(r.billResults.find(b => b.tempId === 'b1')!.matched).toBe(false)
  })

  it('treats a null expected total as matched-but-warned', () => {
    const noExpected = structuredClone(parsed)
    noExpected.bills[0].expectedTotal = null
    noExpected.grandTotalExpected = null
    const r = reconcile(noExpected)
    const bill = r.billResults.find(b => b.tempId === 'b1')!
    expect(bill.matched).toBe(true)
    expect(bill.expected).toBeNull()
    expect(bill.computed).toBe(350)
    expect(r.warnings.some(w => w.includes('"1"') && /no expected total/i.test(w))).toBe(true)
    expect(r.warnings.some(w => /no expected grand total/i.test(w))).toBe(true)
  })

  it('surfaces an unclassified priced row as a warning', () => {
    const withDropped = structuredClone(parsed)
    withDropped.unclassifiedRows = [
      { sheet: '7-18 Shoprite', rowIndex: 42, code: '10.1', description: 'Supply and install isolator', amount: 458.85 },
    ]
    const r = reconcile(withDropped)
    expect(
      r.warnings.some(
        (w) => /Unparsed priced row/i.test(w) && w.includes('7-18 Shoprite') && w.includes('10.1') && w.includes('458.85'),
      ),
    ).toBe(true)
  })
})
