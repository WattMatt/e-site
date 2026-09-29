import { describe, it, expect } from 'vitest'
import { DEFAULT_HANDOVER_TEMPLATE, handoverCompletion, parseHandoverTemplate, templateFromRow } from './handover'

describe('handover template', () => {
  it('the built-in "Solar PV Handover" names the spec’s documents', () => {
    expect(DEFAULT_HANDOVER_TEMPLATE.name).toBe('Solar PV Handover')
    expect(DEFAULT_HANDOVER_TEMPLATE.items.map((i) => i.key)).toEqual([
      'coc', 'sld_as_built', 'commissioning_tests', 'om_manual', 'warranties', 'sseg_registration', 'monitoring_handover', 'as_built_layout', 'training_record',
    ])
  })
  it('validates keys, labels and duplicates', () => {
    expect(parseHandoverTemplate({ name: 'X', items: [{ key: 'Bad Key', label: 'x', required: true }] }).ok).toBe(false)
    expect(parseHandoverTemplate({ name: 'X', items: [{ key: 'a', label: 'A', required: true }, { key: 'a', label: 'B', required: false }] }).ok).toBe(false)
    expect(parseHandoverTemplate({ name: 'X', items: [] }).ok).toBe(false)
    expect(parseHandoverTemplate(DEFAULT_HANDOVER_TEMPLATE)).toEqual({ ok: true, value: DEFAULT_HANDOVER_TEMPLATE })
  })
  it('falls back to the default when the org has no row', () => {
    expect(templateFromRow(null)).toEqual(DEFAULT_HANDOVER_TEMPLATE)
    expect(templateFromRow({ name: 'Ours', items: [{ key: 'coc', label: 'CoC', required: true }] }).items).toHaveLength(1)
  })
})

describe('handoverCompletion', () => {
  it('an item is complete when it links a document or is marked N/A', () => {
    const c = handoverCompletion([
      { required: true, documentId: 'd1', notApplicable: false },
      { required: true, documentId: null, notApplicable: true },
      { required: true, documentId: null, notApplicable: false },
      { required: false, documentId: null, notApplicable: false },
    ])
    expect(c).toEqual({ done: 2, total: 4, pct: 50, requiredDone: 2, requiredTotal: 3 })
  })
  it('no items is 0 %, not NaN', () => {
    expect(handoverCompletion([])).toEqual({ done: 0, total: 0, pct: 0, requiredDone: 0, requiredTotal: 0 })
  })
})
