/**
 * Tariff escalation path (spec §5 "Escalation path"; D-07). Year n -> %
 * for n = 2..analysis years (year 1 is the pinned tariff itself). Defaults
 * come from Phase 4a's escalationRate so the table and the cashflow are the
 * same function. Precedence per row: user override -> approved increase of
 * the next consecutive published financial year(s) -> org default path.
 */
import { DEFAULT_ESCALATION, escalationRate, type EscalationPath } from '../../services/solar/finance/factors'
import { parseFinancialYear } from '../../tariffs/financial-year'
import { solarOrgSettingDefaults } from '../org-settings'
import { financialYearLabel } from './financial-years'

export interface EscalationSettings {
  cpiPct: number
  startPct: number
  year10Pct: number
  afterCpiPlusPct: number
  analysisYears: number
}

export interface StoredEscalation {
  version: 1
  overrides: Record<string, number>
}

export type EscalationSource = 'published' | 'default' | 'override'

export interface EscalationRow {
  year: number
  pct: number
  source: EscalationSource
  /** The financial year whose approved increase this is (published rows). */
  financialYear: string | null
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000

/**
 * From readSolarOrgSettings() values (1c). A missing value falls back to the
 * org-settings default (SOLAR_SETTING_FIELDS, D-07) so there is one default.
 */
export function escalationSettingsFrom(values: Record<string, number | boolean | null | undefined>): EscalationSettings {
  const defaults = solarOrgSettingDefaults()
  const n = (k: string, d: number): number => {
    const v = values[k]
    if (typeof v === 'number') return v
    const dv = defaults[k]
    return typeof dv === 'number' ? dv : d
  }
  return {
    cpiPct: n('cpi_pct', 5),
    startPct: n('escalation_start_pct', 9),
    year10Pct: n('escalation_year10_pct', 7),
    afterCpiPlusPct: n('escalation_after_cpi_plus_pct', 1),
    analysisYears: n('analysis_years', 25),
  }
}

export function parseStoredEscalation(v: unknown): StoredEscalation | null {
  if (!v || typeof v !== 'object') return null
  const o = (v as { overrides?: unknown }).overrides
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const overrides: Record<string, number> = {}
  for (const [k, x] of Object.entries(o as Record<string, unknown>)) {
    if (/^\d+$/.test(k) && typeof x === 'number' && Number.isFinite(x)) overrides[k] = x
  }
  return { version: 1, overrides }
}

function nextFinancialYear(fy: string): string {
  return financialYearLabel(parseFinancialYear(fy).startYear + 1)
}

function defaultPath(s: EscalationSettings): EscalationPath {
  return {
    published: [],
    startRate: s.startPct / 100,
    endRate: s.year10Pct / 100,
    linearToYear: DEFAULT_ESCALATION.linearToYear,
    cpiMargin: s.afterCpiPlusPct / 100,
  }
}

export function buildEscalationRows(input: {
  pinnedFinancialYear: string | null
  published: ReadonlyArray<{ financialYear: string; approvedIncreasePct: number | null }>
  settings: EscalationSettings
  stored: StoredEscalation | null
}): EscalationRow[] {
  const approved: Array<{ fy: string; pct: number }> = []
  if (input.pinnedFinancialYear) {
    const byFy = new Map(input.published.map((p) => [p.financialYear, p.approvedIncreasePct]))
    let fy = input.pinnedFinancialYear
    for (;;) {
      fy = nextFinancialYear(fy)
      const pct = byFy.get(fy)
      if (pct === undefined || pct === null) break
      approved.push({ fy, pct })
    }
  }
  const s = input.settings
  const path = defaultPath(s)
  const rows: EscalationRow[] = []
  for (let n = 2; n <= s.analysisYears; n++) {
    const o = input.stored?.overrides[String(n)]
    const pub = approved[n - 2]
    if (o !== undefined) rows.push({ year: n, pct: round3(o), source: 'override', financialYear: pub?.fy ?? null })
    else if (pub) rows.push({ year: n, pct: round3(pub.pct), source: 'published', financialYear: pub.fy })
    else rows.push({ year: n, pct: round3(escalationRate(n, path, s.cpiPct / 100) * 100), source: 'default', financialYear: null })
  }
  return rows
}

/** The engine's EscalationPath carrying the table verbatim (every year explicit). */
export function escalationPathFromRows(rows: readonly EscalationRow[], s: EscalationSettings): EscalationPath {
  return { ...defaultPath(s), published: [...rows].sort((a, b) => a.year - b.year).map((r) => r.pct / 100) }
}

export function validateEscalationOverrides(
  form: Record<string, string>, analysisYears: number,
): { overrides: Record<string, number>; errors: Record<string, string> } {
  const overrides: Record<string, number> = {}
  const errors: Record<string, string> = {}
  for (const [k, raw] of Object.entries(form)) {
    const s = String(raw ?? '').trim().replace(',', '.')
    const n = Number(k)
    if (!/^\d+$/.test(k) || n < 2 || n > analysisYears) {
      errors[k] = `Year ${k} is outside the ${analysisYears}-year analysis`
      continue
    }
    if (s === '') continue
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) {
      errors[k] = 'Enter a percentage'
      continue
    }
    const v = Number(s)
    if (v < -50 || v > 100) {
      errors[k] = 'Must be between -50 and 100 %'
      continue
    }
    overrides[k] = v
  }
  return { overrides, errors }
}
