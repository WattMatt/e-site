/**
 * Export / SSEG rule on the Tariff tab (spec §5). Eskom: the tariff's linked
 * Gen-offset export tariff. Municipal: the NERSA books publish no export
 * rates, so "No export credit (R0)" (default) or a manually entered rate with
 * a mandatory source note. The rate AND its source note are money: both are
 * stored in solar.study_export_rates, never in studies.export_rule (plan D2b-2;
 * the note moved there in 00219). validateExportRuleForm's rule carries the
 * note only in flight, to solar.save_export_rule, which strips it.
 */
import { makeCharge, makeTariff, type Tariff } from '../../tariffs/types'
import { ENERGY_RAND_RANGE, randPerKwh } from '../../tariffs/units'

export const EXPORT_METHODS = ['linked_tariff', 'none', 'manual'] as const
export type ExportMethod = (typeof EXPORT_METHODS)[number]

export const EXPORT_METHOD_LABELS: Record<ExportMethod, string> = {
  linked_tariff: 'Linked export tariff (published)',
  none: 'No export credit (R0)',
  manual: 'Enter export rate manually',
}

export interface ExportRule {
  version: 1
  method: ExportMethod
  sourceNote: string | null
}

export type ExportSeason = 'all' | 'high' | 'low'
export type ExportTou = 'all' | 'peak' | 'standard' | 'off_peak'

export interface ExportRateRow {
  season: ExportSeason
  tou: ExportTou
  unit: 'c_per_kWh' | 'R_per_kWh'
  amountExclVat: number
}

export interface ExportRuleForm {
  method: ExportMethod
  sourceNote: string
  rates: Array<{ season: ExportSeason; tou: ExportTou; unit: 'c_per_kWh' | 'R_per_kWh'; amount: string }>
}

/**
 * A STORED rule (solar.studies.export_rule). It never carries the source note: the note is money
 * and lives only on solar.study_export_rates.source_note (00219 refuses a sourceNote key on the
 * study row). A caller that may see money attaches it from the rate rows (loadTariffTab).
 */
export function parseExportRule(v: unknown): ExportRule | null {
  if (!v || typeof v !== 'object') return null
  const o = v as { method?: unknown }
  if (typeof o.method !== 'string' || !(EXPORT_METHODS as readonly string[]).includes(o.method)) return null
  return { version: 1, method: o.method as ExportMethod, sourceNote: null }
}

export function exportMethodsFor(hasLinkedExportTariff: boolean): ExportMethod[] {
  return hasLinkedExportTariff ? ['linked_tariff', 'none', 'manual'] : ['none', 'manual']
}

export function defaultExportRule(hasLinkedExportTariff: boolean): ExportRule {
  return { version: 1, method: hasLinkedExportTariff ? 'linked_tariff' : 'none', sourceNote: null }
}

/** The same ceiling ingestion uses for an energy rate (2a units.ts). */
const MAX_EXPORT_RAND_PER_KWH = ENERGY_RAND_RANGE.max

export function validateExportRuleForm(
  form: ExportRuleForm, hasLinkedExportTariff: boolean,
): { rule: ExportRule; rates: ExportRateRow[] } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  if (!(EXPORT_METHODS as readonly string[]).includes(form.method)) return { errors: { method: 'Choose how exported energy is credited' } }
  if (form.method === 'linked_tariff' && !hasLinkedExportTariff) return { errors: { method: 'This tariff has no linked export tariff' } }
  if (form.method !== 'manual') return { rule: { version: 1, method: form.method, sourceNote: null }, rates: [] }

  const note = form.sourceNote.trim()
  if (!note) errors.sourceNote = 'Say where this rate comes from (document and page)'
  else if (note.length > 500) errors.sourceNote = 'Keep the source note under 500 characters'
  if (form.rates.length === 0) errors.rates = 'Enter at least one export rate'
  const seen = new Set<string>()
  const rates: ExportRateRow[] = []
  form.rates.forEach((r, i) => {
    const key = `${r.season}|${r.tou}`
    if (seen.has(key)) {
      errors[`rates.${i}`] = 'This season and period already has a rate'
      return
    }
    seen.add(key)
    const s = String(r.amount ?? '').trim().replace(',', '.')
    const n = Number(s)
    if (s === '' || !Number.isFinite(n) || n < 0) {
      errors[`rates.${i}`] = 'Enter a rate of 0 or more'
      return
    }
    const rand = randPerKwh({ unit: r.unit, amountExclVat: n })
    if (rand > MAX_EXPORT_RAND_PER_KWH) {
      errors[`rates.${i}`] = `${r.unit === 'R_per_kWh' ? `R${n}/kWh` : `${n} c/kWh`} is not a plausible export rate (0 to ${MAX_EXPORT_RAND_PER_KWH} R/kWh)`
      return
    }
    rates.push({ season: r.season, tou: r.tou, unit: r.unit, amountExclVat: n })
  })
  if (Object.keys(errors).length > 0) return { errors }
  return { rule: { version: 1, method: 'manual', sourceNote: note }, rates }
}

/** The user-supplied rates as an export tariff for the bill engine (CostOptions.exportTariff). */
export function manualExportTariff(rates: readonly ExportRateRow[], sourceNote: string): Tariff {
  const tou = rates.some((r) => r.tou !== 'all')
  return makeTariff({
    name: 'Project export rate (user-supplied)',
    category: 'sseg',
    structure: tou ? 'tou' : 'flat',
    charges: rates.map((r) => makeCharge({
      component: 'export_credit', unit: r.unit, amountExclVat: r.amountExclVat, season: r.season, tou: r.tou,
      vatBasis: 'stated_excl', extractionMethod: 'manual', sourceLocator: { label: sourceNote },
    })),
  })
}
