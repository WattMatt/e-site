import type { InputMethod } from '../schemas/valuation.schema'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function computeLineValue(
  item: { amount: number | null; supplyRate: number | null; installRate: number | null; rate: number | null; rateModel: string },
  line: { inputMethod: InputMethod; percentComplete: number | null; qtyComplete: number | null },
): number {
  if (line.inputMethod === 'quantity') {
    const rate = item.rateModel === 'single' ? (item.rate ?? 0) : (item.supplyRate ?? 0) + (item.installRate ?? 0)
    let v = round2(Math.max(0, line.qtyComplete ?? 0) * rate)
    if (item.amount != null) v = Math.min(v, item.amount) // over-measure capped at contract (a Variations concern)
    return v
  }
  // percent | section
  const pct = Math.min(100, Math.max(0, line.percentComplete ?? 0))
  return round2((item.amount ?? 0) * (pct / 100))
}

export function computeCertificate(
  lines: { valueToDate: number }[],
  retentionPct: number,
  previousNet: number,
): { grossToDate: number; retention: number; netToDate: number; previousNet: number; dueExVat: number; vat: number; dueInclVat: number } {
  const grossToDate = round2(lines.reduce((s, l) => s + l.valueToDate, 0))
  const retention = round2(grossToDate * (retentionPct / 100))
  const netToDate = round2(grossToDate - retention)
  const dueExVat = round2(netToDate - previousNet)
  const vat = round2(dueExVat * 0.15)
  const dueInclVat = round2(dueExVat + vat)
  return { grossToDate, retention, netToDate, previousNet, dueExVat, vat, dueInclVat }
}

/** True when a quantity line values more than the contract amount (over-measure → Variations). */
export function isOverMeasure(
  item: { amount: number | null; supplyRate: number | null; installRate: number | null; rate: number | null; rateModel: string },
  line: { inputMethod: InputMethod; qtyComplete: number | null },
): boolean {
  if (line.inputMethod !== 'quantity' || item.amount == null) return false
  const rate = item.rateModel === 'single' ? (item.rate ?? 0) : (item.supplyRate ?? 0) + (item.installRate ?? 0)
  return round2((line.qtyComplete ?? 0) * rate) > item.amount
}
