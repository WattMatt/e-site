import type { SupabaseClient } from '@supabase/supabase-js'

type Client = SupabaseClient<any>

// --- DTOs -----------------------------------------------------------------

export interface JbccNotice {
  id: string
  code: string
  title: string
  category: string
  triggering_clause: string
  contract: string
  edition: string
  time_bar_text: string
  time_bar_days: number | null
  time_bar_unit: 'WD' | 'CD' | null
  time_bar_basis: string | null
  from_party: string
  to_party: string
  purpose: string
  consequence_of_failure: string
  template_file: string
  sort_order: number
}

export interface JbccNoticeField {
  id: string
  notice_id: string
  placeholder: string
  label: string
  field_type: 'text' | 'textarea' | 'date' | 'number'
  source: 'recipient' | 'sender' | 'manual'
  required: boolean
  sort_order: number
}

export interface JbccClause {
  id: string
  clause_ref: string
  contract: string
  edition: string
  topic: string
  description: string
  practical_use: string | null
  time_bar: string | null
  triggering_event: string | null
  linked_notice: string | null
  consequence_of_failure: string | null
  sort_order: number
}

export interface JbccTimeBar {
  id: string
  clause: string
  time_period: string
  parties: string
  action: string
  sort_order: number
}

// --- reference reads ------------------------------------------------------

export async function listNotices(client: Client): Promise<JbccNotice[]> {
  const { data, error } = await client
    .schema('projects')
    .from('jbcc_notices')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as JbccNotice[]
}

export async function getNotice(client: Client, code: string): Promise<JbccNotice | null> {
  const { data, error } = await client
    .schema('projects')
    .from('jbcc_notices')
    .select('*')
    .eq('code', code)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as JbccNotice | null
}

export async function getNoticeFields(
  client: Client,
  noticeId: string,
): Promise<JbccNoticeField[]> {
  const { data, error } = await client
    .schema('projects')
    .from('jbcc_notice_fields')
    .select('*')
    .eq('notice_id', noticeId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as JbccNoticeField[]
}

export async function listClauses(client: Client): Promise<JbccClause[]> {
  const { data, error } = await client
    .schema('projects')
    .from('jbcc_clauses')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as JbccClause[]
}

export async function listTimeBars(client: Client): Promise<JbccTimeBar[]> {
  const { data, error } = await client
    .schema('projects')
    .from('jbcc_time_bar_schedule')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as JbccTimeBar[]
}
