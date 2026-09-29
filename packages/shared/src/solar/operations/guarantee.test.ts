import { describe, it, expect } from 'vitest'
import { expectedForMonth, guaranteeFromRow, modelledMonthKwh, operatingYear, parseGuarantee } from './guarantee'
import { flatBaseline } from './__fixtures__/baseline'

const b = flatBaseline()
const p50 = { basis: 'p50' as const, pct: null, manualMonthlyKwh: null, degradationPctPerYear: 0 }

describe('guarantee derivation (no retyping per month)', () => {
  it('P50 = the baseline month, scaled for a leap February', () => {
    expect(modelledMonthKwh(b, '2026-02')).toBe(1000)
    expect(modelledMonthKwh(b, '2028-02')).toBeCloseTo(1000 * 29 / 28, 6)
  })
  it('nothing is expected before the commissioning month', () => {
    expect(expectedForMonth({ month: '2026-01', guarantee: p50, baseline: b, commissioningDate: '2026-02-15' })).toBeNull()
  })
  it('the commissioning month is prorated by days, from the commissioning day inclusive', () => {
    const e = expectedForMonth({ month: '2026-02', guarantee: p50, baseline: b, commissioningDate: '2026-02-15' })!
    expect(e.fullKwh).toBe(1000)
    expect(e.activeFraction).toBeCloseTo(14 / 28, 6)
    expect(e.kwh).toBeCloseTo(500, 3)
    expect(e.operatingYear).toBe(1)
  })
  it('degrades P50 and % of modelled from operating year 2; manual is the contract and is not degraded', () => {
    expect(operatingYear('2026-02-15', '2027-01')).toBe(1)
    expect(operatingYear('2026-02-15', '2027-02')).toBe(2)
    const d = { ...p50, degradationPctPerYear: 0.5 }
    expect(expectedForMonth({ month: '2027-03', guarantee: d, baseline: b, commissioningDate: '2026-02-15' })!.kwh).toBeCloseTo(995, 6)
    const pct = { ...d, basis: 'pct_of_modelled' as const, pct: 90 }
    expect(expectedForMonth({ month: '2027-03', guarantee: pct, baseline: b, commissioningDate: '2026-02-15' })!.kwh).toBeCloseTo(895.5, 6)
    const manual = { basis: 'manual' as const, pct: null, manualMonthlyKwh: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], degradationPctPerYear: 0.5 }
    expect(expectedForMonth({ month: '2027-03', guarantee: manual, baseline: b, commissioningDate: '2026-02-15' })!.kwh).toBe(3)
  })
  it('validates the basis fields exactly like the database CHECKs', () => {
    expect(parseGuarantee({ ...p50, basis: 'pct_of_modelled' }).ok).toBe(false)
    expect(parseGuarantee({ ...p50, basis: 'manual', manualMonthlyKwh: [1, 2] }).ok).toBe(false)
    expect(parseGuarantee({ ...p50, pct: 50 }).ok).toBe(false)
    expect(parseGuarantee({ ...p50, degradationPctPerYear: 6 }).ok).toBe(false)
    expect(parseGuarantee(p50)).toEqual({ ok: true, value: p50 })
  })
  it('maps a database row (numeric columns arrive as strings)', () => {
    expect(guaranteeFromRow({ basis: 'pct_of_modelled', pct: '92.50', manual_monthly_kwh: null, degradation_pct_per_year: '0.400' }))
      .toEqual({ basis: 'pct_of_modelled', pct: 92.5, manualMonthlyKwh: null, degradationPctPerYear: 0.4 })
  })
})
