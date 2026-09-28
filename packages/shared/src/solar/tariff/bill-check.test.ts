import { describe, it, expect } from 'vitest'
import { validateBillCheckForm, runBillCheck, BillCheckError, BILL_CHECK_WARN_PCT, EMPTY_BILL_CHECK_FORM } from './bill-check'
import { makeCharge, makeTariff } from '../../tariffs/types'

const flat = makeTariff({ name: 'Flat', structure: 'flat', charges: [
  makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 250 }),
  makeCharge({ component: 'basic', unit: 'R_per_month', amountExclVat: 400 }),
] })

describe('bill check form', () => {
  it('flat tariff: one kWh total, counted as standard', () => {
    const r = validateBillCheckForm({ ...EMPTY_BILL_CHECK_FORM, month: '2026-03', totalKwh: '1 000', actualTotal: '3000' }, false)
    expect(r).toEqual({ input: { year: 2026, month: 3, importKwh: { peak: 0, standard: 1000, off_peak: 0 }, maxDemandKva: null, actualTotalExclVat: 3000, note: null } })
    const nbsp = validateBillCheckForm({ ...EMPTY_BILL_CHECK_FORM, month: '2026-03', totalKwh: '1 000', actualTotal: '3 000,50' }, false)
    expect(nbsp).toMatchObject({ input: { importKwh: { standard: 1000 }, actualTotalExclVat: 3000.5 } })
  })
  it('TOU tariff: three periods, at least one above zero', () => {
    expect(validateBillCheckForm({ ...EMPTY_BILL_CHECK_FORM, month: '2026-07', peak: '0', standard: '', offPeak: '0', actualTotal: '10' }, true))
      .toEqual({ errors: { kwh: 'Enter the kWh the bill shows' } })
  })
  it('names every missing or malformed field', () => {
    expect(validateBillCheckForm({ ...EMPTY_BILL_CHECK_FORM, month: '2026-13', totalKwh: 'x', actualTotal: '0', maxDemandKva: '-1' }, false)).toEqual({
      errors: {
        month: 'Choose the billing month', kwh: 'Enter the kWh the bill shows',
        maxDemandKva: 'Enter a demand of 0 or more', actualTotal: 'Enter the bill total (excl. VAT) above zero',
      },
    })
  })
})

describe('runBillCheck', () => {
  const input = { year: 2026, month: 3, importKwh: { peak: 0, standard: 1000, off_peak: 0 }, maxDemandKva: null, actualTotalExclVat: 3000, note: null }
  it('models the month and reports the % difference', () => {
    const r = runBillCheck(flat, input, { highSeasonMonths: null, nmdKva: null })
    expect(r.modelledTotalExclVat).toBe(2900)
    expect(r.differencePct).toBe(-3.333)
    expect(r.warn).toBe(false)
  })
  it(`warns beyond ±${BILL_CHECK_WARN_PCT} %`, () => {
    const r = runBillCheck(flat, { ...input, actualTotalExclVat: 2700 }, { highSeasonMonths: null, nmdKva: null })
    expect(r.differencePct).toBe(7.407)
    expect(r.warn).toBe(true)
  })
  it('a seasonal tariff without a calendar is refused with a sentence, never guessed', () => {
    const seasonal = makeTariff({ name: 'S', structure: 'seasonal', charges: [
      makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 300, season: 'high' }),
      makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 200, season: 'low' }),
    ] })
    expect(() => runBillCheck(seasonal, input, { highSeasonMonths: null, nmdKva: null })).toThrow(BillCheckError)
    expect(runBillCheck(seasonal, { ...input, month: 7 }, { highSeasonMonths: [6, 7, 8], nmdKva: null }).season).toBe('high')
  })
})
