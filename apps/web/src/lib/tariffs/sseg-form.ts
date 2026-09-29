/** SSEG rule editor (spec §12 "SSEG rules"): tariffs.sseg_rule, one per tariff year. */
import { CAP_RULES, CARRY_FORWARD, CREDITING } from '@esite/shared'

export interface SsegForm {
  crediting: string
  carryForward: string
  fyEndMonth: string
  capRule: string
  forfeit: boolean
  maxKva: string
  requiresTou: boolean
  requiresBidirectional: boolean
  sourceDocumentId: string
  pages: string
}

export const EMPTY_SSEG_FORM: SsegForm = {
  crediting: 'net_billing_tou', carryForward: 'within_financial_year', fyEndMonth: '6', capRule: 'kwh_per_tou_period',
  forfeit: true, maxKva: '1000', requiresTou: true, requiresBidirectional: true, sourceDocumentId: '', pages: '',
}

export type SsegField = keyof SsegForm

export function validateSsegForm(f: SsegForm): { row: Record<string, unknown> } | { errors: Partial<Record<SsegField, string>> } {
  const errors: Partial<Record<SsegField, string>> = {}
  if (!(CREDITING as readonly string[]).includes(f.crediting)) errors.crediting = 'Choose the crediting method'
  if (!(CARRY_FORWARD as readonly string[]).includes(f.carryForward)) errors.carryForward = 'Choose the carry-forward rule'
  const month = Number(f.fyEndMonth)
  if (!Number.isInteger(month) || month < 1 || month > 12) errors.fyEndMonth = 'Choose the month the financial year ends'
  if (!(CAP_RULES as readonly string[]).includes(f.capRule)) errors.capRule = 'Choose the cap rule'
  const kva = Number(String(f.maxKva).replace(',', '.'))
  if (!Number.isFinite(kva) || kva <= 0) errors.maxKva = 'Enter a size above 0 kVA'
  if (f.pages.length > 50) errors.pages = 'Keep the page reference short (e.g. pp7-12)'
  if (Object.keys(errors).length > 0) return { errors }
  return {
    row: {
      crediting: f.crediting, carry_forward: f.carryForward, fy_end_month: month, cap_rule: f.capRule,
      forfeit_on_ownership_change: f.forfeit, max_kva: kva, requires_tou: f.requiresTou,
      requires_bidirectional_meter: f.requiresBidirectional, source_document_id: f.sourceDocumentId || null,
      locator: f.pages.trim() ? { pages: f.pages.trim() } : {},
    },
  }
}

export function ssegFormFromRow(r: Record<string, unknown> | null): SsegForm {
  if (!r) return { ...EMPTY_SSEG_FORM }
  const loc = (r.locator ?? {}) as { pages?: string }
  return {
    crediting: String(r.crediting), carryForward: String(r.carry_forward), fyEndMonth: String(r.fy_end_month),
    capRule: String(r.cap_rule), forfeit: Boolean(r.forfeit_on_ownership_change), maxKva: String(Number(r.max_kva)),
    requiresTou: Boolean(r.requires_tou), requiresBidirectional: Boolean(r.requires_bidirectional_meter),
    sourceDocumentId: (r.source_document_id as string | null) ?? '', pages: loc.pages ?? '',
  }
}
