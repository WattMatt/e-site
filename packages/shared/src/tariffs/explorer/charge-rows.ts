/**
 * A tariff's charges as the explorer shows them: grouped by component in
 * reading order, each row with its amount and unit, the YoY change against
 * the same charge last year, and where the value was read from.
 *
 * YoY matching is chargeKey (normalised tariff name | component | season |
 * TOU | block start) and the comparison is diffTariffYears', so the explorer
 * and the admin diff page can never disagree about a change.
 */
import { formatChargeAmount, COMPONENT_LABELS, SEASON_LABELS, TARIFF_DAY_TYPE_LABELS, TOU_LABELS } from '../../solar/tariff/labels'
import type { Charge, ChargeComponent, SourceLocator, Tariff, TariffSeason, TouOrAll } from '../types'
import { chargeKey, diffTariffYears } from '../yoy'

export interface ExplorerCharge {
  id: string
  charge: Charge
  sourceDocumentId: string | null
  sourceTitle: string | null
}

export type YoyCell =
  | { kind: 'changed'; pct: number }
  | { kind: 'new' }
  | { kind: 'unit_changed' }
  | { kind: 'no_previous' }

export interface ChargeRowView {
  id: string
  component: ChargeComponent
  season: string
  period: string
  dayType: string
  block: string
  amount: string
  vatBasis: Charge['vatBasis']
  unitNote: string | null
  yoy: YoyCell
  citation: string
  canViewSource: boolean
  sourceDocumentId: string | null
  locator: SourceLocator
}

export interface ChargeGroupView {
  component: ChargeComponent
  label: string
  rows: ChargeRowView[]
}

/** Energy first, then the fixed charges, then capacity and demand, then the per-kWh adders. */
const COMPONENT_ORDER: readonly ChargeComponent[] = [
  'energy', 'basic', 'service', 'admin', 'capacity_amp', 'network_capacity', 'network_demand', 'demand',
  'gcc', 'transmission_network', 'ancillary', 'ers', 'affordability', 'lv_subsidy', 'legacy', 'reactive',
  'export_credit', 'wheeling_uos', 'loss_factor', 'other',
]
const SEASON_ORDER: Record<TariffSeason, number> = { high: 0, low: 1, all: 2 }
const TOU_ORDER: Record<TouOrAll, number> = { peak: 0, standard: 1, off_peak: 2, all: 3 }
const DAY_ORDER: Record<Charge['dayType'], number> = { all: 0, weekday: 1, saturday: 2, sunday: 3 }

export function citeLocator(title: string | null, loc: SourceLocator | null | undefined): string {
  if (!title) return 'No source recorded'
  const l = loc ?? {}
  if (typeof l.page === 'number' && l.page > 0) return `${title}, page ${l.page}`
  const cell = l.cell ?? (l.col && typeof l.row === 'number' ? `${l.col}${l.row}` : null)
  if (l.sheet || cell) return `${title}, ${[l.sheet, cell].filter(Boolean).join(' ')}`
  return title
}

function blockLabel(c: Charge): string {
  if (c.blockMinKwh === null) return '—'
  const per = c.blockBasis === 'daily' ? 'kWh/day' : 'kWh/month'
  if (c.blockMaxKwh === null) return `Above ${c.blockMinKwh} ${per}`
  return `${c.blockMinKwh}–${c.blockMaxKwh} ${per}`
}

function yoyByKey(tariff: Tariff, previous: Tariff | null): Map<string, YoyCell> | null {
  if (!previous) return null
  // Compare under one name: chargeKey starts with the normalised tariff name.
  const prev = { ...previous, name: tariff.name }
  const diff = diffTariffYears([prev], [tariff], null)
  const m = new Map<string, YoyCell>()
  for (const k of diff.added) m.set(k, { kind: 'new' })
  for (const c of diff.changed) m.set(c.key, c.changePct === null ? { kind: 'unit_changed' } : { kind: 'changed', pct: c.changePct })
  return m
}

export function buildChargeGroups(tariff: Tariff, charges: readonly ExplorerCharge[], previous: Tariff | null): ChargeGroupView[] {
  const yoy = yoyByKey(tariff, previous)
  const sorted = [...charges].sort((a, b) =>
    SEASON_ORDER[a.charge.season] - SEASON_ORDER[b.charge.season]
    || TOU_ORDER[a.charge.tou] - TOU_ORDER[b.charge.tou]
    || DAY_ORDER[a.charge.dayType] - DAY_ORDER[b.charge.dayType]
    || (a.charge.blockMinKwh ?? -1) - (b.charge.blockMinKwh ?? -1))
  const groups: ChargeGroupView[] = []
  for (const component of COMPONENT_ORDER) {
    const own = sorted.filter((e) => e.charge.component === component)
    if (own.length === 0) continue
    groups.push({
      component,
      label: COMPONENT_LABELS[component],
      rows: own.map((e): ChargeRowView => {
        const c = e.charge
        return {
          id: e.id,
          component,
          season: SEASON_LABELS[c.season],
          period: TOU_LABELS[c.tou],
          dayType: TARIFF_DAY_TYPE_LABELS[c.dayType],
          block: blockLabel(c),
          amount: formatChargeAmount(c.amountExclVat, c.unit),
          vatBasis: c.vatBasis,
          unitNote: c.unitInferred ? `Unit inferred: ${c.inferenceReason ?? 'no reason recorded'}` : null,
          // A charge whose key was neither added nor changed is unchanged: 0 %.
          yoy: yoy === null ? { kind: 'no_previous' } : (yoy.get(chargeKey(tariff, c)) ?? { kind: 'changed', pct: 0 }),
          citation: citeLocator(e.sourceTitle, c.sourceLocator),
          canViewSource: e.sourceDocumentId !== null,
          sourceDocumentId: e.sourceDocumentId,
          locator: c.sourceLocator,
        }
      }),
    })
  }
  return groups
}
