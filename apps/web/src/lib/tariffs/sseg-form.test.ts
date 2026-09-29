import { describe, it, expect } from 'vitest'
import { validateSsegForm, ssegFormFromRow, EMPTY_SSEG_FORM } from './sseg-form'

describe('SSEG rule form', () => {
  it('defaults to the Net-Billing Rules shape', () => {
    expect(EMPTY_SSEG_FORM).toMatchObject({ crediting: 'net_billing_tou', carryForward: 'within_financial_year', capRule: 'kwh_per_tou_period', maxKva: '1000' })
  })
  it('validates and converts to a row', () => {
    const r = validateSsegForm({ ...EMPTY_SSEG_FORM, fyEndMonth: '6', sourceDocumentId: '', pages: 'pp7-12' })
    expect(r).toEqual({ row: {
      crediting: 'net_billing_tou', carry_forward: 'within_financial_year', fy_end_month: 6, cap_rule: 'kwh_per_tou_period',
      forfeit_on_ownership_change: true, max_kva: 1000, requires_tou: true, requires_bidirectional_meter: true,
      source_document_id: null, locator: { pages: 'pp7-12' },
    } })
    expect(validateSsegForm({ ...EMPTY_SSEG_FORM, fyEndMonth: '13', maxKva: '0' })).toEqual({ errors: {
      fyEndMonth: 'Choose the month the financial year ends', maxKva: 'Enter a size above 0 kVA',
    } })
  })
  it('reads a stored row back into the form', () => {
    expect(ssegFormFromRow({ crediting: 'none', carry_forward: 'none', fy_end_month: 3, cap_rule: 'energy_charges',
      forfeit_on_ownership_change: false, max_kva: '500.00', requires_tou: false, requires_bidirectional_meter: true,
      source_document_id: 'd1', locator: { pages: 'p8' } })).toEqual({
      crediting: 'none', carryForward: 'none', fyEndMonth: '3', capRule: 'energy_charges', forfeit: false, maxKva: '500',
      requiresTou: false, requiresBidirectional: true, sourceDocumentId: 'd1', pages: 'p8',
    })
  })
})
