import { ToolRefusal } from '../../define-tool'
import { DENYLISTED } from './sentences'

const WHO = 'Who is who; written by the users pages.'
const MONEY = 'Money and Paystack state; written by the billing and marketplace flows.'
const SEALED = 'Sealed until closing; written by definer functions only.'

// Writes only; reads are never denylisted (RLS decides what a person sees). `schema.*` covers every table in the schema.
export const WRITE_DENYLIST: ReadonlyArray<{ table: string; reason: string }> = [
  { table: 'public.user_organisations', reason: WHO },
  { table: 'projects.project_members', reason: WHO },
  { table: 'public.profiles', reason: WHO },
  { table: 'billing.*', reason: MONEY },
  { table: 'marketplace.paystack_subaccounts', reason: MONEY },
  { table: 'marketplace.orders', reason: MONEY },
  { table: 'marketplace.order_items', reason: MONEY },
  { table: 'marketplace.commission_records', reason: MONEY },
  { table: 'marketplace.commission_payouts', reason: MONEY },
  { table: 'projects.tender_submissions', reason: SEALED },
  { table: 'projects.tender_submission_lines', reason: SEALED },
  { table: 'projects.tender_submission_documents', reason: SEALED },
  { table: 'structure.scope_item_types', reason: 'Org-wide registry edited from a project page; one stray row put a column on every tenant schedule in every project.' },
  { table: 'public.mcp_tool_calls', reason: 'The audit must not be editable by what it audits.' },
  { table: 'public.mcp_previews', reason: 'The audit must not be editable by what it audits; written only through its own path.' },
  { table: 'inspections.templates', reason: 'A template must keep rendering against the wording its signatory saw; edited on the app\'s template pages.' },
  { table: 'field.form_templates', reason: 'A template must keep rendering against the wording its signatory saw; edited on the app\'s template pages.' },
]

export function isWriteDenied(schema: string, table: string): boolean {
  return WRITE_DENYLIST.some(e => e.table === `${schema}.${table}` || e.table === `${schema}.*`)
}

export function assertWritable(schema: string, table: string): void {
  if (isWriteDenied(schema, table)) throw new ToolRefusal(DENYLISTED)
}
