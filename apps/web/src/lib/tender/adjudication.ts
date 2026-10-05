/**
 * Tender adjudication (E5 slice D). Pure: the page and the export both build
 * from this, so the screen and the workbook cannot disagree.
 *
 * Every amount is recomputed here from the frozen BOQ quantity × the bid rate
 * (the database already does so on save; doing it again keeps this module
 * honest on its own). Fixed sums are added to every bid as issued.
 */

export interface AdjItem {
  id: string
  sheet_name: string
  row_number: number
  bill_code: string
  code: string | null
  description: string
  unit: string | null
  quantity: number | null
  rate_cell_type: 'priced' | 'fixed' | 'rate_only' | 'not_priced'
  fixed_amount: number | null
}

export interface AdjBid {
  participantId: string
  company: string
  submittedAt: string | null
  lines: Record<string, { rate: number | null; not_priced: boolean }>
}

export interface AdjRequirement {
  id: string
  kind: 'document' | 'declaration'
  label: string
  mandatory: boolean
}

export interface AdjCompliance {
  participantId: string
  documents: Record<string, string[]> // requirementId → file names
  declarations: string[]
  profile: { cidb_grade: string | null; bbbee_level: string | null; registration_number: string | null; vat_number: string | null } | null
}

export interface CellResult {
  rate: number | null
  amount: number
  /** 'high'/'low' when the rate is more than `threshold` away from the median of bids. */
  flag: 'high' | 'low' | 'zero' | 'unpriced' | 'not_priced' | null
}

export interface ItemRow {
  item: AdjItem
  estimate: { rate: number | null; amount: number | null } | null
  bids: Record<string, CellResult>
  medianRate: number | null
}

export interface BidTotal {
  participantId: string
  company: string
  submittedAt: string | null
  total: number
  byBill: Record<string, number>
  rank: number
  vsEstimatePct: number | null
  flags: { high: number; low: number; zero: number; unpriced: number; notPriced: number }
}

export interface Adjudication {
  rows: ItemRow[]
  bills: string[]
  estimateTotal: number | null
  estimateByBill: Record<string, number>
  totals: BidTotal[]
  checklist: { requirement: AdjRequirement; byBidder: Record<string, { ok: boolean; detail: string }> }[]
  threshold: number
}

const cents = (x: number) => Math.round(x * 100 + (x >= 0 ? 1e-7 : -1e-7))

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function adjudicate(
  items: AdjItem[],
  estimate: Record<string, { rate: number | null; amount: number | null }>,
  bids: AdjBid[],
  requirements: AdjRequirement[],
  compliance: AdjCompliance[],
  threshold = 0.3,
): Adjudication {
  const priceable = items.filter((i) => ['priced', 'fixed', 'rate_only', 'not_priced'].includes(i.rate_cell_type))
  const bills = Array.from(new Set(priceable.map((i) => i.bill_code)))
  const totals = new Map<string, { cents: number; byBill: Map<string, number>; flags: BidTotal['flags'] }>()
  for (const b of bids) totals.set(b.participantId, { cents: 0, byBill: new Map(), flags: { high: 0, low: 0, zero: 0, unpriced: 0, notPriced: 0 } })

  let estimateCents = 0
  let estimateKnown = false
  const estimateByBill = new Map<string, number>()

  const rows: ItemRow[] = priceable.map((item) => {
    const est = estimate[item.id] ?? null
    const estAmount = item.rate_cell_type === 'fixed' ? Number(item.fixed_amount ?? 0) : est?.amount ?? null
    if (estAmount != null) {
      estimateKnown = true
      estimateCents += cents(estAmount)
      estimateByBill.set(item.bill_code, (estimateByBill.get(item.bill_code) ?? 0) + cents(estAmount))
    }
    const rates = bids
      .map((b) => b.lines[item.id]?.rate)
      .filter((r): r is number => r != null && Number.isFinite(r) && r > 0)
    const med = item.rate_cell_type === 'fixed' ? null : median(rates)
    const cells: Record<string, CellResult> = {}
    for (const b of bids) {
      const t = totals.get(b.participantId)!
      const line = b.lines[item.id]
      let cell: CellResult
      if (item.rate_cell_type === 'fixed') {
        cell = { rate: null, amount: cents(Number(item.fixed_amount ?? 0)) / 100, flag: null }
      } else if (!line || line.rate == null) {
        cell = { rate: null, amount: 0, flag: line?.not_priced ? 'not_priced' : 'unpriced' }
      } else {
        const amount = item.rate_cell_type === 'priced' && item.quantity != null ? cents(Number(item.quantity) * line.rate) / 100 : 0
        let flag: CellResult['flag'] = null
        if (line.rate === 0) flag = 'zero'
        else if (med != null && rates.length >= 2) {
          if (line.rate > med * (1 + threshold)) flag = 'high'
          else if (line.rate < med * (1 - threshold)) flag = 'low'
        }
        cell = { rate: line.rate, amount, flag }
      }
      cells[b.participantId] = cell
      t.cents += cents(cell.amount)
      t.byBill.set(item.bill_code, (t.byBill.get(item.bill_code) ?? 0) + cents(cell.amount))
      if (cell.flag === 'high') t.flags.high++
      if (cell.flag === 'low') t.flags.low++
      if (cell.flag === 'zero') t.flags.zero++
      if (cell.flag === 'unpriced' && item.rate_cell_type !== 'not_priced') t.flags.unpriced++
      if (cell.flag === 'not_priced') t.flags.notPriced++
    }
    return { item, estimate: est, bids: cells, medianRate: med }
  })

  const estimateTotal = estimateKnown ? estimateCents / 100 : null
  const ranked = bids
    .map((b) => ({ b, t: totals.get(b.participantId)! }))
    .sort((x, y) => x.t.cents - y.t.cents)
  const totalsOut: BidTotal[] = ranked.map(({ b, t }, i) => ({
    participantId: b.participantId,
    company: b.company,
    submittedAt: b.submittedAt,
    total: t.cents / 100,
    byBill: Object.fromEntries(Array.from(t.byBill.entries()).map(([k, v]) => [k, v / 100])),
    rank: i + 1,
    vsEstimatePct: estimateTotal ? Math.round(((t.cents / 100 - estimateTotal) / estimateTotal) * 1000) / 10 : null,
    flags: t.flags,
  }))

  const checklist = requirements.map((requirement) => {
    const byBidder: Record<string, { ok: boolean; detail: string }> = {}
    for (const b of bids) {
      const c = compliance.find((x) => x.participantId === b.participantId)
      if (requirement.kind === 'declaration') {
        const ok = !!c?.declarations.includes(requirement.id)
        byBidder[b.participantId] = { ok, detail: ok ? 'accepted' : 'not accepted' }
      } else {
        const files = c?.documents[requirement.id] ?? []
        byBidder[b.participantId] = { ok: files.length > 0, detail: files.length ? files.join(', ') : 'missing' }
      }
    }
    return { requirement, byBidder }
  })

  return {
    rows,
    bills,
    estimateTotal,
    estimateByBill: Object.fromEntries(Array.from(estimateByBill.entries()).map(([k, v]) => [k, v / 100])),
    totals: totalsOut,
    checklist,
    threshold,
  }
}
