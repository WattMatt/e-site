/**
 * Solar org defaults (spec §11) — the skeleton: Finance, Opex and Loss
 * defaults, seeded with the decided values (D-05 insurance, D-07 finance/O&M,
 * D-16 12B off; engine spec defaults table for losses and replacements).
 * Stored in solar.org_settings.settings as { version, values } (00208). A
 * case copies these at creation, so later edits never alter past results.
 * Rate card, load densities, equipment catalogue and report branding arrive
 * with the phases that use them.
 */
export type SolarSettingSection = 'rate_card' | 'finance' | 'opex' | 'losses'

export interface SolarSettingField {
  key: string
  section: SolarSettingSection
  label: string
  unit: string
  kind: 'number' | 'boolean'
  min?: number
  max?: number
  defaultValue: number | boolean | null
  /** Decision reference shown as a hint. */
  source?: string
}

export const SOLAR_ORG_SETTINGS_VERSION = 1

export const SOLAR_SETTING_SECTIONS: ReadonlyArray<{ key: SolarSettingSection; title: string }> = [
  { key: 'rate_card', title: 'Rate card' },
  { key: 'finance', title: 'Finance defaults' },
  { key: 'opex', title: 'Opex defaults' },
  { key: 'losses', title: 'Loss defaults' },
]

export const SOLAR_SETTING_FIELDS: readonly SolarSettingField[] = [
  { key: 'rc_pv_r_per_wp_small', section: 'rate_card', label: 'PV system, up to 100 kWp', unit: 'R/Wp', kind: 'number', min: 0, max: 100, defaultValue: null },
  { key: 'rc_pv_r_per_wp_medium', section: 'rate_card', label: 'PV system, 100 kWp to 1 MWp', unit: 'R/Wp', kind: 'number', min: 0, max: 100, defaultValue: null },
  { key: 'rc_pv_r_per_wp_large', section: 'rate_card', label: 'PV system, above 1 MWp', unit: 'R/Wp', kind: 'number', min: 0, max: 100, defaultValue: null },
  { key: 'rc_inverter_r_per_kw', section: 'rate_card', label: 'Inverter', unit: 'R/kW', kind: 'number', min: 0, max: 100_000, defaultValue: null },
  { key: 'rc_battery_r_per_kwh', section: 'rate_card', label: 'Battery', unit: 'R/kWh', kind: 'number', min: 0, max: 100_000, defaultValue: null },
  { key: 'rc_bos_pct', section: 'rate_card', label: 'Balance of system (of equipment)', unit: '%', kind: 'number', min: 0, max: 100, defaultValue: null },
  { key: 'rc_fees_pct', section: 'rate_card', label: 'Design & professional fees', unit: '%', kind: 'number', min: 0, max: 50, defaultValue: null },
  { key: 'rc_pm_pct', section: 'rate_card', label: 'Project management', unit: '%', kind: 'number', min: 0, max: 50, defaultValue: null },
  { key: 'rc_contingency_pct', section: 'rate_card', label: 'Contingency', unit: '%', kind: 'number', min: 0, max: 50, defaultValue: null },
  { key: 'rc_margin_pct', section: 'rate_card', label: 'Margin', unit: '%', kind: 'number', min: 0, max: 100, defaultValue: null },
  { key: 'discount_rate_pct', section: 'finance', label: 'Discount rate', unit: '%', kind: 'number', min: 0, max: 50, defaultValue: 11, source: 'D-07' },
  { key: 'cpi_pct', section: 'finance', label: 'CPI', unit: '%', kind: 'number', min: 0, max: 30, defaultValue: 5, source: 'D-07' },
  { key: 'escalation_start_pct', section: 'finance', label: 'Tariff escalation beyond published years (year 1)', unit: '%', kind: 'number', min: 0, max: 50, defaultValue: 9, source: 'D-07' },
  { key: 'escalation_year10_pct', section: 'finance', label: 'Tariff escalation at year 10 (linear from year 1)', unit: '%', kind: 'number', min: 0, max: 50, defaultValue: 7, source: 'D-07' },
  { key: 'escalation_after_cpi_plus_pct', section: 'finance', label: 'Tariff escalation after year 10 (CPI plus)', unit: '%', kind: 'number', min: -5, max: 20, defaultValue: 1, source: 'D-07' },
  { key: 'analysis_years', section: 'finance', label: 'Analysis period', unit: 'years', kind: 'number', min: 1, max: 40, defaultValue: 25, source: 'D-07' },
  // Owner default 5 (2026-09-28): 27 % — the South African company income tax rate.
  { key: 'tax_rate_pct', section: 'finance', label: 'Company tax rate', unit: '%', kind: 'number', min: 0, max: 60, defaultValue: 27 },
  { key: 'section_12b_default', section: 'finance', label: 'Section 12B allowance on by default', unit: '', kind: 'boolean', defaultValue: false, source: 'D-16' },
  { key: 'om_r_per_kwp_yr', section: 'opex', label: 'O&M', unit: 'R/kWp/yr', kind: 'number', min: 0, max: 10000, defaultValue: 150, source: 'D-07' },
  { key: 'insurance_pct_of_capex', section: 'opex', label: 'Insurance (annual, of capex)', unit: '%', kind: 'number', min: 0, max: 10, defaultValue: 0.5, source: 'D-05' },
  { key: 'monitoring_r_per_yr', section: 'opex', label: 'Monitoring', unit: 'R/yr', kind: 'number', min: 0, max: 10_000_000, defaultValue: null },
  { key: 'inverter_replacement_year', section: 'opex', label: 'Inverter replacement year', unit: 'year', kind: 'number', min: 1, max: 40, defaultValue: 12 },
  { key: 'inverter_replacement_pct', section: 'opex', label: 'Inverter replacement cost (of inverter capex)', unit: '%', kind: 'number', min: 0, max: 200, defaultValue: 60 },
  { key: 'battery_replacement_year', section: 'opex', label: 'Battery replacement year', unit: 'year', kind: 'number', min: 1, max: 40, defaultValue: 10 },
  { key: 'battery_replacement_pct', section: 'opex', label: 'Battery replacement cost (of battery capex)', unit: '%', kind: 'number', min: 0, max: 200, defaultValue: 50 },
  { key: 'soiling_pct', section: 'losses', label: 'Soiling', unit: '%', kind: 'number', min: 0, max: 50, defaultValue: 2 },
  { key: 'mismatch_pct', section: 'losses', label: 'Mismatch', unit: '%', kind: 'number', min: 0, max: 20, defaultValue: 1 },
  { key: 'dc_wiring_pct', section: 'losses', label: 'DC wiring', unit: '%', kind: 'number', min: 0, max: 20, defaultValue: 1.5 },
  { key: 'ac_wiring_pct', section: 'losses', label: 'AC wiring', unit: '%', kind: 'number', min: 0, max: 20, defaultValue: 1 },
  { key: 'lid_pct', section: 'losses', label: 'LID / LeTID', unit: '%', kind: 'number', min: 0, max: 20, defaultValue: 1.5 },
  { key: 'availability_pct', section: 'losses', label: 'Availability', unit: '%', kind: 'number', min: 50, max: 100, defaultValue: 99 },
  { key: 'albedo', section: 'losses', label: 'Albedo', unit: '', kind: 'number', min: 0, max: 1, defaultValue: 0.2 },
  { key: 'degradation_first_year_pct', section: 'losses', label: 'First-year degradation', unit: '%', kind: 'number', min: 0, max: 20, defaultValue: 2 },
  { key: 'degradation_annual_pct', section: 'losses', label: 'Annual degradation', unit: '%/yr', kind: 'number', min: 0, max: 5, defaultValue: 0.5 },
  { key: 'edge_setback_flat_m', section: 'losses', label: 'Edge setback, flat roof', unit: 'm', kind: 'number', min: 0, max: 20, defaultValue: 0.5, source: 'engine spec §3.1' },
  { key: 'edge_setback_pitched_m', section: 'losses', label: 'Edge setback, pitched roof', unit: 'm', kind: 'number', min: 0, max: 20, defaultValue: 0.3, source: 'engine spec §3.1' },
  { key: 'row_spacing_shade_free_from_hour', section: 'losses', label: 'Row spacing: no inter-row shade on 21 June from', unit: 'h', kind: 'number', min: 6, max: 12, defaultValue: 9, source: 'D-11' },
  { key: 'row_spacing_shade_free_to_hour', section: 'losses', label: 'Row spacing: no inter-row shade on 21 June until', unit: 'h', kind: 'number', min: 12, max: 18, defaultValue: 15, source: 'D-11' },
]

export type SolarOrgSettingValues = Record<string, number | boolean | null>
export type SolarOrgSettingForm = Record<string, string | boolean>

const BY_KEY = new Map(SOLAR_SETTING_FIELDS.map((f) => [f.key, f]))
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)$/

export function solarOrgSettingDefaults(): SolarOrgSettingValues {
  return Object.fromEntries(SOLAR_SETTING_FIELDS.map((f) => [f.key, f.defaultValue]))
}

/** Stored JSON (or null) → values; anything of the wrong type falls back to the default. */
export function readSolarOrgSettings(stored: unknown): SolarOrgSettingValues {
  const out = solarOrgSettingDefaults()
  const values = (stored && typeof stored === 'object' ? (stored as { values?: unknown }).values : null) as Record<string, unknown> | null
  if (!values || typeof values !== 'object') return out
  for (const f of SOLAR_SETTING_FIELDS) {
    const v = values[f.key]
    if (f.kind === 'boolean' && typeof v === 'boolean') out[f.key] = v
    if (f.kind === 'number' && (v === null || (typeof v === 'number' && Number.isFinite(v)))) out[f.key] = v
  }
  return out
}

export function solarSettingsToForm(values: SolarOrgSettingValues): SolarOrgSettingForm {
  return Object.fromEntries(SOLAR_SETTING_FIELDS.map((f) => {
    const v = values[f.key]
    if (f.kind === 'boolean') return [f.key, v === true]
    return [f.key, typeof v === 'number' ? String(v) : '']
  }))
}

export function validateSolarOrgSettings(form: SolarOrgSettingForm): { values: SolarOrgSettingValues; errors: Record<string, string> } {
  const values: SolarOrgSettingValues = {}
  const errors: Record<string, string> = {}
  for (const key of Object.keys(form)) {
    if (!BY_KEY.has(key)) errors[key] = 'Unknown setting'
  }
  for (const f of SOLAR_SETTING_FIELDS) {
    const raw = form[f.key]
    if (f.kind === 'boolean') { values[f.key] = raw === true; continue }
    const s = String(raw ?? '').trim().replace(',', '.')
    if (s === '') { values[f.key] = null; continue }
    if (!NUMBER.test(s)) { errors[f.key] = 'Enter a number'; continue }
    const n = Number(s)
    if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) {
      errors[f.key] = `Must be between ${f.min} and ${f.max} ${f.unit}`.trim()
      continue
    }
    values[f.key] = n
  }
  const from = values.row_spacing_shade_free_from_hour
  const to = values.row_spacing_shade_free_to_hour
  if (typeof from === 'number' && typeof to === 'number' && to <= from && !errors.row_spacing_shade_free_to_hour) {
    errors.row_spacing_shade_free_to_hour = 'Must be later than the start hour'
  }
  return { values, errors }
}
