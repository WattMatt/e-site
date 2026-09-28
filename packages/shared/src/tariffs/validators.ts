/**
 * Automatic checks (as-is/09 §7.1 Stage D). They run on ingest (recorded in
 * ingest_run.stats) and again on publish (2b). The database itself enforces
 * the two that must never be bypassed: every tariff has a charge, and every
 * inferred unit is reviewed before publish.
 */
import { roundCents } from './money'
import { ENERGY_CENTS_RANGE, randPerKwh, unitClass } from './units'
import { TOU_PERIODS, type SourceLocator, type Tariff, type TariffSeason, type TariffUnit } from './types'

export type TariffIssueSeverity = 'block' | 'review' | 'warn'

export type TariffIssueCode =
  | 'empty_tariff' | 'non_numeric' | 'tou_incomplete' | 'ibt_gap' | 'energy_out_of_range'
  | 'fixed_unit' | 'duplicate_name' | 'duplicate_value' | 'inferred_unit' | 'vat_pair'
  | 'yoy_out_of_band' | 'yoy_unit_changed' | 'legacy_tariff_skipped' | 'unit_unknown'
  | 'orphan_charge' | 'block_unit_typo' | 'sseg_semantics_unknown' | 'eskom_shared_energy_row'
  | 'eskom_duplicate_column' | 'rfd_row_increase_mismatch' | 'increase_missing' | 'sheet_skipped'
  | 'vat_basis_conflict' | 'duplicate_licensee_year'

export interface TariffIssue {
  code: TariffIssueCode
  severity: TariffIssueSeverity
  message: string
  tariff?: string
  chargeIndex?: number
  locator?: SourceLocator
}

const FIXED_UNITS: ReadonlySet<TariffUnit> = new Set<TariffUnit>(['R_per_month', 'R_per_day', 'R_per_POD_day'])

export function normaliseTariffName(name: string): string {
  return name
    .replace(/\s*\[row \d+\]$/i, '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

export function validateTariff(t: Tariff): TariffIssue[] {
  const out: TariffIssue[] = []
  const flag = (code: TariffIssueCode, severity: TariffIssueSeverity, message: string, chargeIndex?: number): void => {
    out.push({
      code, severity, message, tariff: t.name, chargeIndex,
      locator: chargeIndex === undefined ? t.sourceLocator : t.charges[chargeIndex]?.sourceLocator,
    })
  }

  if (t.charges.length === 0) flag('empty_tariff', 'block', 'tariff has no charges')

  const energyAmounts = new Set(t.charges.filter((c) => c.component === 'energy').map((c) => c.amountExclVat))
  t.charges.forEach((c, i) => {
    if (!Number.isFinite(c.amountExclVat)) {
      flag('non_numeric', 'block', `amount is not a number: ${String(c.amountExclVat)}`, i)
      return
    }
    if ((c.component === 'energy' || c.component === 'export_credit') && unitClass(c.unit) === 'per_kwh' && c.amountExclVat !== 0) {
      const cents = roundCents(randPerKwh(c) * 100)
      if (cents < ENERGY_CENTS_RANGE.min || cents > ENERGY_CENTS_RANGE.max) {
        flag('energy_out_of_range', 'block', `${cents} c/kWh is outside ${ENERGY_CENTS_RANGE.min}-${ENERGY_CENTS_RANGE.max} c/kWh`, i)
      }
    }
    if ((c.component === 'basic' || c.component === 'service' || c.component === 'admin') && !FIXED_UNITS.has(c.unit)) {
      flag('fixed_unit', 'block', `${c.component} charge in ${c.unit}; fixed charges are R/month, R/day or R/POD/day`, i)
    }
    if ((c.component === 'basic' || c.component === 'service') && c.amountExclVat !== 0 && energyAmounts.has(c.amountExclVat)) {
      flag('duplicate_value', 'warn', `${c.component} ${c.amountExclVat} equals an energy rate in the same tariff: likely a copy error in the source`, i)
    }
    if (c.unitInferred && !c.reviewedAt) {
      flag('inferred_unit', 'review', `unit inferred (${c.inferenceReason ?? 'no reason recorded'}): needs review`, i)
    }
    if (c.sourceLocator.raw_incl !== undefined) {
      const expected = roundCents(c.amountExclVat * (1 + c.vatRate))
      if (Math.abs(expected - c.sourceLocator.raw_incl) > 0.02) {
        flag('vat_pair', 'block', `incl ${c.sourceLocator.raw_incl} does not equal excl ${c.amountExclVat} x ${1 + c.vatRate} = ${expected}`, i)
      }
    }
  })

  const touEnergy = t.charges.filter((c) => c.component === 'energy' && c.tou !== 'all')
  if (touEnergy.length > 0 || t.structure === 'tou' || t.structure === 'tou_ibt') {
    const have = new Set(touEnergy.map((c) => `${c.season}|${c.tou}`))
    const seasons: TariffSeason[] = touEnergy.length > 0 && touEnergy.every((c) => c.season === 'all') ? ['all'] : ['high', 'low']
    const missing = seasons.flatMap((s) => TOU_PERIODS.filter((p) => !have.has(`${s}|${p}`)).map((p) => `${s} ${p}`))
    if (missing.length > 0) flag('tou_incomplete', 'block', `TOU energy rates missing: ${missing.join(', ')}`)
  }

  const blocked = t.charges.filter((c) => c.component === 'energy' && c.blockMinKwh !== null)
  for (const s of new Set(blocked.map((c) => c.season))) {
    const bs = blocked.filter((c) => c.season === s).sort((a, b) => (a.blockMinKwh as number) - (b.blockMinKwh as number))
    const problems: string[] = []
    if (bs[0].blockMinKwh !== 0) problems.push(`first block starts at ${bs[0].blockMinKwh}`)
    for (let k = 1; k < bs.length; k++) {
      if (bs[k].blockMinKwh !== bs[k - 1].blockMaxKwh) problems.push(`${bs[k - 1].blockMaxKwh ?? 'unbounded'} then ${bs[k].blockMinKwh}`)
    }
    const top = bs[bs.length - 1]
    if (top.blockMaxKwh !== null) problems.push(`top block ends at ${top.blockMaxKwh}`)
    if (problems.length > 0) flag('ibt_gap', 'block', `inclining blocks (${s}) are not contiguous: ${problems.join('; ')}`)
  }
  return out
}

export function validateTariffYear(tariffs: readonly Tariff[]): TariffIssue[] {
  const out = tariffs.flatMap(validateTariff)
  const seen = new Map<string, string>()
  for (const t of tariffs) {
    const key = normaliseTariffName(t.name)
    const first = seen.get(key)
    if (first !== undefined) {
      out.push({ code: 'duplicate_name', severity: 'block', message: `"${t.name}" duplicates "${first}"`, tariff: t.name, locator: t.sourceLocator })
    } else {
      seen.set(key, t.name)
    }
  }
  return out
}

export function hasBlockingIssues(issues: readonly TariffIssue[]): boolean {
  return issues.some((i) => i.severity === 'block')
}
