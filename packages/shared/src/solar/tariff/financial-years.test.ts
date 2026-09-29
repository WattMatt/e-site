import { describe, it, expect } from 'vitest'
import { financialYearOn, pickDefaultYear, noteForYear, yearOptionLabel, regimeForLicenseeKind, type TariffYearOption } from './financial-years'
import { escalationSettingsFrom } from './escalation'

const S = escalationSettingsFrom({ escalation_start_pct: 9 })

const y = (fy: string, from: string, to: string, state: 'published' | 'superseded' = 'published'): TariffYearOption =>
  ({ id: fy, financialYear: fy, state, effectiveFrom: from, effectiveTo: to, approvedIncreasePct: null })

describe('financial years', () => {
  it('computes the year covering a date per regime', () => {
    expect(financialYearOn('2026-03-31', 'eskom')).toBe('2025/26')
    expect(financialYearOn('2026-04-01', 'eskom')).toBe('2026/27')
    expect(financialYearOn('2026-06-30', 'municipal')).toBe('2025/26')
    expect(financialYearOn('2026-07-01', 'municipal')).toBe('2026/27')
  })
  it('regime from licensee kind: Eskom vs everyone else', () => {
    expect(regimeForLicenseeKind('eskom')).toBe('eskom')
    expect(regimeForLicenseeKind('metro')).toBe('municipal')
  })
  it('labels superseded years', () => {
    expect(yearOptionLabel(y('2024/25', '2024-07-01', '2025-06-30', 'superseded'))).toBe('2024/25 (superseded)')
  })
  it('defaults to the year covering today', () => {
    const ys = [y('2025/26', '2025-07-01', '2026-06-30'), y('2024/25', '2024-07-01', '2025-06-30', 'superseded')]
    expect(pickDefaultYear(ys, '2026-01-10', 'municipal', S)).toEqual({ yearId: '2025/26', note: null })
  })
  it('falls back to the latest year with the amber note when today is not covered', () => {
    const ys = [y('2025/26', '2025-07-01', '2026-06-30')]
    expect(pickDefaultYear(ys, '2026-08-01', 'municipal', S)).toEqual({
      yearId: '2025/26', note: '2026/27 not yet published in the library — year 1 uses 2025/26 rates + 9.0% (2026/27 org default escalation)',
    })
    expect(pickDefaultYear([], '2026-08-01', 'municipal', S)).toEqual({ yearId: null, note: null })
  })
  it('notes the SELECTED year too (a pinned or ?fy= year), not only the default', () => {
    const ys = [y('2025/26', '2025-07-01', '2026-06-30'), y('2024/25', '2024-07-01', '2025-06-30', 'superseded')]
    expect(noteForYear(ys, '2025/26', '2026-01-10', 'municipal', S)).toBeNull()
    expect(noteForYear(ys, '2024/25', '2026-01-10', 'municipal', S)).toBe('2024/25 does not cover today: 2025/26 is published in the library — year 1 uses 2024/25 rates + 9.0% (2025/26 org default escalation)')
    expect(noteForYear(ys, '2025/26', '2026-08-01', 'municipal', S)).toBe('2026/27 not yet published in the library — year 1 uses 2025/26 rates + 9.0% (2026/27 org default escalation)')
    expect(noteForYear(ys, '2024/25', '2026-08-01', 'municipal', S)).toBe('2026/27 not yet published in the library — year 1 uses 2024/25 rates + 18.8% (2025/26 org default escalation 9.0%, 2026/27 org default escalation 9.0%)')
    expect(noteForYear([y('2026/27', '2026-07-01', '2027-06-30')], '2026/27', '2026-01-10', 'municipal', S)).toBe('2026/27 has not started yet')
    expect(noteForYear(ys, 'missing', '2026-01-10', 'municipal', S)).toBeNull()
    expect(noteForYear(ys, null, '2026-01-10', 'municipal', S)).toBeNull()
  })
  it('names the licensee’s approved increase when the library records one (TARIFF-12)', () => {
    const ys = [{ ...y('2025/26', '2025-07-01', '2026-06-30'), approvedIncreasePct: 10 }, y('2024/25', '2024-07-01', '2025-06-30', 'superseded')]
    expect(noteForYear(ys, '2024/25', '2026-01-10', 'municipal', S)).toBe('2024/25 does not cover today: 2025/26 is published in the library — year 1 uses 2024/25 rates + 10.0% (2025/26 approved increase)')
  })
})
