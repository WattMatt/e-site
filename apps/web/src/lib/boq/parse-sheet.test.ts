import { describe, it, expect } from 'vitest'
import { classifySheet } from './classify-sheet'
import { parseSheet } from './parse-sheet'

const HDR = ['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'SUPPLY', 'INSTALL', 'AMOUNT']
const rows = [
  ['KINGSWALK'], [], HDR,
  ['C1', 'LV CABLE LAID IN GROUND'],           // category
  [null, 'Rates to include for supply...'],    // rate note
  ['C1.1', '4C x 240mm', 'm', 446, 628.3, 18, 288249.8],
  ['C1.2', '4C x 185mm', 'm', 'RATE ONLY', 540.75, 18, null],
]

it('builds a category with two items, tagging RATE ONLY', () => {
  const cls = classifySheet('1.3 Low Voltage', rows)
  const { sections, items } = parseSheet('1.3 Low Voltage', rows, cls)
  const cat = sections.find(s => s.code === 'C1')!
  expect(cat.kind).toBe('category')
  expect(items.filter(i => i.sectionTempId === cat.tempId)).toHaveLength(2)
  const rateOnly = items.find(i => i.code === 'C1.2')!
  expect(rateOnly.quantityMode).toBe('rate_only')
  expect(rateOnly.quantity).toBeNull()
  expect(rateOnly.supplyRate).toBe(540.75)
})

describe('parseSheet — quantity mode detection', () => {
  it('measured: numeric qty', () => {
    const testRows = [HDR, ['C1', 'A category'], ['C1.1', 'A cable', 'm', 100, 10, 2, 1200]]
    const cls = classifySheet('Sheet', testRows)
    const { items } = parseSheet('Sheet', testRows, cls)
    expect(items[0].quantityMode).toBe('measured')
    expect(items[0].quantity).toBe(100)
  })

  it('lump_sum: unit Sum, no qty', () => {
    const testRows = [HDR, ['C1', 'A category'], ['C1.1', 'Provision', 'Sum', null, 5000, 0, 5000]]
    const cls = classifySheet('Sheet', testRows)
    const { items } = parseSheet('Sheet', testRows, cls)
    expect(items[0].quantityMode).toBe('lump_sum')
    expect(items[0].quantity).toBeNull()
  })

  it('provisional: description contains PROVISIONAL', () => {
    const testRows = [HDR, ['C1', 'A category'], ['C1.1', 'PROVISIONAL allowance', null, null, null, null, 10000]]
    const cls = classifySheet('Sheet', testRows)
    const { items } = parseSheet('Sheet', testRows, cls)
    expect(items[0].quantityMode).toBe('provisional')
  })

  it('pc_sum: description contains P.C', () => {
    const testRows = [HDR, ['C1', 'A category'], ['C1.1', 'P.C. Sum for works', null, null, null, null, 5000]]
    const cls = classifySheet('Sheet', testRows)
    const { items } = parseSheet('Sheet', testRows, cls)
    expect(items[0].quantityMode).toBe('pc_sum')
  })

  it('pc_sum: description contains PRIME COST', () => {
    const testRows = [HDR, ['C1', 'A category'], ['C1.1', 'PRIME COST sum', null, null, null, null, 5000]]
    const cls = classifySheet('Sheet', testRows)
    const { items } = parseSheet('Sheet', testRows, cls)
    expect(items[0].quantityMode).toBe('pc_sum')
  })
})

describe('parseSheet — numeric coercion', () => {
  it('blank/null cells coerce to null, not 0', () => {
    const testRows = [HDR, ['C1', 'Cat'], ['C1.1', 'Item', null, null, null, null, null]]
    const cls = classifySheet('Sheet', testRows)
    const { items } = parseSheet('Sheet', testRows, cls)
    expect(items[0].supplyRate).toBeNull()
    expect(items[0].installRate).toBeNull()
    expect(items[0].amount).toBeNull()
    expect(items[0].quantity).toBeNull()
  })
})

describe('parseSheet — tempId and sectionTempId linkage', () => {
  it('items reference the correct category tempId', () => {
    const testRows = [
      HDR,
      ['C1', 'Category 1'],
      ['C1.1', 'Item under C1', 'm', 10, 5, 1, 60],
      ['C2', 'Category 2'],
      ['C2.1', 'Item under C2', 'm', 20, 5, 1, 120],
    ]
    const cls = classifySheet('Sheet', testRows)
    const { sections, items } = parseSheet('Sheet', testRows, cls)
    const c1 = sections.find(s => s.code === 'C1')!
    const c2 = sections.find(s => s.code === 'C2')!
    expect(items.find(i => i.code === 'C1.1')!.sectionTempId).toBe(c1.tempId)
    expect(items.find(i => i.code === 'C2.1')!.sectionTempId).toBe(c2.tempId)
  })
})

describe('parseSheet — coded row with amount is a lump-sum item', () => {
  it('a ^[A-Z]+\\d+$ row with only an amount becomes an item, not a section', () => {
    // P&G shape: code "A1", unit "Sum", no qty/rate, but an amount.
    const testRows = [HDR, ['A1', 'Preliminaries & General', 'Sum', null, null, null, 1139424]]
    const cls = classifySheet('P&G', testRows)
    const { sections, items } = parseSheet('P&G', testRows, cls)
    expect(sections).toHaveLength(0)
    expect(items).toHaveLength(1)
    expect(items[0].code).toBe('A1')
    expect(items[0].amount).toBe(1139424)
    expect(items[0].quantityMode).toBe('lump_sum')
    expect(items[0].rateModel).toBe(cls.rateModel)
  })

  it('a true header row (no amount, no qty/rate) stays a category', () => {
    const testRows = [HDR, ['A1', 'A category header'], ['A1.1', 'A line', 'm', 5, 10, 2, 60]]
    const cls = classifySheet('Sheet', testRows)
    const { sections, items } = parseSheet('Sheet', testRows, cls)
    const cat = sections.find(s => s.code === 'A1')!
    expect(cat).toBeTruthy()
    expect(cat.kind).toBe('category')
    // The header is NOT also captured as an item.
    expect(items.find(i => i.code === 'A1')).toBeUndefined()
    // The real line item is parented under the header category.
    expect(items.find(i => i.code === 'A1.1')!.sectionTempId).toBe(cat.tempId)
  })
})

describe('parseSheet — non-bill sheets return empty', () => {
  it('prose sheet returns empty sections and items', () => {
    const proseRows = [['This is just notes'], ['No header here']]
    const cls = classifySheet('NOTES TO TENDERER', proseRows)
    const { sections, items } = parseSheet('NOTES TO TENDERER', proseRows, cls)
    expect(sections).toHaveLength(0)
    expect(items).toHaveLength(0)
  })
})
