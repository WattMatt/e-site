/**
 * Stage C (as-is/09 §7.1): the ONLY place a unit is decided. Precedence:
 * the value's own suffix, a unit column, the label, then a context or header
 * unit that is compatible with the component. Energy goes through
 * decideEnergyUnit (magnitude check, always flagged); a unitless fixed charge
 * is assumed R/month and flagged; anything else without a unit is unresolved.
 */
import { decideEnergyUnit, parseUnitToken, unitClass } from '../units'
import { makeCharge, type Charge, type ChargeComponent, type DemandBasis, type ExtractionMethod, type SourceLocator, type TariffSeason, type TariffUnit, type VatBasis } from '../types'
import type { TariffIssue } from '../validators'
import type { ParsedAmount } from './amount'
import { parseBlockRange } from './blocks'
import { detectComponent, detectSeason, detectTou, labelUnit } from './labels'

export interface NormaliseInput {
  label: string
  amount: ParsedAmount
  rawValue: string
  unitColumn: TariffUnit | null
  contextUnit: TariffUnit | null
  headerUnit: TariffUnit | null
  componentHint: ChargeComponent | null
  /** energy: set by "Summer Energy Charges"-style lines and energy labels; general: by "Low Season"-style lines. */
  seasonState: { energy: TariffSeason; general: TariffSeason }
  blockText: string | null
  vatBasis: VatBasis
  extractionMethod: ExtractionMethod
  locator: SourceLocator
}

export interface Unresolved {
  label: string
  raw: string
  reason: string
  locator: SourceLocator
}

export type NormaliseResult =
  | { ok: true; charge: Charge; issues: TariffIssue[] }
  | { ok: false; unresolved: Unresolved }

const FIXED_LIKE: ReadonlySet<ChargeComponent> = new Set<ChargeComponent>(['basic', 'service', 'admin', 'network_capacity', 'capacity_amp', 'gcc'])

export function unitCompatible(component: ChargeComponent, unit: TariffUnit): boolean {
  const cls = unitClass(unit)
  if (component === 'energy' || component === 'export_credit') return cls === 'per_kwh'
  if (component === 'reactive') return cls === 'per_kvarh'
  if (component === 'demand') return cls === 'per_kva_month' || cls === 'per_kw_month'
  if (FIXED_LIKE.has(component)) return cls === 'per_month' || cls === 'per_day' || cls === 'per_kva_month' || cls === 'per_amp_month'
  return true
}

export function normaliseCharge(inp: NormaliseInput): NormaliseResult {
  const issues: TariffIssue[] = []
  const explicit = parseUnitToken(inp.amount.unitText, { randPrefix: inp.amount.randPrefix, bare: true })
    ?? inp.unitColumn
    ?? labelUnit(inp.label)
  const component = detectComponent(inp.label, explicit, inp.componentHint)
  const hinted = [inp.contextUnit, inp.headerUnit].find((u): u is TariffUnit => u !== null && unitCompatible(component, u)) ?? null
  let unit: TariffUnit | null = explicit ?? hinted
  let inferred = false
  let reason: string | null = null

  if (component === 'energy' || component === 'export_credit') {
    const labelled = unit === 'c_per_kWh' || unit === 'R_per_kWh' ? unit : null
    const d = decideEnergyUnit(inp.amount.value, labelled)
    unit = d.unit
    inferred = d.inferred
    reason = d.reason
  } else if (unit === null && (component === 'basic' || component === 'service' || component === 'admin' || component === 'network_capacity')) {
    unit = 'R_per_month'
    inferred = true
    reason = 'fixed charge without a unit: assumed R/month'
  }
  if (unit === null) {
    return { ok: false, unresolved: { label: inp.label, raw: inp.rawValue, reason: reason ?? `unit unknown for ${component}`, locator: inp.locator } }
  }

  const cls = unitClass(unit)
  const isEnergy = component === 'energy' || component === 'export_credit'
  const labelSeason = detectSeason(inp.label)
  const season: TariffSeason = labelSeason
    ?? (isEnergy ? inp.seasonState.energy : cls === 'per_month' || cls === 'per_day' ? 'all' : inp.seasonState.general)
  const tou = isEnergy ? (detectTou(inp.label) ?? 'all') : 'all'

  let blockMinKwh: number | null = null
  let blockMaxKwh: number | null = null
  if (component === 'energy') {
    const b = parseBlockRange(inp.blockText ?? inp.label)
    if (b) {
      blockMinKwh = b.min
      blockMaxKwh = b.max
      if (b.typo) {
        issues.push({ code: 'block_unit_typo', severity: 'review', message: `block written in Wh: "${inp.blockText ?? inp.label}"`, locator: inp.locator })
      }
    }
  }

  let demandBasis: DemandBasis | null = null
  if (cls === 'per_kva_month' || cls === 'per_kw_month') {
    demandBasis = component === 'network_capacity' || /nmd|notified/i.test(`${inp.label} ${inp.amount.unitText ?? ''}`) ? 'nmd' : 'actual_md'
  }

  const charge = makeCharge({
    component, unit, amountExclVat: inp.amount.value, season, tou,
    blockMinKwh, blockMaxKwh, blockBasis: blockMinKwh === null ? null : 'monthly',
    demandBasis, vatBasis: inp.vatBasis,
    unitInferred: inferred, inferenceReason: inferred ? reason : null,
    sourceLocator: { ...inp.locator, raw_unit: inp.amount.unitText ?? null },
    extractionMethod: inp.extractionMethod,
    label: inp.label,
  })
  return { ok: true, charge, issues }
}
