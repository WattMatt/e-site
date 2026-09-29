/**
 * The automatic checks list (spec §12): 2a's validators (units, VAT pairs,
 * block continuity, TOU completeness, plausible ranges, duplicates) plus the
 * YoY diff against the previous published year (% vs approved increase).
 */
import { diffTariffYears, validateTariffYear, type Tariff, type TariffIssue, type YoyDiff } from '@esite/shared'

export interface YearChecks {
  issues: TariffIssue[]
  blocking: number
  review: number
  warn: number
  yoy: YoyDiff | null
}

export function computeYearChecks(tariffs: Tariff[], previous: Tariff[] | null, approvedIncreasePct: number | null): YearChecks {
  const issues: TariffIssue[] = [...validateTariffYear(tariffs)]
  let yoy: YoyDiff | null = null
  if (previous) {
    yoy = diffTariffYears(previous, tariffs, approvedIncreasePct)
    issues.push(...yoy.issues)
  }
  return {
    issues,
    blocking: issues.filter((i) => i.severity === 'block').length,
    review: issues.filter((i) => i.severity === 'review').length,
    warn: issues.filter((i) => i.severity === 'warn').length,
    yoy,
  }
}
