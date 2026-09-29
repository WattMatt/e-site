/**
 * Financials inputs per case (functional spec §8) — stored in solar.case_financials.config, a MONEY
 * table (solar_can_see_money). ZAR excl. VAT throughout; VAT is shown, never compounded (D-16).
 */
import { z } from 'zod'
import type { SolarOrgSettingValues } from '../org-settings'

export const VAT_RATE = 0.15

export const CAPEX_CATEGORIES = [
  'modules', 'inverters', 'mounting', 'dc_bos', 'ac_bos', 'battery', 'grid_connection', 'civils',
  'labour', 'design_fees', 'project_management', 'contingency', 'margin',
] as const
export type CapexCategory = (typeof CAPEX_CATEGORIES)[number]
export const CAPEX_CATEGORY_LABELS: Record<CapexCategory, string> = {
  modules: 'Modules', inverters: 'Inverters', mounting: 'Mounting', dc_bos: 'DC BOS', ac_bos: 'AC BOS',
  battery: 'Battery', grid_connection: 'Grid connection / protection', civils: 'Civils', labour: 'Labour',
  design_fees: 'Design & professional fees', project_management: 'Project management',
  contingency: 'Contingency', margin: 'Margin',
}
export const CAPEX_UNITS = ['Wp', 'kWp', 'kW', 'kWh', 'item', 'lot', 'm'] as const

const num = (min: number, max: number) => z.number().finite().min(min).max(max)
const int = (min: number, max: number) => z.number().int().min(min).max(max)

export const CapexLineSchema = z.object({
  id: z.string().min(1).max(40),
  category: z.enum(CAPEX_CATEGORIES),
  description: z.string().max(200),
  qty: num(0, 1e9),
  unit: z.enum(CAPEX_UNITS),
  rateZar: num(0, 1e10),
  qualifies12b: z.boolean(),
  source: z.enum(['manual', 'rate_card', 'layout_bom']),
}).strict()
export type CapexLine = z.infer<typeof CapexLineSchema>

export const CaseFinanceConfigSchema = z.object({
  version: z.literal(1),
  capex: z.array(CapexLineSchema).max(200),
  opex: z.object({
    omMode: z.enum(['per_kwp', 'pct_capex']),
    omZarPerKwpYear: num(0, 1e6),
    omPctOfCapex: num(0, 20),
    insurancePctOfCapex: num(0, 10),
    monitoringZarPerYear: num(0, 1e8),
    inverterReplacementYear: int(1, 40).nullable(),
    // A share of that equipment's capex: the engine takes a fraction ≤ 1.
    inverterReplacementPct: num(0, 100),
    batteryReplacementYear: int(1, 40).nullable(),
    batteryReplacementPct: num(0, 100),
  }).strict(),
  models: z.object({
    cash: z.object({ enabled: z.boolean() }).strict(),
    debt: z.object({ enabled: z.boolean(), loanPct: num(0, 100), ratePct: num(0, 50), termYears: int(1, 30), graceMonths: int(0, 60) }).strict(),
    ppa: z.object({
      enabled: z.boolean(), startTariffZarPerKwh: num(0, 100), escalationPct: num(-10, 50), termYears: int(1, 40),
      buyoutYear: int(1, 40).nullable(), buyoutPriceZar: num(0, 1e10).nullable(),
    }).strict(),
    lease: z.object({ enabled: z.boolean(), monthlyPaymentZar: num(0, 1e9), escalationPct: num(-10, 50), termYears: int(1, 40), residualZar: num(0, 1e10) }).strict(),
  }).strict(),
  analysis: z.object({
    years: int(1, 40), discountRatePct: num(0, 50), cpiPct: num(0, 30),
    escalationStartPct: num(0, 50), escalationYear10Pct: num(0, 50), escalationAfterCpiPlusPct: num(-5, 20),
    loadGrowthPct: num(-20, 20), taxEnabled: z.boolean(), companyTaxRatePct: num(0, 60), section12b: z.boolean(),
  }).strict(),
  loadShedding: z.object({ valueZarPerKwh: num(0, 1000).nullable() }).strict(),
}).strict().superRefine((f, ctx) => {
  const m = f.models
  if (!m.cash.enabled && !m.debt.enabled && !m.ppa.enabled && !m.lease.enabled) {
    ctx.addIssue({ code: 'custom', path: ['models'], message: 'Choose at least one finance model' })
  }
  if ((m.ppa.buyoutYear === null) !== (m.ppa.buyoutPriceZar === null)) {
    ctx.addIssue({ code: 'custom', path: ['models', 'ppa', 'buyoutPriceZar'], message: 'Enter both the buy-out year and price, or neither' })
  }
  // Mirrors the engine's rule (cashflow.ts validate): otherwise Run financials fails on a saved config.
  if (m.ppa.enabled && m.ppa.buyoutYear !== null && m.ppa.buyoutYear > m.ppa.termYears) {
    ctx.addIssue({ code: 'custom', path: ['models', 'ppa', 'buyoutYear'], message: `The buy-out year must fall within the PPA term (${m.ppa.termYears} years)` })
  }
})
export type CaseFinanceConfig = z.infer<typeof CaseFinanceConfigSchema>

export function parseFinanceConfig(raw: unknown): { ok: true; fin: CaseFinanceConfig } | { ok: false; errors: Record<string, string> } {
  const r = CaseFinanceConfigSchema.safeParse(raw)
  if (r.success) return { ok: true, fin: r.data }
  const errors: Record<string, string> = {}
  for (const i of r.error.issues) {
    const k = i.path.join('.') || '(root)'
    if (!errors[k]) errors[k] = i.message
  }
  return { ok: false, errors }
}

function setting(s: SolarOrgSettingValues, key: string, fallback: number): number {
  const v = s[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

export function defaultFinanceConfig(s: SolarOrgSettingValues): CaseFinanceConfig {
  const cpi = setting(s, 'cpi_pct', 5)
  return {
    version: 1,
    capex: [],
    opex: {
      omMode: 'per_kwp',
      omZarPerKwpYear: setting(s, 'om_r_per_kwp_yr', 150),
      omPctOfCapex: 0,
      insurancePctOfCapex: setting(s, 'insurance_pct_of_capex', 0.5),
      monitoringZarPerYear: setting(s, 'monitoring_r_per_yr', 0),
      inverterReplacementYear: setting(s, 'inverter_replacement_year', 12),
      inverterReplacementPct: setting(s, 'inverter_replacement_pct', 60),
      batteryReplacementYear: setting(s, 'battery_replacement_year', 10),
      batteryReplacementPct: setting(s, 'battery_replacement_pct', 50),
    },
    models: {
      cash: { enabled: true },
      debt: { enabled: false, loanPct: 0, ratePct: 0, termYears: 10, graceMonths: 0 },
      ppa: { enabled: false, startTariffZarPerKwh: 0, escalationPct: cpi, termYears: 20, buyoutYear: null, buyoutPriceZar: null },
      lease: { enabled: false, monthlyPaymentZar: 0, escalationPct: cpi, termYears: 10, residualZar: 0 },
    },
    analysis: {
      years: setting(s, 'analysis_years', 25),
      discountRatePct: setting(s, 'discount_rate_pct', 11),
      cpiPct: cpi,
      escalationStartPct: setting(s, 'escalation_start_pct', 9),
      escalationYear10Pct: setting(s, 'escalation_year10_pct', 7),
      escalationAfterCpiPlusPct: setting(s, 'escalation_after_cpi_plus_pct', 1),
      loadGrowthPct: 0,
      taxEnabled: false,
      companyTaxRatePct: setting(s, 'tax_rate_pct', 27),
      section12b: s.section_12b_default === true,
    },
    loadShedding: { valueZarPerKwh: null },
  }
}

export interface CapexTotals {
  exclVatZar: number
  vatZar: number
  inclVatZar: number
  /** capex ÷ DC Wp — the correct scale (WM showed R/kWp as R/Wp). */
  zarPerWp: number | null
  inverterZar: number
  batteryZar: number
  qualifying12bZar: number
  byCategory: Partial<Record<CapexCategory, number>>
}

export const lineAmount = (l: CapexLine): number => l.qty * l.rateZar

export function capexTotals(lines: readonly CapexLine[], dcKwp: number): CapexTotals {
  let excl = 0, inv = 0, bat = 0, q12b = 0
  const byCategory: Partial<Record<CapexCategory, number>> = {}
  for (const l of lines) {
    const a = lineAmount(l)
    excl += a
    byCategory[l.category] = (byCategory[l.category] ?? 0) + a
    if (l.category === 'inverters') inv += a
    if (l.category === 'battery') bat += a
    if (l.qualifies12b) q12b += a
  }
  return {
    exclVatZar: excl, vatZar: excl * VAT_RATE, inclVatZar: excl * (1 + VAT_RATE),
    zarPerWp: dcKwp > 0 ? excl / (dcKwp * 1000) : null,
    inverterZar: inv, batteryZar: bat, qualifying12bZar: q12b, byCategory,
  }
}

const BANDS = [
  { key: 'rc_pv_r_per_wp_small', maxKwp: 100, label: 'PV system, up to 100 kWp (R/Wp)' },
  { key: 'rc_pv_r_per_wp_medium', maxKwp: 1000, label: 'PV system, 100 kWp to 1 MWp (R/Wp)' },
  { key: 'rc_pv_r_per_wp_large', maxKwp: Number.POSITIVE_INFINITY, label: 'PV system, above 1 MWp (R/Wp)' },
] as const

const cents = (x: number) => Math.round(x * 100) / 100
const rate = (s: SolarOrgSettingValues, k: string): number | null => {
  const v = s[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * "Apply org rate card" (spec §8): replaces the lines it made last time (source 'rate_card') and
 * keeps every other line. A missing required rate is NAMED, never substituted.
 */
export function applyRateCard(
  fin: CaseFinanceConfig,
  s: SolarOrgSettingValues,
  size: { dcKwp: number; acKw: number; batteryKwh: number },
): { ok: true; fin: CaseFinanceConfig } | { ok: false; missing: string[] } {
  const band = BANDS.find((b) => size.dcKwp <= b.maxKwp)!
  const missing: string[] = []
  const pv = rate(s, band.key)
  if (pv === null) missing.push(band.label)
  const bat = rate(s, 'rc_battery_r_per_kwh')
  if (size.batteryKwh > 0 && bat === null) missing.push('Battery (R/kWh)')
  if (missing.length > 0) return { ok: false, missing }

  const mk = (id: string, category: CapexCategory, description: string, qty: number, unit: CapexLine['unit'], rateZar: number, qualifies12b = true): CapexLine =>
    ({ id, category, description, qty, unit, rateZar: cents(rateZar), qualifies12b, source: 'rate_card' })
  const lines: CapexLine[] = [mk('rc-pv', 'modules', 'PV system (rate card)', size.dcKwp * 1000, 'Wp', pv!)]
  const inv = rate(s, 'rc_inverter_r_per_kw')
  if (inv !== null) lines.push(mk('rc-inv', 'inverters', 'Inverters (rate card)', size.acKw, 'kW', inv))
  if (size.batteryKwh > 0) lines.push(mk('rc-bat', 'battery', 'Battery (rate card)', size.batteryKwh, 'kWh', bat!, false))
  const equipment = lines.reduce((a, l) => a + l.qty * l.rateZar, 0)
  const bos = rate(s, 'rc_bos_pct')
  if (bos !== null) lines.push(mk('rc-bos', 'dc_bos', `Balance of system (${bos} % of equipment)`, 1, 'lot', equipment * bos / 100))
  const sub = equipment + (bos !== null ? cents(equipment * bos / 100) : 0)
  const pct: Array<[string, CapexCategory, string, string]> = [
    ['rc-fees', 'design_fees', 'rc_fees_pct', 'Design & professional fees'],
    ['rc-pm', 'project_management', 'rc_pm_pct', 'Project management'],
    ['rc-cont', 'contingency', 'rc_contingency_pct', 'Contingency'],
    ['rc-margin', 'margin', 'rc_margin_pct', 'Margin'],
  ]
  for (const [id, cat, key, label] of pct) {
    const p = rate(s, key)
    if (p !== null) lines.push(mk(id, cat, `${label} (${p} % of subtotal)`, 1, 'lot', sub * p / 100))
  }
  return { ok: true, fin: { ...fin, capex: [...fin.capex.filter((l) => l.source !== 'rate_card'), ...lines] } }
}
