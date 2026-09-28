/**
 * The proposal draft (functional spec §9.3): structured fields only, no free markup. Stored in
 * solar.proposals.draft (a money table). Money-shaped inputs here are the margin % only; the
 * offer price is computed (offer.ts), never typed.
 */
import { z } from 'zod'

export const FINANCE_OPTION_KINDS = ['cash', 'debt', 'ppa', 'lease'] as const
export type FinanceOptionKind = (typeof FINANCE_OPTION_KINDS)[number]
export const FINANCE_OPTION_LABELS: Record<FinanceOptionKind, string> = {
  cash: 'Cash purchase',
  debt: 'Debt-financed',
  ppa: 'Power purchase agreement (PPA)',
  lease: 'Lease / rent-to-own',
}

const text = (max: number) => z.string().max(max, `At most ${max} characters`)
const list = z.array(z.string().trim().min(1, 'Remove empty lines').max(300, 'At most 300 characters per line')).max(50, 'At most 50 lines')

export const ProposalDraftSchema = z.object({
  clientName: z.string().trim().min(1, 'Enter the client name').max(200, 'At most 200 characters'),
  marginPct: z.number({ invalid_type_error: 'Enter a number' }).min(0, 'Margin must be between 0 and 100 %').max(100, 'Margin must be between 0 and 100 %'),
  validityDays: z.number({ invalid_type_error: 'Enter a number' }).int('Whole days only').min(1, 'Between 1 and 365 days').max(365, 'Between 1 and 365 days'),
  financeOptions: z.array(z.enum(FINANCE_OPTION_KINDS))
    .min(1, 'Offer at least one finance option').max(4)
    .refine((a) => new Set(a).size === a.length, 'Each finance option may be offered once'),
  summary: text(4000),
  scope: text(8000),
  priceTerms: text(4000),
  assumptions: text(4000),
  inclusions: list,
  exclusions: list,
  terms: text(20000),
  narrative: text(8000),
})
export type ProposalDraft = z.infer<typeof ProposalDraftSchema>

export type ParseDraftResult = { ok: true; draft: ProposalDraft } | { ok: false; errors: Record<string, string> }

export function parseProposalDraft(raw: unknown): ParseDraftResult {
  const r = ProposalDraftSchema.safeParse(raw)
  if (r.success) return { ok: true, draft: r.data }
  const errors: Record<string, string> = {}
  for (const i of r.error.issues) {
    const k = String(i.path[0] ?? 'draft')
    if (!errors[k]) errors[k] = i.message
  }
  return { ok: false, errors }
}

const BLANK: ProposalDraft = {
  clientName: '', marginPct: 0, validityDays: 30, financeOptions: ['cash'],
  summary: '', scope: '', priceTerms: '', assumptions: '', inclusions: [], exclusions: [], terms: '', narrative: '',
}

export interface DraftDefaults {
  clientName: string | null
  /** 4b rate-card `rc_margin_pct`; NULL ⇒ 0 %, which the editor flags. */
  marginPct: number | null
  validityDays: number | null
  termsText: string | null
  /** Finance models enabled on the case's Financials tab (their inputs live there). */
  enabledKinds: readonly FinanceOptionKind[]
}

export function defaultProposalDraft(d: DraftDefaults): ProposalDraft {
  const kinds = FINANCE_OPTION_KINDS.filter((k) => d.enabledKinds.includes(k))
  return {
    ...BLANK,
    clientName: d.clientName?.trim() ?? '',
    marginPct: d.marginPct ?? 0,
    validityDays: d.validityDays ?? 30,
    terms: d.termsText ?? '',
    financeOptions: kinds.length ? kinds : ['cash'],
  }
}

/** Lenient read of a stored draft for the editor: never throws, never keeps unknown keys. */
export function readProposalDraft(raw: unknown): ProposalDraft {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const str = (k: keyof ProposalDraft) => (typeof o[k] === 'string' ? (o[k] as string) : (BLANK[k] as string))
  const num = (k: 'marginPct' | 'validityDays') => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : BLANK[k])
  const strs = (k: 'inclusions' | 'exclusions') => (Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === 'string') : [])
  const fo = Array.isArray(o.financeOptions)
    ? FINANCE_OPTION_KINDS.filter((k) => (o.financeOptions as unknown[]).includes(k))
    : []
  return {
    clientName: str('clientName'), marginPct: num('marginPct'), validityDays: num('validityDays'),
    financeOptions: fo.length ? fo : ['cash'],
    summary: str('summary'), scope: str('scope'), priceTerms: str('priceTerms'), assumptions: str('assumptions'),
    inclusions: strs('inclusions'), exclusions: strs('exclusions'), terms: str('terms'), narrative: str('narrative'),
  }
}
