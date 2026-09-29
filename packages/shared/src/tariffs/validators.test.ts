import { describe, expect, it } from 'vitest'
import { hasBlockingIssues, normaliseTariffName, validateTariff, validateTariffYear } from './validators'
import { makeCharge, makeTariff, type Charge } from './types'

const e = (p: Partial<Charge> = {}): Charge => makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 200, ...p })
const codes = (t: Parameters<typeof validateTariff>[0]) => validateTariff(t).map((i) => i.code)

describe('validateTariff', () => {
  it('blocks an empty tariff and a non-numeric amount', () => {
    expect(codes(makeTariff({ name: 'x', structure: 'flat', charges: [] }))).toContain('empty_tariff')
    expect(codes(makeTariff({ name: 'x', structure: 'flat', charges: [e({ amountExclVat: Number.NaN })] }))).toContain('non_numeric')
  })

  it('blocks a TOU tariff missing a period (the old seed dropped Standard)', () => {
    const t = makeTariff({ name: 'tou', structure: 'tou', charges: [
      e({ season: 'low', tou: 'peak' }), e({ season: 'low', tou: 'off_peak' }),
      e({ season: 'high', tou: 'peak' }), e({ season: 'high', tou: 'standard' }), e({ season: 'high', tou: 'off_peak' }),
    ] })
    const issue = validateTariff(t).find((i) => i.code === 'tou_incomplete')
    expect(issue?.message).toMatch(/low standard/)
  })

  it('accepts three all-season TOU values', () => {
    const t = makeTariff({ name: 'tou', structure: 'tou', charges: [e({ tou: 'peak' }), e({ tou: 'standard' }), e({ tou: 'off_peak' })] })
    expect(codes(t)).not.toContain('tou_incomplete')
  })

  it('blocks a block whose range runs backwards (the database refuses max <= min)', () => {
    // Northern Cape 2025/26 source typo: "Block 3 (>701 -600kWh)".
    const t = makeTariff({ name: 'Commercial', structure: 'ibt', charges: [e({ blockMinKwh: 701, blockMaxKwh: 600, blockBasis: 'monthly' })] })
    expect(validateTariff(t).find((i) => i.code === 'block_range_inverted')?.severity).toBe('block')
  })
  it('blocks non-contiguous inclining blocks and a bounded top block', () => {
    const gap = makeTariff({ name: 'ibt', structure: 'ibt', charges: [
      e({ blockMinKwh: 0, blockMaxKwh: 50, blockBasis: 'monthly' }), e({ blockMinKwh: 2000, blockMaxKwh: null, blockBasis: 'monthly' }),
    ] })
    expect(codes(gap)).toContain('ibt_gap')
    const bounded = makeTariff({ name: 'ibt', structure: 'ibt', charges: [e({ blockMinKwh: 0, blockMaxKwh: 50, blockBasis: 'monthly' })] })
    expect(codes(bounded)).toContain('ibt_gap')
    const ok = makeTariff({ name: 'ibt', structure: 'ibt', charges: [
      e({ blockMinKwh: 0, blockMaxKwh: 500, blockBasis: 'monthly' }), e({ blockMinKwh: 500, blockMaxKwh: null, blockBasis: 'monthly' }),
    ] })
    expect(codes(ok)).not.toContain('ibt_gap')
  })

  it('blocks an energy rate outside 50-1500 c/kWh but allows a free first block', () => {
    expect(codes(makeTariff({ name: 'x', structure: 'flat', charges: [e({ amountExclVat: 3.09 })] }))).toContain('energy_out_of_range')
    expect(codes(makeTariff({ name: 'x', structure: 'flat', charges: [e({ unit: 'R_per_kWh', amountExclVat: 3.09 })] }))).not.toContain('energy_out_of_range')
    expect(codes(makeTariff({ name: 'x', structure: 'flat', charges: [e({ amountExclVat: 0 })] }))).not.toContain('energy_out_of_range')
  })

  it('blocks a fixed charge in a non-fixed unit', () => {
    const t = makeTariff({ name: 'x', structure: 'flat', charges: [makeCharge({ component: 'basic', unit: 'c_per_kWh', amountExclVat: 100 })] })
    expect(codes(t)).toContain('fixed_unit')
  })

  it('warns when a basic charge equals an energy rate (NMB Small Business Prepaid 334.12)', () => {
    const t = makeTariff({ name: 'NMB', structure: 'flat', charges: [
      makeCharge({ component: 'basic', unit: 'R_per_month', amountExclVat: 334.12 }), e({ amountExclVat: 334.12 }),
    ] })
    const dup = validateTariff(t).find((i) => i.code === 'duplicate_value')
    expect(dup?.severity).toBe('warn')
  })

  it('asks for review of an inferred unit until it is reviewed', () => {
    const inferred = e({ unit: 'R_per_kWh', amountExclVat: 3.09, unitInferred: true, inferenceReason: 'magnitude' })
    expect(codes(makeTariff({ name: 'x', structure: 'flat', charges: [inferred] }))).toContain('inferred_unit')
    expect(codes(makeTariff({ name: 'x', structure: 'flat', charges: [{ ...inferred, reviewedAt: '2026-09-28' }] }))).not.toContain('inferred_unit')
  })

  it('checks Eskom excl/incl pairs at x1.15 within 2 cents', () => {
    const good = e({ amountExclVat: 706.97, sourceLocator: { raw_incl: 813.02 } })
    const bad = e({ amountExclVat: 706.97, sourceLocator: { raw_incl: 800 } })
    expect(codes(makeTariff({ name: 'x', structure: 'flat', charges: [good] }))).not.toContain('vat_pair')
    expect(codes(makeTariff({ name: 'x', structure: 'flat', charges: [bad] }))).toContain('vat_pair')
  })
})

describe('validateTariffYear', () => {
  it('blocks two tariffs whose names normalise to the same thing', () => {
    const a = makeTariff({ name: 'Domestic  Prepaid', structure: 'flat', charges: [e()] })
    const b = makeTariff({ name: 'DOMESTIC PREPAID [row 12]', structure: 'flat', charges: [e()] })
    const issues = validateTariffYear([a, b])
    expect(issues.map((i) => i.code)).toContain('duplicate_name')
    expect(hasBlockingIssues(issues)).toBe(true)
    expect(normaliseTariffName('Domestic - Prepaid [row 7]')).toBe('DOMESTIC PREPAID')
  })
  it('passes a clean year', () => {
    expect(hasBlockingIssues(validateTariffYear([makeTariff({ name: 'ok', structure: 'flat', charges: [e()] })]))).toBe(false)
  })
})
