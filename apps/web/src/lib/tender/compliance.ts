/**
 * Submission compliance (E5 slice C). Pure, for the pricing page's live
 * checklist. It is a convenience, not the gate: projects.tender_submit re-checks
 * the same rules in SQL and is the only way a bid becomes submitted.
 *
 * Arithmetic is ALWAYS recomputed from quantity × rate, exactly as the database
 * trigger does (only a 'priced' item carries an amount); an amount a bidder
 * typed or carried in a workbook is never trusted.
 */

export type RateCellType = 'priced' | 'fixed' | 'rate_only' | 'not_priced'

export interface ComplianceItem {
  id: string
  sheet_name: string
  row_number: number
  code: string | null
  description: string
  quantity: number | null
  rate_cell_type: RateCellType
  fixed_amount: number | null
}

export interface ComplianceLine {
  item_id: string
  rate: number | null
  not_priced: boolean
}

export interface ComplianceRequirement {
  id: string
  kind: 'document' | 'declaration'
  label: string
  mandatory: boolean
}

export interface ComplianceInput {
  items: ComplianceItem[]
  lines: ComplianceLine[]
  requirements: ComplianceRequirement[]
  uploadedRequirementIds: string[]
  acceptedDeclarationIds: string[]
  profileComplete: boolean
  unacknowledgedAddenda: { id: string; title: string }[]
  tender: { status: string; closing_at: string | null }
  now: Date
}

export type IssueKind =
  | 'closed'
  | 'profile'
  | 'unpriced'
  | 'bad_rate'
  | 'not_priced_not_allowed'
  | 'document'
  | 'declaration'
  | 'addendum'

export interface ComplianceIssue {
  kind: IssueKind
  message: string
  itemId?: string
  requirementId?: string
}

export interface PricedLine {
  item_id: string
  rate: number | null
  amount: number
}

export interface ComplianceResult {
  ok: boolean
  issues: ComplianceIssue[]
  /** Server-recomputed amounts for every item (fixed sums included). */
  priced: PricedLine[]
  /** Σ amounts, rounded once to the cent. */
  total: number
}

const cents = (x: number) => Math.round(x * 100 + (x >= 0 ? 1e-7 : -1e-7))
const MAX_RATE = 1e11

function where(i: ComplianceItem) {
  return `${i.sheet_name} ${i.code ?? `row ${i.row_number}`}`
}

export function checkCompliance(input: ComplianceInput): ComplianceResult {
  const issues: ComplianceIssue[] = []
  const t = input.tender
  if (t.status !== 'issued' || !t.closing_at || new Date(t.closing_at) <= input.now) {
    issues.push({ kind: 'closed', message: 'This tender is not open for submissions.' })
  }
  if (!input.profileComplete) issues.push({ kind: 'profile', message: 'Complete your company details.' })

  const byItem = new Map(input.lines.map((l) => [l.item_id, l]))
  const priced: PricedLine[] = []
  let totalCents = 0
  for (const item of input.items) {
    const line = byItem.get(item.id)
    if (item.rate_cell_type === 'fixed') {
      const amount = cents(item.fixed_amount ?? 0) / 100
      priced.push({ item_id: item.id, rate: null, amount })
      totalCents += cents(amount)
      continue
    }
    const rate = line?.rate ?? null
    if (rate == null) {
      if (line?.not_priced) {
        if (item.rate_cell_type !== 'not_priced') {
          issues.push({ kind: 'not_priced_not_allowed', message: `${where(item)} must be priced.`, itemId: item.id })
        }
      } else if (item.rate_cell_type !== 'not_priced') {
        issues.push({ kind: 'unpriced', message: `${where(item)} has no rate.`, itemId: item.id })
      }
      priced.push({ item_id: item.id, rate: null, amount: 0 })
      continue
    }
    if (!Number.isFinite(rate) || rate < 0 || rate > MAX_RATE) {
      issues.push({ kind: 'bad_rate', message: `${where(item)}: the rate must be a positive number.`, itemId: item.id })
      priced.push({ item_id: item.id, rate: null, amount: 0 })
      continue
    }
    // Only a 'priced' item carries an amount (rate-only and not-priced rows carry
    // a rate at most) — the same rule as tender_submission_lines_compute.
    const amount = item.rate_cell_type !== 'priced' || item.quantity == null ? 0 : cents(item.quantity * rate) / 100
    priced.push({ item_id: item.id, rate, amount })
    totalCents += cents(amount)
  }

  for (const r of input.requirements) {
    if (!r.mandatory) continue
    if (r.kind === 'document' && !input.uploadedRequirementIds.includes(r.id)) {
      issues.push({ kind: 'document', message: `Upload: ${r.label}.`, requirementId: r.id })
    }
    if (r.kind === 'declaration' && !input.acceptedDeclarationIds.includes(r.id)) {
      issues.push({ kind: 'declaration', message: `Accept: ${r.label}.`, requirementId: r.id })
    }
  }
  for (const a of input.unacknowledgedAddenda) {
    issues.push({ kind: 'addendum', message: `Acknowledge addendum: ${a.title}.` })
  }

  return { ok: issues.length === 0, issues, priced, total: totalCents / 100 }
}
