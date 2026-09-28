import { describe, it, expect } from 'vitest'
import { parseExportRule, defaultExportRule, exportMethodsFor, validateExportRuleForm, manualExportTariff, type ExportRuleForm } from './export-rule'

const manual = (over: Partial<ExportRuleForm> = {}): ExportRuleForm => ({
  method: 'manual', sourceNote: 'City of Tshwane SSEG schedule 2026/27 p4',
  rates: [{ season: 'all', tou: 'all', unit: 'c_per_kWh', amount: '95,5' }], ...over,
})

describe('export rule', () => {
  it('parses stored JSON and rejects junk', () => {
    expect(parseExportRule({ version: 1, method: 'none' })).toEqual({ version: 1, method: 'none', sourceNote: null })
    expect(parseExportRule({ method: 'cash' })).toBeNull()
    expect(parseExportRule(null)).toBeNull()
  })
  it('offers the linked Gen-offset method only when the tariff has one; defaults to it, else R0', () => {
    expect(exportMethodsFor(true)).toEqual(['linked_tariff', 'none', 'manual'])
    expect(exportMethodsFor(false)).toEqual(['none', 'manual'])
    expect(defaultExportRule(true).method).toBe('linked_tariff')
    expect(defaultExportRule(false).method).toBe('none')
  })
  it('manual: a source note is mandatory, rates parse with a decimal comma', () => {
    expect(validateExportRuleForm(manual(), false)).toEqual({
      rule: { version: 1, method: 'manual', sourceNote: 'City of Tshwane SSEG schedule 2026/27 p4' },
      rates: [{ season: 'all', tou: 'all', unit: 'c_per_kWh', amountExclVat: 95.5 }],
    })
    expect(validateExportRuleForm(manual({ sourceNote: '  ' }), false)).toEqual({ errors: { sourceNote: 'Say where this rate comes from (document and page)' } })
    expect(validateExportRuleForm(manual({ rates: [] }), false)).toEqual({ errors: { rates: 'Enter at least one export rate' } })
  })
  it('manual: refuses duplicate periods, negative and implausible rates', () => {
    const r = { season: 'all' as const, tou: 'all' as const, unit: 'c_per_kWh' as const }
    expect(validateExportRuleForm(manual({ rates: [{ ...r, amount: '90' }, { ...r, amount: '91' }] }), false))
      .toEqual({ errors: { 'rates.1': 'This season and period already has a rate' } })
    expect(validateExportRuleForm(manual({ rates: [{ ...r, amount: '-1' }] }), false)).toEqual({ errors: { 'rates.0': 'Enter a rate of 0 or more' } })
    expect(validateExportRuleForm(manual({ rates: [{ ...r, unit: 'R_per_kWh', amount: '95' }] }), false))
      .toEqual({ errors: { 'rates.0': 'R95/kWh is not a plausible export rate (0 to 15 R/kWh)' } })
  })
  it('linked is refused when the tariff has no export tariff', () => {
    expect(validateExportRuleForm({ method: 'linked_tariff', sourceNote: '', rates: [] }, false))
      .toEqual({ errors: { method: 'This tariff has no linked export tariff' } })
  })
  it('none and linked store no rates', () => {
    expect(validateExportRuleForm({ method: 'none', sourceNote: '', rates: [] }, true))
      .toEqual({ rule: { version: 1, method: 'none', sourceNote: null }, rates: [] })
  })
  it('builds an export tariff the bill engine can use', () => {
    const t = manualExportTariff([{ season: 'all', tou: 'peak', unit: 'c_per_kWh', amountExclVat: 120 }], 'note')
    expect(t.structure).toBe('tou')
    expect(t.charges[0]).toMatchObject({ component: 'export_credit', tou: 'peak', unit: 'c_per_kWh', amountExclVat: 120, extractionMethod: 'manual' })
  })
})
