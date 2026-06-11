import { describe, it, expect } from 'vitest'
import { valuationLineSchema, valuationProgressPatchSchema, INPUT_METHODS, VALUATION_STATUSES } from './valuation.schema'

describe('valuation.schema', () => {
  it('accepts a percent line', () => {
    expect(
      valuationLineSchema.parse({
        id: '00000000-0000-0000-0000-000000000001',
        valuationId: '00000000-0000-0000-0000-000000000002',
        boqItemId: '00000000-0000-0000-0000-000000000003',
        inputMethod: 'percent',
        percentComplete: 50,
        qtyComplete: null,
        valueToDate: 100,
      }).inputMethod,
    ).toBe('percent')
  })
  it('progress patch requires a method + the matching field', () => {
    expect(() =>
      valuationProgressPatchSchema.parse({ boqItemId: 'x', inputMethod: 'percent' }),
    ).toThrow()
    expect(
      valuationProgressPatchSchema.parse({
        boqItemId: '00000000-0000-0000-0000-000000000003',
        inputMethod: 'quantity',
        qtyComplete: 12,
      }).qtyComplete,
    ).toBe(12)
  })
  it('exposes enums', () => {
    expect(INPUT_METHODS).toContain('section')
    expect(VALUATION_STATUSES).toContain('certified')
  })
})
