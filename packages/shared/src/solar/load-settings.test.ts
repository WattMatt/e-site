import { describe, it, expect } from 'vitest'
import { EMPTY_BILLS_FORM, loadSettingsFormFromRow, validateLoadSettings, type LoadSettingsForm } from './load-settings'

const form = (over: Partial<LoadSettingsForm> = {}): LoadSettingsForm => ({
  loadBasis: 'S2', referenceYear: '', loadGrowthPct: '', diversityFactor: '', commonAreaPct: '', ...over,
})

describe('load settings', () => {
  it('defaults blanks and maps to columns — never the basis or the common-area allowance', () => {
    // load_basis belongs to the Load basis bar and common_area_pct to the Tenants tab: a settings save
    // writing them from its own (possibly stale) copy would undo those controls.
    const r = validateLoadSettings(form({ loadBasis: 'S4', commonAreaPct: '42' }), { ...EMPTY_BILLS_FORM, months: EMPTY_BILLS_FORM.months.map(() => ({ kwh: '10', kva: '' })) })
    expect(r.errors).toEqual({})
    expect(r.values).not.toHaveProperty('load_basis')
    expect(r.values).not.toHaveProperty('common_area_pct')
    const blank = validateLoadSettings(form(), EMPTY_BILLS_FORM)
    expect(blank.values).toEqual({ reference_year: null, load_growth_pct: 0, diversity_factor: 1, monthly_bills: null })
  })

  it('validates ranges', () => {
    const r = validateLoadSettings(form({ referenceYear: '1999', loadGrowthPct: '25', diversityFactor: '0.4', commonAreaPct: '101' }), EMPTY_BILLS_FORM)
    expect(Object.keys(r.errors).sort()).toEqual(['diversityFactor', 'loadGrowthPct', 'referenceYear'])
  })

  it('S4 needs twelve positive monthly kWh; kVA optional but positive', () => {
    const bills = { ...EMPTY_BILLS_FORM, months: EMPTY_BILLS_FORM.months.map((_, i) => ({ kwh: i === 3 ? '' : '1000', kva: i === 0 ? '-1' : '' })) }
    const r = validateLoadSettings(form({ loadBasis: 'S4' }), bills)
    expect(r.errors.bills).toMatch(/April/)
    const ok = { ...EMPTY_BILLS_FORM, months: EMPTY_BILLS_FORM.months.map(() => ({ kwh: '1200', kva: '' })) }
    const r2 = validateLoadSettings(form({ loadBasis: 'S4' }), ok)
    expect(r2.errors).toEqual({})
    expect(r2.values.monthly_bills).toEqual({ archetype: 'retail', powerFactor: 0.95, months: Array.from({ length: 12 }, () => ({ kwh: 1200, kva: null })) })
  })

  it('reads a stored row, showing a stored S3 as "Sum of tenants"', () => {
    const { form: f, bills } = loadSettingsFormFromRow({
      load_basis: 'S3', reference_year: 2024, load_growth_pct: '1.50', diversity_factor: '0.850', common_area_pct: '12.00',
      monthly_bills: { archetype: 'supermarket', powerFactor: 0.9, months: Array.from({ length: 12 }, () => ({ kwh: 10, kva: 5 })) },
    })
    expect(f).toEqual({ loadBasis: 'S2', referenceYear: '2024', loadGrowthPct: '1.5', diversityFactor: '0.85', commonAreaPct: '12' })
    expect(bills.archetype).toBe('supermarket')
    expect(bills.months[0]).toEqual({ kwh: '10', kva: '5' })
  })
})
