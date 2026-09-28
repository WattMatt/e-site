import { describe, it, expect } from 'vitest'
import { makeCharge, makeTariff } from '@esite/shared'
import { buildReviewModel } from './review-model'

describe('buildReviewModel', () => {
  it('attaches each issue to its charge row by index, and year-level issues to the tariff', () => {
    const tariff = makeTariff({ name: 'Commercial', structure: 'flat', charges: [
      makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 2500 }),
      makeCharge({ component: 'basic', unit: 'R_per_month', amountExclVat: 400, unitInferred: true, inferenceReason: 'no unit' }),
    ] })
    const chargeRows = [
      { id: 'c-energy', source_document_id: 'd1', source_locator: { page: 3 }, reviewed_at: null },
      { id: 'c-basic', source_document_id: 'd1', source_locator: { page: 3 }, reviewed_at: null },
    ]
    const m = buildReviewModel([{ id: 't1', row: { code: 'C1' }, tariff, chargeRows }], [
      { code: 'energy_out_of_range', severity: 'block', message: '2500 c/kWh is outside 50-1500 c/kWh', tariff: 'Commercial', chargeIndex: 0 },
      { code: 'yoy_out_of_band', severity: 'review', message: 'Commercial energy: 30%', tariff: 'Commercial' },
    ])
    expect(m[0].issues).toEqual([{ severity: 'review', message: 'Commercial energy: 30%' }])
    expect(m[0].charges[0]).toMatchObject({ id: 'c-energy', amount: 2500, unit: 'c_per_kWh', issues: [{ severity: 'block', message: '2500 c/kWh is outside 50-1500 c/kWh' }] })
    expect(m[0].charges[1]).toMatchObject({ id: 'c-basic', unitInferred: true, inferenceReason: 'no unit', needsReview: true, sourceDocumentId: 'd1' })
  })
})
