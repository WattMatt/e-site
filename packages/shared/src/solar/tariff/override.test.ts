import { describe, it, expect } from 'vitest'
import { overrideChargeFromDb, overrideToTariff, validateOverrideEdit, validateRateEdit } from './override'
import { makeCharge, makeTariff } from '../../tariffs/types'

const dbRow = {
  id: 'oc1', base_charge_id: 'c1', component: 'energy', season: 'all', tou: 'all', day_type: 'all',
  block_min_kwh: null, block_max_kwh: null, block_basis: null, unit: 'c_per_kWh', demand_basis: null,
  amount_excl_vat: '250.000000', vat_rate: '0.1500', vat_basis: 'stated_excl', source_locator: { page: 3 },
  reason: null, edited_at: null, edited_by: null, updated_at: 'T1',
}

describe('override rows', () => {
  it('reads numbers from PostgREST strings', () => {
    expect(overrideChargeFromDb(dbRow)).toMatchObject({ id: 'oc1', amountExclVat: 250, vatRate: 0.15, unit: 'c_per_kWh', updatedAt: 'T1' })
  })
  it('the engine sees the override charges with the base tariff metadata', () => {
    const base = makeTariff({ name: 'Commercial', structure: 'flat', charges: [makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 250 })] })
    const t = overrideToTariff(base, [{ ...overrideChargeFromDb(dbRow), amountExclVat: 199 }])
    expect(t.name).toBe('Commercial')
    expect(t.charges).toHaveLength(1)
    expect(t.charges[0]).toMatchObject({ component: 'energy', amountExclVat: 199, extractionMethod: 'manual' })
  })
  it('an edit needs an amount, a compatible unit and a reason', () => {
    const row = { component: 'energy' as const, season: 'all' as const }
    expect(validateOverrideEdit(row, { amount: '199,5', unit: 'c_per_kWh', reason: 'Lease cl. 14' }))
      .toEqual({ amountExclVat: 199.5, unit: 'c_per_kWh', reason: 'Lease cl. 14' })
    expect(validateOverrideEdit(row, { amount: '', unit: '', reason: '' })).toEqual({
      errors: { amount: 'Enter an amount', unit: 'Choose a unit', reason: 'Say why this rate differs from the published one' },
    })
    expect(validateOverrideEdit(row, { amount: '5', unit: 'R_per_month', reason: 'x' }))
      .toEqual({ errors: { unit: 'Not a valid unit for Energy: R/month' } })
  })
  it('refuses a rate outside the ingestion ranges', () => {
    expect(validateOverrideEdit({ component: 'energy', season: 'all' }, { amount: '2500', unit: 'c_per_kWh', reason: 'x' }))
      .toEqual({ errors: { amount: '2500 c/kWh is outside 50-1500 c/kWh' } })
  })
  it('the rate check alone (library review Edit) needs no reason', () => {
    expect(validateRateEdit({ component: 'basic', season: 'all' }, { amount: '400', unit: 'R_per_month' }))
      .toEqual({ amountExclVat: 400, unit: 'R_per_month' })
    expect(validateRateEdit({ component: 'basic', season: 'all' }, { amount: '400', unit: 'c_per_kWh' }))
      .toEqual({ errors: { unit: 'Not a valid unit for Basic charge: c/kWh' } })
  })
})
