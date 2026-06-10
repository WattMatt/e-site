import { describe, it, expect } from 'vitest'
import { flattenForPersist } from './flatten-for-persist'
import type { ParsedBoq, ParsedSection, ParsedItem } from './types'

const sec = (tempId: string, parentTempId: string, over: Partial<ParsedSection> = {}): ParsedSection => ({
  tempId,
  parentTempId,
  kind: 'category',
  code: null,
  title: tempId,
  sortOrder: 0,
  ...over,
})

const item = (sectionTempId: string, over: Partial<ParsedItem> = {}): ParsedItem => ({
  sectionTempId,
  code: 'C1.1',
  description: 'x',
  unit: 'm',
  quantity: 1,
  quantityMode: 'measured',
  rateModel: 'supply_install',
  supplyRate: 10,
  installRate: 5,
  rate: null,
  amount: 15,
  sortOrder: 0,
  ...over,
})

// A valid two-bill parsed BOQ: each bill carries its own kind:'bill' root
// (parentTempId === '') plus a child category and an item.
const valid: ParsedBoq = {
  grandTotalExpected: 350,
  totalExVatExpected: 350,
  vatExpected: 52.5,
  totalInclVatExpected: 402.5,
  bills: [
    {
      tempId: 'bill#A',
      code: '1',
      title: 'MALL',
      expectedTotal: 150,
      sections: [sec('bill#A', '', { kind: 'bill' }), sec('catA', 'bill#A')],
      items: [item('catA', { amount: 150 })],
    },
    {
      tempId: 'bill#B',
      code: '2',
      title: 'TENANT',
      expectedTotal: 200,
      sections: [sec('bill#B', '', { kind: 'bill' }), sec('catB', 'bill#B')],
      items: [item('catB', { amount: 200 })],
    },
  ],
  skippedSheets: ['NOTES TO TENDERER'],
  unclassifiedRows: [],
}

describe('flattenForPersist', () => {
  it('concats all bills sections + items and maps totals', () => {
    const out = flattenForPersist(valid)
    expect(out.sections).toHaveLength(4) // 2 bill roots + 2 categories
    expect(out.items).toHaveLength(2)
    expect(out.totals).toEqual({ exVat: 350, vat: 52.5, inclVat: 402.5 })
    // bill roots carry the '' parent sentinel
    expect(out.sections.filter((s) => s.parentTempId === '')).toHaveLength(2)
  })

  it('throws on a dangling section parent', () => {
    const broken = structuredClone(valid)
    broken.bills[0].sections[1].parentTempId = 'does-not-exist'
    expect(() => flattenForPersist(broken)).toThrow(/Dangling section parent/)
  })

  it('throws on a dangling item section ref', () => {
    const broken = structuredClone(valid)
    broken.bills[0].items[0].sectionTempId = 'ghost-section'
    expect(() => flattenForPersist(broken)).toThrow(/Dangling item section/)
  })
})
