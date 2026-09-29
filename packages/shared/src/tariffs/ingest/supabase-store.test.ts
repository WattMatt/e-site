import { describe, expect, it } from 'vitest'
import { makeCharge, makeTariff } from '../types'
import { chargeFromRow, chargeRow, tariffFromRows, tariffRow } from './supabase-store'

describe('row mappers', () => {
  const c = makeCharge({
    component: 'energy', unit: 'R_per_kWh', amountExclVat: 3.09, season: 'low', tou: 'peak',
    unitInferred: true, inferenceReason: 'magnitude: labelled c/kWh but 3.09 < 20, read as R/kWh',
    sourceLocator: { sheet: 'BUFFALO CITY', cell: 'B25' }, extractionMethod: 'parser', label: 'Part 1 - Charge per kWh (c/kWh)',
  })
  it('round-trips a charge through its database row', () => {
    const row = chargeRow('t1', 'd1', c)
    expect(row).toMatchObject({ tariff_id: 't1', source_document_id: 'd1', unit: 'R_per_kWh', unit_inferred: true, block_min_kwh: null })
    expect(row.source_locator).toMatchObject({ cell: 'B25', label: 'Part 1 - Charge per kWh (c/kWh)' })
    expect(chargeFromRow({ ...row, amount_excl_vat: '3.090000', reviewed_at: null })).toMatchObject({
      component: 'energy', unit: 'R_per_kWh', amountExclVat: 3.09, season: 'low', tou: 'peak', label: 'Part 1 - Charge per kWh (c/kWh)',
    })
  })
  it('maps a tariff and rebuilds it with its charges', () => {
    const t = makeTariff({ name: 'Scale 1A', structure: 'flat', category: 'domestic', charges: [c] })
    const row = tariffRow('y1', t)
    expect(row).toMatchObject({ tariff_year_id: 'y1', name: 'Scale 1A', structure: 'flat', category: 'domestic' })
    const back = tariffFromRows({ ...row, id: 't1' }, [{ ...chargeRow('t1', null, c), amount_excl_vat: 3.09 }])
    expect(back).toMatchObject({ name: 'Scale 1A', charges: [{ amountExclVat: 3.09 }] })
  })
})
