/**
 * Tariff picker eligibility (spec §5 "Tariff" row): only tariffs whose
 * eligibility matches the study's NMD and supply voltage are shown; the rest
 * sit under "Show all" with the reason. Unknown facts exclude nothing.
 *
 * Voltage bands are the strings 2a's voltageBandFromText writes. A band this
 * module does not know (free text from a municipal book) never excludes a
 * tariff: excluding on a guess would hide the right tariff.
 */
import { TARIFF_CATEGORIES, type TariffCategory, type TariffMetering, type TariffStructure } from '../../tariffs/types'
import { TARIFF_CATEGORY_LABELS } from './labels'

export interface TariffListItem {
  id: string
  code: string | null
  name: string
  category: TariffCategory
  metering: TariffMetering
  structure: TariffStructure
  voltageBand: string | null
  phase: 'single' | 'three' | null
  minKva: number | null
  maxKva: number | null
  minAmps: number | null
  maxAmps: number | null
  isLegacy: boolean
  exportTariffId: string | null
}

export interface SupplyFacts {
  nmdKva: number | null
  supplyVoltageV: number | null
}

const KNOWN_BANDS: ReadonlySet<string> = new Set(['lt_500v', '500v_22kv', '500v_66kv', '66kv_132kv', 'gt_132kv'])

export function voltageBandsFor(volts: number | null): string[] | null {
  if (volts === null || !Number.isFinite(volts) || volts <= 0) return null
  if (volts < 500) return ['lt_500v']
  const out: string[] = []
  if (volts <= 22000) out.push('500v_22kv')
  if (volts < 66000) out.push('500v_66kv')
  if (volts >= 66000 && volts <= 132000) out.push('66kv_132kv')
  if (volts > 132000) out.push('gt_132kv')
  return out
}

function formatVolts(v: number): string {
  return v >= 1000 ? `${v / 1000} kV` : `${v} V`
}

export function eligibilityReasons(t: TariffListItem, s: SupplyFacts): string[] {
  const reasons: string[] = []
  if (t.category === 'sseg') reasons.push('Export (SSEG) tariff: applied through the export rule')
  if (t.isLegacy) reasons.push('Legacy tariff (closed to new customers)')
  if (s.nmdKva !== null) {
    if (t.minKva !== null && s.nmdKva < t.minKva) reasons.push(`NMD ${s.nmdKva} kVA is below the ${t.minKva} kVA minimum`)
    if (t.maxKva !== null && s.nmdKva > t.maxKva) reasons.push(`NMD ${s.nmdKva} kVA is above the ${t.maxKva} kVA maximum`)
  }
  const bands = voltageBandsFor(s.supplyVoltageV)
  if (bands && t.voltageBand && KNOWN_BANDS.has(t.voltageBand) && !bands.includes(t.voltageBand)) {
    reasons.push(`Supply at ${formatVolts(s.supplyVoltageV as number)} is outside this tariff's voltage band`)
  }
  return reasons
}

export interface TariffPickerOptions {
  supply: SupplyFacts
  showAll: boolean
  query: string
  metering: TariffMetering | null
  phase: 'single' | 'three' | null
}

export type PickerTariff = TariffListItem & { eligible: boolean; reasons: string[] }

export interface TariffPickerGroups {
  groups: Array<{ category: TariffCategory; label: string; tariffs: PickerTariff[] }>
  /** Matching the filters but hidden because ineligible (0 when showAll). */
  hiddenCount: number
}

export function groupTariffs(items: readonly TariffListItem[], o: TariffPickerOptions): TariffPickerGroups {
  const q = o.query.trim().toLowerCase()
  let hiddenCount = 0
  const kept: PickerTariff[] = []
  for (const t of items) {
    if (q && !t.name.toLowerCase().includes(q) && !(t.code ?? '').toLowerCase().includes(q)) continue
    if (o.metering && t.metering !== o.metering && t.metering !== 'both') continue
    if (o.phase && t.phase !== null && t.phase !== o.phase) continue
    const reasons = eligibilityReasons(t, o.supply)
    const eligible = reasons.length === 0
    if (!eligible && !o.showAll) {
      hiddenCount++
      continue
    }
    kept.push({ ...t, eligible, reasons })
  }
  const groups = TARIFF_CATEGORIES
    .map((category) => ({
      category,
      label: TARIFF_CATEGORY_LABELS[category],
      tariffs: kept.filter((t) => t.category === category).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.tariffs.length > 0)
  return { groups, hiddenCount }
}
