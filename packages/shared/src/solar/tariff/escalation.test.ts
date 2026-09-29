import { describe, it, expect } from 'vitest'
import {
  buildEscalationRows, escalationSettingsFrom, parseStoredEscalation, validateEscalationOverrides, escalationPathFromRows,
  yearOneCatchUp, describeYearOneCatchUp,
} from './escalation'
import { escalationRate } from '../../services/solar/finance/factors'

const settings = escalationSettingsFrom({ cpi_pct: 5, escalation_start_pct: 9, escalation_year10_pct: 7, escalation_after_cpi_plus_pct: 1, analysis_years: 12 })

describe('escalation path (D-07)', () => {
  it('defaults: 9 % in year 2, linear to 7 % in year 10, then CPI + 1 %', () => {
    const rows = buildEscalationRows({ pinnedFinancialYear: null, published: [], settings, stored: null })
    expect(rows.map((r) => r.year)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(rows[0]).toEqual({ year: 2, pct: 9, source: 'default', financialYear: null })
    expect(rows.find((r) => r.year === 10)!.pct).toBe(7)
    expect(rows.find((r) => r.year === 6)!.pct).toBe(8)
    expect(rows.find((r) => r.year === 11)!.pct).toBe(6)
  })
  it('uses the approved increase of consecutive published years after the pinned year', () => {
    const rows = buildEscalationRows({
      pinnedFinancialYear: '2025/26',
      published: [{ financialYear: '2026/27', approvedIncreasePct: 12.74 }, { financialYear: '2028/29', approvedIncreasePct: 5 }],
      settings, stored: null,
    })
    expect(rows[0]).toEqual({ year: 2, pct: 12.74, source: 'published', financialYear: '2026/27' })
    // 2027/28 is missing: the published run ends; year 3 is the default path, 2028/29 is NOT used out of order.
    expect(rows[1]).toEqual({ year: 3, pct: 8.75, source: 'default', financialYear: null })
  })
  it('a user override wins', () => {
    const rows = buildEscalationRows({ pinnedFinancialYear: null, published: [], settings, stored: { version: 1, overrides: { '3': 15 } } })
    expect(rows[1]).toEqual({ year: 3, pct: 15, source: 'override', financialYear: null })
  })
  it('missing settings fall back to the org-settings defaults (D-07)', () => {
    expect(escalationSettingsFrom({})).toEqual({ cpiPct: 5, startPct: 9, year10Pct: 7, afterCpiPlusPct: 1, analysisYears: 25 })
  })
  it('the engine path reproduces the table exactly', () => {
    const rows = buildEscalationRows({ pinnedFinancialYear: null, published: [], settings, stored: { version: 1, overrides: { '4': 20 } } })
    const path = escalationPathFromRows(rows, settings)
    for (const r of rows) expect(Math.round(escalationRate(r.year, path, 0.05) * 100 * 1000) / 1000).toBe(r.pct)
  })
  it('parses stored JSON defensively', () => {
    expect(parseStoredEscalation(null)).toBeNull()
    expect(parseStoredEscalation({ version: 1, overrides: { '2': 10, x: 3, '3': 'a' } })).toEqual({ version: 1, overrides: { '2': 10 } })
  })
  it('validates the override form', () => {
    expect(validateEscalationOverrides({ '2': '10,5', '3': '', '4': 'abc', '40': '1' }, 12)).toEqual({
      overrides: { '2': 10.5 },
      errors: { '4': 'Enter a percentage', '40': 'Year 40 is outside the 12-year analysis' },
    })
    expect(validateEscalationOverrides({ '2': '150' }, 12).errors).toEqual({ '2': 'Must be between -50 and 100 %' })
  })
})

describe('year-1 catch-up (TARIFF-12)', () => {
  const published = [{ financialYear: '2025/26', approvedIncreasePct: 12.74 }, { financialYear: '2026/27', approvedIncreasePct: 10 }, { financialYear: '2027/28', approvedIncreasePct: 8 }]
  it('year 2 continues from the study’s year-1 financial year, not the pinned one', () => {
    const rows = buildEscalationRows({ pinnedFinancialYear: '2025/26', studyFinancialYear: '2026/27', published, settings, stored: null })
    expect(rows[0]).toEqual({ year: 2, pct: 8, source: 'published', financialYear: '2027/28' })
    expect(rows[1]).toMatchObject({ year: 3, source: 'default' })
  })
  it('no catch-up when the pinned year covers (or follows) year 1', () => {
    expect(yearOneCatchUp({ pinnedFinancialYear: '2026/27', studyFinancialYear: '2026/27', published, settings })).toBeNull()
    expect(yearOneCatchUp({ pinnedFinancialYear: '2027/28', studyFinancialYear: '2026/27', published, settings })).toBeNull()
    expect(yearOneCatchUp({ pinnedFinancialYear: '2025/26', studyFinancialYear: null, published, settings })).toBeNull()
  })
  it('describes exactly what was applied', () => {
    const c = yearOneCatchUp({ pinnedFinancialYear: '2025/26', studyFinancialYear: '2026/27', published, settings })!
    expect(describeYearOneCatchUp(c)).toBe('2025/26 rates + 10.0% (2026/27 approved increase)')
  })
})
