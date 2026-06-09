import { describe, it, expect } from 'vitest'
import { boqItemSchema, boqItemRatePatchSchema, QUANTITY_MODES, RATE_MODELS } from './boq.schema'

describe('boq.schema', () => {
  it('accepts a valid supply/install line item', () => {
    const parsed = boqItemSchema.parse({
      id: '00000000-0000-0000-0000-000000000001',
      sectionId: '00000000-0000-0000-0000-000000000002',
      code: 'C1.1', description: '4C x 185mm', unit: 'm',
      quantity: 2363, quantityMode: 'measured', rateModel: 'supply_install',
      supplyRate: 540.75, installRate: 18, rate: null, amount: 1320326.25, sortOrder: 0,
    })
    expect(parsed.amount).toBe(1320326.25)
  })
  it('rejects an unknown quantity_mode', () => {
    expect(() => boqItemSchema.parse({ quantityMode: 'bogus' } as never)).toThrow()
  })
  it('rate patch requires at least one rate field', () => {
    expect(() => boqItemRatePatchSchema.parse({})).toThrow()
    expect(boqItemRatePatchSchema.parse({ supplyRate: 10 }).supplyRate).toBe(10)
  })
  it('exposes the enum tuples', () => {
    expect(QUANTITY_MODES).toContain('rate_only')
    expect(RATE_MODELS).toContain('amount_only')
  })
})
