/**
 * Financial-year choice on the Tariff tab (spec §5 "Financial year"): default
 * to the published year covering today; when none covers it, the latest year
 * with the amber note. Eskom years start 1 April, municipal 1 July (2a's
 * tariffs/financial-year.ts owns the regime and the date ranges).
 */
import type { TariffRegime } from '../../tariffs/financial-year'
import type { LicenseeKind } from '../../tariffs/types'

export interface TariffYearOption {
  id: string
  financialYear: string
  state: 'published' | 'superseded'
  effectiveFrom: string
  effectiveTo: string
  approvedIncreasePct: number | null
}

export function regimeForLicenseeKind(kind: LicenseeKind): TariffRegime {
  return kind === 'eskom' ? 'eskom' : 'municipal'
}

/** "2026/27" for the year starting in 2026. */
export function financialYearLabel(startYear: number): string {
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`
}

export function financialYearOn(dateIso: string, regime: TariffRegime): string {
  const [y, m] = dateIso.slice(0, 10).split('-').map(Number)
  const start = m >= (regime === 'eskom' ? 4 : 7) ? y : y - 1
  return financialYearLabel(start)
}

export function yearOptionLabel(y: Pick<TariffYearOption, 'financialYear' | 'state'>): string {
  return y.state === 'superseded' ? `${y.financialYear} (superseded)` : y.financialYear
}

export function pickDefaultYear(
  years: readonly TariffYearOption[], todayIso: string, regime: TariffRegime,
): { yearId: string | null; note: string | null } {
  if (years.length === 0) return { yearId: null, note: null }
  const today = todayIso.slice(0, 10)
  const covering = years.find((y) => y.effectiveFrom <= today && today <= y.effectiveTo)
  if (covering) return { yearId: covering.id, note: null }
  const latest = [...years].sort((a, b) => b.financialYear.localeCompare(a.financialYear))[0]
  const want = financialYearOn(today, regime)
  if (latest.financialYear < want) {
    return { yearId: latest.id, note: `${want} not yet published in the library — using ${latest.financialYear} with escalation` }
  }
  return { yearId: latest.id, note: null }
}

/**
 * The amber note for whichever year is SELECTED (the default, a pinned
 * tariff's year, or ?fy=): says when it does not cover today and whether the
 * current year exists in the library.
 */
export function noteForYear(
  years: readonly TariffYearOption[], yearId: string | null, todayIso: string, regime: TariffRegime,
): string | null {
  const sel = yearId ? years.find((y) => y.id === yearId) : undefined
  if (!sel) return null
  const today = todayIso.slice(0, 10)
  if (sel.effectiveFrom <= today && today <= sel.effectiveTo) return null
  const want = financialYearOn(today, regime)
  if (sel.financialYear > want) return `${sel.financialYear} has not started yet`
  if (years.some((y) => y.financialYear === want && y.state === 'published')) return `${sel.financialYear} does not cover today: ${want} is published in the library`
  return `${want} not yet published in the library — using ${sel.financialYear} with escalation`
}
