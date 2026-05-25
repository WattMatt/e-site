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

// --- parties --------------------------------------------------------------

export type PartyRole =
  | 'principal_agent' | 'employer' | 'guarantor' | 'subcontractor' | 'other'

export interface JbccParty {
  id: string
  project_id: string
  organisation_id: string
  party_role: PartyRole
  name: string
  company: string | null
  address: string | null
  email: string | null
  phone: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface CreatePartyInput {
  project_id: string
  organisation_id: string
  party_role: PartyRole
  name: string
  company?: string | null
  address?: string | null
  email?: string | null
  phone?: string | null
  created_by: string
}

export type UpdatePartyPatch = Partial<
  Omit<CreatePartyInput, 'project_id' | 'organisation_id' | 'created_by'>
>

export async function listParties(client: Client, projectId: string): Promise<JbccParty[]> {
  const { data, error } = await client
    .schema('projects')
    .from('jbcc_parties')
    .select('*')
    .eq('project_id', projectId)
    .order('party_role', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as JbccParty[]
}

export async function createParty(client: Client, input: CreatePartyInput): Promise<JbccParty> {
  const { data, error } = await client
    .schema('projects')
    .from('jbcc_parties')
    .insert(input)
    .select('*')
    .single()
  if (error) throw error
  return data as JbccParty
}

export async function updateParty(
  client: Client,
  id: string,
  patch: UpdatePartyPatch,
): Promise<JbccParty> {
  const { data, error } = await client
    .schema('projects')
    .from('jbcc_parties')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data as JbccParty
}

export async function deleteParty(client: Client, id: string): Promise<void> {
  const { error } = await client
    .schema('projects')
    .from('jbcc_parties')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// --- letters --------------------------------------------------------------

export type LetterStatus = 'draft' | 'issued' | 'served'
export type ServiceMethod = 'hand' | 'email' | 'registered_post'

export interface JbccLetter {
  id: string
  project_id: string
  organisation_id: string
  notice_id: string
  recipient_party_id: string | null
  status: LetterStatus
  field_values: Record<string, string>
  trigger_date: string | null
  deadline_date: string | null
  issued_date: string | null
  service_method: ServiceMethod | null
  served_date: string | null
  document_path: string
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface CreateLetterInput {
  id?: string
  project_id: string
  organisation_id: string
  notice_id: string
  recipient_party_id: string
  field_values: Record<string, string>
  trigger_date: string | null
  deadline_date: string | null
  document_path: string
  created_by: string
}

export async function createLetter(client: Client, input: CreateLetterInput): Promise<JbccLetter> {
  const { data, error } = await client
    .schema('projects')
    .from('jbcc_letters')
    .insert({ ...input, status: 'draft' })
    .select('*')
    .single()
  if (error) throw error
  return data as JbccLetter
}

export async function listLetters(
  client: Client,
  projectId: string,
): Promise<JbccLetter[]> {
  const { data, error } = await client
    .schema('projects')
    .from('jbcc_letters')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as JbccLetter[]
}

export async function getLetter(client: Client, id: string): Promise<JbccLetter | null> {
  const { data, error } = await client
    .schema('projects')
    .from('jbcc_letters')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as JbccLetter | null
}

export async function updateLetterStatus(
  client: Client,
  id: string,
  patch: {
    status?: LetterStatus
    issued_date?: string | null
    service_method?: ServiceMethod | null
    served_date?: string | null
    notes?: string | null
  },
): Promise<JbccLetter> {
  const { data, error } = await client
    .schema('projects')
    .from('jbcc_letters')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data as JbccLetter
}

export async function deleteLetter(client: Client, id: string): Promise<void> {
  const { error } = await client
    .schema('projects')
    .from('jbcc_letters')
    .delete()
    .eq('id', id)
  if (error) throw error
}
