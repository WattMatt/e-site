/**
 * "Price from library": propose rates for a project's BOQ lines from the
 * library, in today's money, using the statistic the estimator chose
 * (median by default, P75 selectable — owner decision D2).
 *
 * Each half of a supply/install line comes from the observations that priced
 * that half. A library holding only all-in totals for an item cannot split
 * them, so that line is skipped with a reason rather than given an invented
 * split. Pure: the caller loads the library and applies the result.
 */
import type { QuantityMode } from '../schemas/boq.schema'
import { escalate, type IndexSeries } from './escalate'
import { matchLine } from './match'
import { percentile } from './stats'
import type { BudgetStatistic } from './budget-csv'

export interface PricingLine {
  boqItemId: string
  origin: string | null
  rateModel: string
  sectionPath: string[]
  description: string
  unit: string | null
  quantityMode: QuantityMode | null
  supplyRate: number | null
  installRate: number | null
  rate: number | null
}

export interface LibraryObservation {
  signature: string
  itemId: string
  itemCode: string
  supplyRate: number | null
  installRate: number | null
  rate: number
  pricedOn: string
}

export type SkipReason = 'variation_item' | 'amount_only' | 'not_a_rate' | 'no_library_item' | 'no_observations' | 'no_split_in_library' | 'cannot_escalate'

export interface RateProposal {
  boqItemId: string
  status: 'priced' | 'skipped'
  reason: SkipReason | null
  signature: string | null
  itemId: string | null
  itemCode: string | null
  n: number
  current: { supplyRate: number | null; installRate: number | null; rate: number | null }
  proposed: { supplyRate: number | null; installRate: number | null; rate: number | null } | null
}

const r2 = (n: number) => Math.round(n * 100) / 100
const p = (stat: BudgetStatistic) => (stat === 'p75' ? 0.75 : 0.5)

function statOf(values: (number | null)[], stat: BudgetStatistic): number | null {
  const v = values.filter((x): x is number => x !== null)
  const out = percentile(v, p(stat))
  return out === null ? null : r2(out)
}

export function proposeRates(lines: PricingLine[], library: LibraryObservation[], cpi: IndexSeries, stat: BudgetStatistic): RateProposal[] {
  const bySig = new Map<string, LibraryObservation[]>()
  for (const o of library) (bySig.get(o.signature) ?? bySig.set(o.signature, []).get(o.signature)!).push(o)
  const esc = (v: number | null, on: string) => (v === null || v <= 0 ? null : escalate(v, on, cpi).value)

  return lines.map(l => {
    const current = { supplyRate: l.supplyRate, installRate: l.installRate, rate: l.rate }
    const skip = (reason: SkipReason, extra: Partial<RateProposal> = {}): RateProposal =>
      ({ boqItemId: l.boqItemId, status: 'skipped', reason, signature: null, itemId: null, itemCode: null, n: 0, current, proposed: null, ...extra })
    if (l.origin === 'variation') return skip('variation_item')
    if (l.rateModel === 'amount_only') return skip('amount_only')
    // Match on the line's WORDS: an estimate line may carry no rate yet, so the
    // matcher is given placeholder rates on both halves (no scope attribute).
    const m = matchLine({ sectionPath: l.sectionPath, description: l.description, unit: l.unit, quantityMode: l.quantityMode, supplyRate: 1, installRate: 1 })
    if (m.kind === 'excluded') return skip('not_a_rate')
    if (m.kind !== 'match') return skip('no_library_item')
    const obs = bySig.get(m.signature) ?? []
    const head = { signature: m.signature, itemId: obs[0]?.itemId ?? null, itemCode: obs[0]?.itemCode ?? null, n: obs.length }
    if (!obs.length) return skip('no_observations', head)

    if (l.rateModel === 'supply_install') {
      const s = statOf(obs.map(o => esc(o.supplyRate, o.pricedOn)), stat)
      const i = statOf(obs.map(o => esc(o.installRate, o.pricedOn)), stat)
      if (s === null || i === null) return skip('no_split_in_library', head)
      return { boqItemId: l.boqItemId, status: 'priced', reason: null, ...head, current, proposed: { supplyRate: s, installRate: i, rate: null } }
    }
    const t = statOf(obs.map(o => esc(o.rate, o.pricedOn)), stat)
    if (t === null) return skip('cannot_escalate', head)
    return { boqItemId: l.boqItemId, status: 'priced', reason: null, ...head, current, proposed: { supplyRate: null, installRate: null, rate: t } }
  })
}
