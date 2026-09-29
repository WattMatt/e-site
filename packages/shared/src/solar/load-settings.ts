/**
 * Load tab settings (functional spec §4.2, §4.5): the basis select, reference year, load growth,
 * diversity, common-area allowance, and the twelve monthly bills that basis S4 is built from.
 * Shared by the form (client) and the action (server) so both give the same sentences.
 */
import { ARCHETYPE_CODES, type ArchetypeCode } from '../services/solar/load/archetypes'

export type LoadBasisChoice = 'S1' | 'S2' | 'S4'
export const LOAD_BASIS_OPTIONS: ReadonlyArray<{ value: LoadBasisChoice; label: string }> = [
  { value: 'S1', label: 'Bulk meter (S1)' },
  { value: 'S2', label: 'Sum of tenants (S2 + S3 for unmetered tenants)' },
  { value: 'S4', label: 'Monthly bills (S4)' },
]
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const

export interface LoadSettingsForm {
  loadBasis: LoadBasisChoice | ''
  referenceYear: string
  loadGrowthPct: string
  diversityFactor: string
  commonAreaPct: string
}
export interface BillsForm { archetype: ArchetypeCode; powerFactor: string; months: Array<{ kwh: string; kva: string }> }
export const EMPTY_BILLS_FORM: BillsForm = {
  archetype: 'retail',
  powerFactor: '0.95',
  months: Array.from({ length: 12 }, () => ({ kwh: '', kva: '' })),
}
export type LoadSettingsField = keyof LoadSettingsForm | 'bills'
export interface StoredBills { archetype: ArchetypeCode; powerFactor: number; months: Array<{ kwh: number; kva: number | null }> }
/**
 * What a settings save writes. Deliberately NOT load_basis (owned by the Load basis bar) nor
 * common_area_pct (owned by the Tenants tab): the settings form holds its own copy of both, and
 * writing them from that copy would silently undo the control that owns them. `form.loadBasis`
 * is still read — it decides whether the twelve bills are required — and the server sets it from
 * the SAVED row, never from the client.
 */
export interface LoadSettingsValues {
  reference_year: number | null
  load_growth_pct: number
  diversity_factor: number
  monthly_bills: StoredBills | null
}

const num = (s: string): number | null => {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(Number(v)))

export function loadSettingsFormFromRow(row: Record<string, unknown> | null | undefined): { form: LoadSettingsForm; bills: BillsForm } {
  const r = row ?? {}
  const b = r.monthly_bills as StoredBills | null | undefined
  const basis = r.load_basis === 'S3' ? 'S2' : (r.load_basis as LoadBasisChoice | null | undefined)
  return {
    form: {
      loadBasis: basis ?? '',
      referenceYear: r.reference_year == null ? '' : String(r.reference_year),
      loadGrowthPct: r.load_growth_pct == null ? '' : str(r.load_growth_pct),
      diversityFactor: r.diversity_factor == null ? '' : str(r.diversity_factor),
      commonAreaPct: r.common_area_pct == null ? '' : str(r.common_area_pct),
    },
    bills: b && Array.isArray(b.months) && b.months.length === 12
      ? {
          archetype: (ARCHETYPE_CODES as readonly string[]).includes(b.archetype) ? b.archetype : 'retail',
          powerFactor: String(b.powerFactor ?? 0.95),
          months: b.months.map((m) => ({ kwh: m.kwh == null ? '' : String(m.kwh), kva: m.kva == null ? '' : String(m.kva) })),
        }
      : EMPTY_BILLS_FORM,
  }
}

export function validateLoadSettings(form: LoadSettingsForm, bills: BillsForm): { values: LoadSettingsValues; errors: Partial<Record<LoadSettingsField, string>> } {
  const errors: Partial<Record<LoadSettingsField, string>> = {}
  const year = num(form.referenceYear)
  if (year !== null && (!Number.isInteger(year) || year < 2000 || year > 2100)) errors.referenceYear = 'Reference year must be between 2000 and 2100'
  const growth = num(form.loadGrowthPct) ?? 0
  if (!(growth >= -20 && growth <= 20)) errors.loadGrowthPct = 'Load growth must be between -20 and 20 %/yr'
  const div = num(form.diversityFactor) ?? 1
  if (!(div >= 0.5 && div <= 1)) errors.diversityFactor = 'Diversity factor must be between 0.5 and 1.0'

  let monthly: StoredBills | null = null
  const anyBill = bills.months.some((m) => m.kwh.trim() !== '' || m.kva.trim() !== '')
  if (form.loadBasis === 'S4' || anyBill) {
    const bad: string[] = []
    const months = bills.months.map((m, i) => {
      const kwh = num(m.kwh)
      const kva = num(m.kva)
      if (kwh === null || !(kwh > 0)) bad.push(MONTH_NAMES[i])
      else if (kva !== null && !(kva > 0)) bad.push(`${MONTH_NAMES[i]} (kVA)`)
      return { kwh: kwh ?? 0, kva: kva === null || Number.isNaN(kva) ? null : kva }
    })
    const pf = num(bills.powerFactor) ?? 0.95
    if (bad.length > 0) errors.bills = `Enter a positive kWh for every month (and a positive kVA or leave it blank): ${bad.join(', ')}`
    else if (!(pf >= 0.5 && pf <= 1)) errors.bills = 'Power factor must be between 0.5 and 1.0'
    else if (!(ARCHETYPE_CODES as readonly string[]).includes(bills.archetype)) errors.bills = 'Choose a daily shape for the bills'
    else monthly = { archetype: bills.archetype, powerFactor: pf, months }
  }
  return {
    values: {
      reference_year: year === null || Number.isNaN(year) ? null : year,
      load_growth_pct: growth,
      diversity_factor: div,
      monthly_bills: monthly,
    },
    errors,
  }
}
