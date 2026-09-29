import { describe, it, expect } from 'vitest'
import { tariffListItemFromRow, yearOptionFromRow, pinnedChargeFromRow, billCheckFromRow, isTouTariff, exportRateFromRow } from './rows'

describe('tariff tab row mappers', () => {
  it('tariff list item: numbers from PostgREST strings', () => {
    expect(tariffListItemFromRow({ id: 't', code: 'MF', name: 'Miniflex', category: 'commercial', metering: 'conventional', structure: 'tou',
      voltage_band: '500v_22kv', phase: null, min_kva: '25.00', max_kva: null, min_amps: null, max_amps: null, is_legacy: false, export_tariff_id: 'x' }))
      .toEqual({ id: 't', code: 'MF', name: 'Miniflex', category: 'commercial', metering: 'conventional', structure: 'tou', voltageBand: '500v_22kv',
        phase: null, minKva: 25, maxKva: null, minAmps: null, maxAmps: null, isLegacy: false, exportTariffId: 'x' })
  })
  it('year option', () => {
    expect(yearOptionFromRow({ id: 'y', financial_year: '2025/26', state: 'published', effective_from: '2025-07-01', effective_to: '2026-06-30', approved_increase_pct: '12.720' }))
      .toEqual({ id: 'y', financialYear: '2025/26', state: 'published', effectiveFrom: '2025-07-01', effectiveTo: '2026-06-30', approvedIncreasePct: 12.72 })
  })
  it('pinned charge carries its source title and locator', () => {
    const c = pinnedChargeFromRow({ id: 'c', component: 'energy', season: 'high', tou: 'peak', day_type: 'all', block_min_kwh: null, block_max_kwh: null,
      unit: 'c_per_kWh', amount_excl_vat: '412.340000', vat_basis: 'stated_excl', source_document_id: 'd', source_locator: { page: 4 } }, new Map([['d', 'Eskom 2026/27']]))
    expect(c).toMatchObject({ id: 'c', amount: 412.34, sourceTitle: 'Eskom 2026/27', locator: { page: 4 } })
  })
  it('bill check row', () => {
    expect(billCheckFromRow({ id: 'b', billing_month: '2026-03-01', actual_total_excl_vat: '3000.00', modelled_total_excl_vat: '2900.00', difference_pct: '-3.333', created_at: 'T' }))
      .toEqual({ id: 'b', month: '2026-03', actual: 3000, modelled: 2900, differencePct: -3.333, createdAt: 'T' })
  })
  it('export rate row', () => {
    expect(exportRateFromRow({ id: 'r', season: 'all', tou: 'all', unit: 'c_per_kWh', amount_excl_vat: '95.500000', source_note: 'n' }))
      .toEqual({ id: 'r', season: 'all', tou: 'all', unit: 'c_per_kWh', amountExclVat: 95.5 })
  })
  it('TOU when the structure says so or any charge is period-specific', () => {
    expect(isTouTariff('tou', [])).toBe(true)
    expect(isTouTariff('flat', [{ tou: 'all' }])).toBe(false)
    expect(isTouTariff('flat', [{ tou: 'peak' }])).toBe(true)
  })
})
