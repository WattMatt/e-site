/**
 * Project tariff override rows (spec §5 "Create project override", D-10
 * landlord resale). A copy of the pinned tariff's charges; an edited row
 * carries a reason (enforced again in SQL by 00213).
 *
 * Plausibility is "the same ranges as ingestion": 2a's unitCompatible and
 * 2a's validateTariff codes energy_out_of_range / fixed_unit / non_numeric.
 * The row mapper is local rather than 2a's chargeFromRow because that lives
 * in the service-role supabase-store module (never for a client bundle) and
 * an override row carries id/reason/edited_* fields a Charge does not.
 */
import { unitCompatible } from '../../tariffs/parsers/normalise'
import {
  TARIFF_UNITS, makeCharge, makeTariff,
  type BlockBasis, type ChargeComponent, type ChargeDayType, type DemandBasis, type SourceLocator, type Tariff,
  type TariffSeason, type TariffUnit, type TouOrAll, type VatBasis,
} from '../../tariffs/types'
import { validateTariff } from '../../tariffs/validators'
import { COMPONENT_LABELS, UNIT_LABELS } from './labels'

export interface OverrideChargeRow {
  id: string
  baseChargeId: string | null
  component: ChargeComponent
  season: TariffSeason
  tou: TouOrAll
  dayType: ChargeDayType
  blockMinKwh: number | null
  blockMaxKwh: number | null
  blockBasis: BlockBasis | null
  unit: TariffUnit
  demandBasis: DemandBasis | null
  amountExclVat: number
  vatRate: number
  vatBasis: VatBasis
  sourceLocator: SourceLocator & { source_document_id?: string }
  reason: string | null
  editedAt: string | null
  editedBy: string | null
  updatedAt: string
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

export function overrideChargeFromDb(r: Record<string, unknown>): OverrideChargeRow {
  return {
    id: String(r.id),
    baseChargeId: (r.base_charge_id ?? null) as string | null,
    component: r.component as ChargeComponent,
    season: r.season as TariffSeason,
    tou: r.tou as TouOrAll,
    dayType: r.day_type as ChargeDayType,
    blockMinKwh: num(r.block_min_kwh),
    blockMaxKwh: num(r.block_max_kwh),
    blockBasis: (r.block_basis ?? null) as BlockBasis | null,
    unit: r.unit as TariffUnit,
    demandBasis: (r.demand_basis ?? null) as DemandBasis | null,
    amountExclVat: Number(r.amount_excl_vat),
    vatRate: Number(r.vat_rate ?? 0.15),
    vatBasis: r.vat_basis as VatBasis,
    sourceLocator: (r.source_locator ?? {}) as OverrideChargeRow['sourceLocator'],
    reason: (r.reason ?? null) as string | null,
    editedAt: (r.edited_at ?? null) as string | null,
    editedBy: (r.edited_by ?? null) as string | null,
    updatedAt: String(r.updated_at ?? ''),
  }
}

export function overrideToTariff(base: Tariff, rows: readonly OverrideChargeRow[]): Tariff {
  return {
    ...base,
    charges: rows.map((r) => makeCharge({
      component: r.component, season: r.season, tou: r.tou, dayType: r.dayType,
      blockMinKwh: r.blockMinKwh, blockMaxKwh: r.blockMaxKwh, blockBasis: r.blockBasis,
      unit: r.unit, demandBasis: r.demandBasis, amountExclVat: r.amountExclVat, vatRate: r.vatRate, vatBasis: r.vatBasis,
      extractionMethod: 'manual', sourceLocator: r.sourceLocator,
    })),
  }
}

export interface OverrideEditForm {
  amount: string
  unit: TariffUnit | ''
  reason: string
}

const PLAUSIBILITY_CODES = new Set(['energy_out_of_range', 'fixed_unit', 'non_numeric'])

/**
 * Amount + unit of one charge, with the ingestion plausibility rules. Shared
 * by the project override editor and the library review queue's Edit.
 */
export function validateRateEdit(
  row: { component: ChargeComponent; season: TariffSeason },
  form: { amount: string; unit: TariffUnit | '' },
): { amountExclVat: number; unit: TariffUnit } | { errors: Partial<Record<'amount' | 'unit', string>> } {
  const errors: Partial<Record<'amount' | 'unit', string>> = {}
  const s = String(form.amount ?? '').trim().replace(',', '.')
  const amount = Number(s)
  if (s === '') errors.amount = 'Enter an amount'
  else if (!Number.isFinite(amount)) errors.amount = 'Enter a number'
  const unit = form.unit
  if (!unit || !(TARIFF_UNITS as readonly string[]).includes(unit)) errors.unit = 'Choose a unit'
  else if (!unitCompatible(row.component, unit)) {
    errors.unit = `Not a valid unit for ${COMPONENT_LABELS[row.component]}: ${UNIT_LABELS[unit]}`
  }
  if (Object.keys(errors).length > 0) return { errors }
  const probe = makeTariff({
    name: 'rate', structure: 'flat',
    charges: [makeCharge({ component: row.component, season: row.season, unit: unit as TariffUnit, amountExclVat: amount })],
  })
  const issue = validateTariff(probe).find((i) => i.severity === 'block' && PLAUSIBILITY_CODES.has(i.code))
  if (issue) return { errors: { amount: issue.message.replace(/^.*?(\d)/, '$1') } }
  return { amountExclVat: amount, unit: unit as TariffUnit }
}

export function validateOverrideEdit(
  row: { component: ChargeComponent; season: TariffSeason },
  form: OverrideEditForm,
): { amountExclVat: number; unit: TariffUnit; reason: string } | { errors: Partial<Record<'amount' | 'unit' | 'reason', string>> } {
  const rate = validateRateEdit(row, form)
  const reason = form.reason.trim()
  const reasonError = !reason ? 'Say why this rate differs from the published one'
    : reason.length > 500 ? 'Keep the reason under 500 characters' : null
  if ('errors' in rate || reasonError) {
    return { errors: { ...('errors' in rate ? rate.errors : {}), ...(reasonError ? { reason: reasonError } : {}) } }
  }
  return { ...rate, reason }
}
