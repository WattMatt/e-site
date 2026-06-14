import { describe, it, expect } from 'vitest'
import { computeItemAmount, computeRollups } from './boq.service'
import type { BoqSection, BoqItem } from '../schemas/boq.schema'

const sec = (id: string, parent: string | null, kind: BoqSection['kind']): BoqSection =>
  ({ id, importId: 'imp', parentSectionId: parent, kind, code: null, title: id, sortOrder: 0, nodeId: null })

const item = (id: string, sectionId: string, over: Partial<BoqItem>): BoqItem =>
  ({ id, sectionId, code: null, description: 'x', unit: 'm', quantity: 0, quantityMode: 'measured',
     rateModel: 'supply_install', supplyRate: null, installRate: null, rate: null, amount: null, sortOrder: 0,
     origin: 'contract', variationLineId: null, ...over })

describe('computeItemAmount', () => {
  it('supply_install: qty x (supply+install), rounded to 2dp', () => {
    expect(computeItemAmount(item('i', 's', { quantity: 446, supplyRate: 628.3, installRate: 18 }))).toBe(288249.8)
  })

  it('single: qty x rate', () => {
    expect(computeItemAmount(item('i', 's', { rateModel: 'single', quantity: 2, rate: 50 }))).toBe(100)
  })

  it('rate_only => null', () => {
    expect(computeItemAmount(item('i', 's', { quantityMode: 'rate_only', quantity: null, supplyRate: 1122.7 }))).toBeNull()
  })

  it('amount_only: returns the stored amount untouched', () => {
    expect(computeItemAmount(item('i', 's', { rateModel: 'amount_only', amount: 399959.11 }))).toBe(399959.11)
  })

  it('supply_install: null rates treated as 0', () => {
    expect(computeItemAmount(item('i', 's', { quantity: 10, supplyRate: null, installRate: 5 }))).toBe(50)
  })

  it('single: null rate => null', () => {
    expect(computeItemAmount(item('i', 's', { rateModel: 'single', quantity: 10, rate: null }))).toBeNull()
  })

  it('single: null quantity => null (un-entered, not zero)', () => {
    expect(computeItemAmount(item('i', 's', { rateModel: 'single', quantity: null, rate: 50 }))).toBeNull()
  })

  it('supply_install: null quantity => null (un-entered, not zero)', () => {
    expect(computeItemAmount(item('i', 's', { quantity: null, supplyRate: 100, installRate: 20 }))).toBeNull()
  })
})

describe('computeRollups', () => {
  it('rolls leaf sums up the tree', () => {
    const sections = [
      sec('bill', null, 'bill'),
      sec('catA', 'bill', 'category'),
      sec('catB', 'bill', 'category'),
    ]
    const items = [
      item('1', 'catA', { amount: 100 }),
      item('2', 'catA', { amount: 50, quantityMode: 'rate_only' }),
      item('3', 'catB', { amount: 200 }),
    ]
    const totals = computeRollups(sections, items)
    expect(totals.get('catA')).toBe(150)  // 100 + 50
    expect(totals.get('catB')).toBe(200)
    expect(totals.get('bill')).toBe(350)
  })

  it('treats null amounts as 0', () => {
    const sections = [sec('s', null, 'bill')]
    const items = [
      item('1', 's', { amount: null }),
      item('2', 's', { amount: 100 }),
    ]
    expect(computeRollups(sections, items).get('s')).toBe(100)
  })

  it('returns 0 for an empty section', () => {
    const sections = [sec('s', null, 'bill')]
    expect(computeRollups(sections, []).get('s')).toBe(0)
  })

  it('handles three levels of nesting', () => {
    const sections = [
      sec('bill', null, 'bill'),
      sec('sec', 'bill', 'section'),
      sec('cat', 'sec', 'category'),
    ]
    const items = [item('1', 'cat', { amount: 500 })]
    const totals = computeRollups(sections, items)
    expect(totals.get('cat')).toBe(500)
    expect(totals.get('sec')).toBe(500)
    expect(totals.get('bill')).toBe(500)
  })
})
