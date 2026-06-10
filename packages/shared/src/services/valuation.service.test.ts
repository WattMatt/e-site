import { describe, it, expect } from 'vitest'
import { computeLineValue, computeCertificate } from './valuation.service'

const item = (over = {}) => ({ amount: 1000, supplyRate: 80, installRate: 20, rate: null, rateModel: 'supply_install', ...over })

describe('computeLineValue', () => {
  it('percent: amount × %', () => {
    expect(computeLineValue(item(), { inputMethod: 'percent', percentComplete: 25, qtyComplete: null })).toBe(250)
  })
  it('section behaves like percent', () => {
    expect(computeLineValue(item(), { inputMethod: 'section', percentComplete: 50, qtyComplete: null })).toBe(500)
  })
  it('clamps percent to 0–100', () => {
    expect(computeLineValue(item(), { inputMethod: 'percent', percentComplete: 150, qtyComplete: null })).toBe(1000)
    expect(computeLineValue(item(), { inputMethod: 'percent', percentComplete: -5, qtyComplete: null })).toBe(0)
  })
  it('quantity: qty × (supply+install), capped at contract amount', () => {
    // 8 × (80+20) = 800
    expect(computeLineValue(item(), { inputMethod: 'quantity', percentComplete: null, qtyComplete: 8 })).toBe(800)
    // over-measure 20 × 100 = 2000, capped at contract amount 1000
    expect(computeLineValue(item(), { inputMethod: 'quantity', percentComplete: null, qtyComplete: 20 })).toBe(1000)
  })
  it('RATE-ONLY (amount null): quantity is uncapped (no contract amount)', () => {
    expect(computeLineValue(item({ amount: null }), { inputMethod: 'quantity', percentComplete: null, qtyComplete: 5 })).toBe(500)
  })
  it('single rate model uses rate', () => {
    expect(computeLineValue(item({ rateModel: 'single', rate: 50, supplyRate: null, installRate: null }), { inputMethod: 'quantity', percentComplete: null, qtyComplete: 4 })).toBe(200)
  })
})

describe('computeCertificate', () => {
  it('gross − retention − previous = due (+15% VAT)', () => {
    // gross 10000, retention 5% = 500, net 9500, previous 4000 → due 5500, vat 825, incl 6325
    const c = computeCertificate([{ valueToDate: 6000 }, { valueToDate: 4000 }], 5, 4000)
    expect(c.grossToDate).toBe(10000)
    expect(c.retention).toBe(500)
    expect(c.netToDate).toBe(9500)
    expect(c.dueExVat).toBe(5500)
    expect(c.vat).toBe(825)
    expect(c.dueInclVat).toBe(6325)
  })
  it('first valuation: previousNet 0', () => {
    expect(computeCertificate([{ valueToDate: 1000 }], 0, 0).dueExVat).toBe(1000)
  })
})
