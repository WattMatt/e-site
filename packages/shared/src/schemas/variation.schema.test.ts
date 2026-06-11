import { describe, it, expect } from 'vitest'
import { variationLineSchema, variationLinePatchSchema, VARIATION_LINE_KINDS, VO_STATUSES } from './variation.schema'

describe('variation.schema', () => {
  it('accepts an adjust line', () => {
    expect(variationLineSchema.parse({
      id: '00000000-0000-0000-0000-000000000001', variationOrderId: '00000000-0000-0000-0000-000000000002',
      kind: 'adjust', boqItemId: '00000000-0000-0000-0000-000000000003', qtyDelta: -5,
      sectionId: null, code: null, description: null, unit: null, quantity: null,
      rateModel: null, supplyRate: null, installRate: null, rate: null,
      valueChange: -500, materializedItemId: null,
    }).kind).toBe('adjust')
  })
  it('patch refines kind-specific fields', () => {
    expect(() => variationLinePatchSchema.parse({ kind: 'adjust' })).toThrow()            // needs boqItemId+qtyDelta
    expect(() => variationLinePatchSchema.parse({ kind: 'add', description: 'x' })).toThrow() // needs sectionId+quantity+a rate
    expect(variationLinePatchSchema.parse({ kind: 'adjust', boqItemId: '00000000-0000-0000-0000-000000000003', qtyDelta: 10 }).qtyDelta).toBe(10)
  })
  it('enums', () => { expect(VARIATION_LINE_KINDS).toEqual(['adjust', 'add']); expect(VO_STATUSES).toContain('approved') })
})
