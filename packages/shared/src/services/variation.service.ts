import type { BoqItem } from '../schemas/boq.schema'
import type { VariationLine } from '../schemas/variation.schema'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

type RateFields = Pick<BoqItem, 'supplyRate' | 'installRate' | 'rate' | 'rateModel'>
const effectiveRate = (f: RateFields): number =>
  f.rateModel === 'single' ? (f.rate ?? 0) : (f.supplyRate ?? 0) + (f.installRate ?? 0)

/** Money effect of one variation line. adjust => delta x the ITEM's contract rate; add => qty x the LINE's own rate. */
export function computeLineChange(
  line: Pick<VariationLine, 'kind' | 'qtyDelta' | 'quantity' | 'rateModel' | 'supplyRate' | 'installRate' | 'rate'>,
  item?: Pick<BoqItem, 'supplyRate' | 'installRate' | 'rate' | 'rateModel'>,
): number {
  if (line.kind === 'adjust') {
    if (!item) throw new Error('adjust line requires its boq item')
    return round2((line.qtyDelta ?? 0) * effectiveRate(item))
  }
  return round2((line.quantity ?? 0) * effectiveRate({ rateModel: line.rateModel ?? 'supply_install', supplyRate: line.supplyRate, installRate: line.installRate, rate: line.rate }))
}

/** The >= 0 revised-quantity floor: contractQty + priorDeltas + newDelta >= 0. */
export function validateQtyDelta(
  item: Pick<BoqItem, 'quantity'>,
  priorApprovedDeltas: number[],
  newDelta: number,
): boolean {
  const base = (item.quantity ?? 0) + priorApprovedDeltas.reduce((s, d) => s + d, 0)
  return base + newDelta >= -1e-9
}

/** Revised position of one contract item under its approved qty deltas. */
export function computeRevisedItem(
  item: Pick<BoqItem, 'quantity' | 'amount' | 'supplyRate' | 'installRate' | 'rate' | 'rateModel' | 'quantityMode'>,
  approvedDeltas: number[],
): { revisedQty: number | null; revisedAmount: number | null } {
  if (item.rateModel === 'amount_only') return { revisedQty: item.quantity ?? null, revisedAmount: item.amount ?? null }
  const deltaSum = approvedDeltas.reduce((s, d) => s + d, 0)
  if (approvedDeltas.length === 0) return { revisedQty: item.quantity ?? null, revisedAmount: item.amount ?? null }
  const revisedQty = round2((item.quantity ?? 0) + deltaSum)
  return { revisedQty, revisedAmount: round2(revisedQty * effectiveRate(item)) }
}

/** Revised rollups: computeRollups over revised amounts (adjustmentsByItem: boq_item_id -> approved deltas). */
export function computeRevisedAmounts(
  items: BoqItem[],
  adjustmentsByItem: Map<string, number[]>,
): Map<string, number | null> {
  const out = new Map<string, number | null>()
  for (const it of items) out.set(it.id, computeRevisedItem(it, adjustmentsByItem.get(it.id) ?? []).revisedAmount)
  return out
}
