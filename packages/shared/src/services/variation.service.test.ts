import { describe, it, expect } from 'vitest'
import { computeLineChange, computeRevisedItem, validateQtyDelta } from './variation.service'
import { computeLineValue, isOverMeasure } from './valuation.service'

const item = (over = {}) => ({ amount: 1000, quantity: 10, supplyRate: 80, installRate: 20, rate: null, rateModel: 'supply_install', quantityMode: 'measured', ...over })

describe('computeLineChange', () => {
  it('adjust: qty_delta x contract rate', () => {
    expect(computeLineChange({ kind: 'adjust', qtyDelta: 5 } as never, item())).toBe(500)
    expect(computeLineChange({ kind: 'adjust', qtyDelta: -3 } as never, item())).toBe(-300)
  })
  it('adjust on RATE-ONLY (amount null): the delta IS the measurement', () => {
    expect(computeLineChange({ kind: 'adjust', qtyDelta: 7 } as never, item({ amount: null, quantity: null, quantityMode: 'rate_only' }))).toBe(700)
  })
  it('add: quantity x own rate (supply_install and single)', () => {
    expect(computeLineChange({ kind: 'add', quantity: 4, rateModel: 'supply_install', supplyRate: 100, installRate: 25, rate: null } as never)).toBe(500)
    expect(computeLineChange({ kind: 'add', quantity: 3, rateModel: 'single', rate: 50, supplyRate: null, installRate: null } as never)).toBe(150)
  })
})

describe('validateQtyDelta (the >= 0 revised-qty floor)', () => {
  it('rejects a delta below the floor', () => {
    // contract qty 10, prior approved deltas -4 => floor is -6
    expect(validateQtyDelta(item(), [-4], -7)).toBe(false)
    expect(validateQtyDelta(item(), [-4], -6)).toBe(true)
  })
  it('RATE-ONLY: floor = -(prior deltas)', () => {
    expect(validateQtyDelta(item({ quantity: null, quantityMode: 'rate_only', amount: null }), [7], -8)).toBe(false)
    expect(validateQtyDelta(item({ quantity: null, quantityMode: 'rate_only', amount: null }), [7], -7)).toBe(true)
  })
})

describe('computeRevisedItem', () => {
  it('contract + approved deltas at the contract rate', () => {
    expect(computeRevisedItem(item(), [5, -2])).toEqual({ revisedQty: 13, revisedAmount: 1300 })
  })
  it('no adjustments => contract position', () => {
    expect(computeRevisedItem(item(), [])).toEqual({ revisedQty: 10, revisedAmount: 1000 })
  })
  it('RATE-ONLY: revised = sum(deltas) x rate', () => {
    expect(computeRevisedItem(item({ quantity: null, amount: null, quantityMode: 'rate_only' }), [7])).toEqual({ revisedQty: 7, revisedAmount: 700 })
  })
  it('amount_only passes through untouched', () => {
    expect(computeRevisedItem(item({ rateModel: 'amount_only', amount: 999, quantity: null }), [])).toEqual({ revisedQty: null, revisedAmount: 999 })
  })
})

describe('computeLineValue with a revised cap', () => {
  it('percent computes against the revised amount', () => {
    expect(computeLineValue(item(), { inputMethod: 'percent', percentComplete: 50, qtyComplete: null }, { revisedAmount: 1300, revisedQty: 13 })).toBe(650)
  })
  it('quantity caps at the revised amount (not contract)', () => {
    // 12 x 100 = 1200 > contract 1000 but <= revised 1300
    expect(computeLineValue(item(), { inputMethod: 'quantity', percentComplete: null, qtyComplete: 12 }, { revisedAmount: 1300, revisedQty: 13 })).toBe(1200)
  })
  it('no revised arg => behaves exactly as before (contract cap)', () => {
    expect(computeLineValue(item(), { inputMethod: 'quantity', percentComplete: null, qtyComplete: 12 })).toBe(1000)
  })
  it('isOverMeasure compares against revised qty when given', () => {
    expect(isOverMeasure(item(), { inputMethod: 'quantity', qtyComplete: 12 }, { revisedAmount: 1300, revisedQty: 13 })).toBe(false)
    expect(isOverMeasure(item(), { inputMethod: 'quantity', qtyComplete: 14 }, { revisedAmount: 1300, revisedQty: 13 })).toBe(true)
  })
})
