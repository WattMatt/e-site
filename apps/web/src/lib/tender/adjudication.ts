/**
 * Tender adjudication (E5 slice D). Pure: the page and the export both build
 * from this, so the screen and the workbook cannot disagree.
 *
 * Every amount is recomputed here from the frozen BOQ quantity × the rate, for
 * the bids AND for WM's pre-priced estimate, so both sit on the same basis.
 * Fixed sums (provisional sums, PC) are added to every bid as issued, and to
 * the estimate only when an estimate exists. Rate-only rows carry no amount.
 *
 * Two kinds of flag:
 *   - against WM's ESTIMATE rate (works with one bidder);
 *   - against the MEDIAN of the bids, only with three or more priced rates
 *     (with two, the median is the mean and both bids would be flagged).
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

export type MedianFlag = 'high' | 'low' | 'zero' | 'not_priced' | null
export type EstimateFlag = 'above' | 'below' | null

export interface CellResult {
  rate: number | null
  amount: number
  /** Against the median of the bids (3+ priced rates), or a zero rate / not priced. */
  flag: MedianFlag
  /** Against WM's estimate rate, when there is one. */
  vsEstimate: EstimateFlag
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
  /** Equal totals share a rank. */
  rank: number
  vsEstimatePct: number | null
  flags: { high: number; low: number; zero: number; notPriced: number; aboveEstimate: number; belowEstimate: number }
}

export interface ArithmeticFinding {
  itemId: string
  sheet: string
  rowNumber: number
  code: string | null
  description: string
  stated: number
  computed: number
}

export interface Adjudication {
  rows: ItemRow[]
  bills: string[]
  estimateTotal: number | null
  estimateByBill: Record<string, number>
  totals: BidTotal[]
  checklist: { requirement: AdjRequirement; byBidder: Record<string, { ok: boolean; detail: string }> }[]
  /**
   * The arithmetic-error report. Bids priced in the portal cannot carry an
   * extension error (the database computes quantity × rate, and under the
   * standard conditions of tender the rate governs anyway), so what is checked
   * is WM's own estimate: each stated amount against quantity × rate.
   */
  arithmetic: { estimate: ArithmeticFinding[] }
  /** Priced or rate-only items a SUBMITTED bid carries no rate for: data missing, never a real bid. */
  integrity: { participantId: string; company: string; missing: number }[]
  threshold: number
}

const cents = (x: number) => Math.round(x * 100 + (x >= 0 ? 1e-7 : -1e-7))

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** The estimate's amount for an item on the bids' basis, in cents (null when unknown). */
function estimateCents(item: AdjItem, est: { rate: number | null; amount: number | null } | null, hasEstimate: boolean): number | null {
  if (!hasEstimate) return null
  if (item.rate_cell_type === 'fixed') return cents(Number(item.fixed_amount ?? 0))
  if (item.rate_cell_type !== 'priced' || !est) return null
  if (est.rate != null && item.quantity != null) return cents(item.quantity * est.rate)
  return est.amount != null ? cents(est.amount) : null
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
  const hasEstimate = Object.keys(estimate).length > 0
  const totals = new Map<string, { cents: number; byBill: Map<string, number>; flags: BidTotal['flags']; missing: number }>()
  for (const b of bids) {
    totals.set(b.participantId, { cents: 0, byBill: new Map(), flags: { high: 0, low: 0, zero: 0, notPriced: 0, aboveEstimate: 0, belowEstimate: 0 }, missing: 0 })
  }

  let estTotal = 0
  let estKnown = false
  const estimateByBill = new Map<string, number>()
  const arithmetic: ArithmeticFinding[] = []

  const rows: ItemRow[] = priceable.map((item) => {
    const est = estimate[item.id] ?? null
    const ec = estimateCents(item, est, hasEstimate)
    if (ec != null) {
      estKnown = true
      estTotal += ec
      estimateByBill.set(item.bill_code, (estimateByBill.get(item.bill_code) ?? 0) + ec)
    }
    if (item.rate_cell_type === 'priced' && est?.rate != null && est.amount != null && item.quantity != null) {
      const computed = cents(item.quantity * est.rate)
      if (computed !== cents(est.amount)) {
        arithmetic.push({ itemId: item.id, sheet: item.sheet_name, rowNumber: item.row_number, code: item.code, description: item.description, stated: cents(est.amount) / 100, computed: computed / 100 })
      }
    }
    const estRate = item.rate_cell_type === 'priced' || item.rate_cell_type === 'rate_only' ? est?.rate ?? null : null

    const rates = bids
      .map((b) => b.lines[item.id]?.rate)
      .filter((r): r is number => r != null && Number.isFinite(r) && r > 0)
    const med = item.rate_cell_type === 'fixed' || rates.length < 3 ? null : median(rates)
    const cells: Record<string, CellResult> = {}
    for (const b of bids) {
      const t = totals.get(b.participantId)!
      const line = b.lines[item.id]
      let cell: CellResult
      if (item.rate_cell_type === 'fixed') {
        cell = { rate: null, amount: cents(Number(item.fixed_amount ?? 0)) / 100, flag: null, vsEstimate: null }
      } else if (!line || line.rate == null) {
        // tender_submit refuses a bid with a priced or rate-only item unrated, so
        // in a submitted bid this means the data did not all arrive.
        if (item.rate_cell_type === 'priced' || item.rate_cell_type === 'rate_only') t.missing++
        cell = { rate: null, amount: 0, flag: line?.not_priced ? 'not_priced' : null, vsEstimate: null }
      } else {
        const amount = item.rate_cell_type === 'priced' && item.quantity != null ? cents(item.quantity * line.rate) / 100 : 0
        let flag: MedianFlag = null
        if (line.rate === 0) flag = 'zero'
        else if (med != null) {
          if (line.rate > med * (1 + threshold)) flag = 'high'
          else if (line.rate < med * (1 - threshold)) flag = 'low'
        }
        let vsEstimate: EstimateFlag = null
        if (estRate != null && estRate > 0) {
          if (line.rate > estRate * (1 + threshold)) vsEstimate = 'above'
          else if (line.rate < estRate * (1 - threshold)) vsEstimate = 'below'
        }
        cell = { rate: line.rate, amount, flag, vsEstimate }
      }
      cells[b.participantId] = cell
      t.cents += cents(cell.amount)
      t.byBill.set(item.bill_code, (t.byBill.get(item.bill_code) ?? 0) + cents(cell.amount))
      if (cell.flag === 'high') t.flags.high++
      if (cell.flag === 'low') t.flags.low++
      if (cell.flag === 'zero') t.flags.zero++
      if (cell.flag === 'not_priced') t.flags.notPriced++
      if (cell.vsEstimate === 'above') t.flags.aboveEstimate++
      if (cell.vsEstimate === 'below') t.flags.belowEstimate++
    }
    return { item, estimate: est, bids: cells, medianRate: med }
  })

  const estimateTotal = estKnown ? estTotal / 100 : null
  const ranked = bids
    .map((b) => ({ b, t: totals.get(b.participantId)! }))
    .sort((x, y) => x.t.cents - y.t.cents || x.b.company.localeCompare(y.b.company))
  const totalsOut: BidTotal[] = ranked.map(({ b, t }) => ({
    participantId: b.participantId,
    company: b.company,
    submittedAt: b.submittedAt,
    total: t.cents / 100,
    byBill: Object.fromEntries(Array.from(t.byBill.entries()).map(([k, v]) => [k, v / 100])),
    rank: 1 + ranked.filter((r) => r.t.cents < t.cents).length,
    vsEstimatePct: estimateTotal ? Math.round(((t.cents - estTotal) / estTotal) * 1000) / 10 : null,
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
    arithmetic: { estimate: arithmetic },
    integrity: bids
      .map((b) => ({ participantId: b.participantId, company: b.company, missing: totals.get(b.participantId)!.missing }))
      .filter((x) => x.missing > 0),
    threshold,
  }
}
