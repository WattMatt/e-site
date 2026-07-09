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

export type LetterStatus =
  | 'draft' | 'in_review' | 'approved' | 'issued' | 'served' | 'superseded' | 'withdrawn'
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
  // ISO 9001 controlled-document fields (migration 00170)
  letter_reference: string | null
  subject: string | null
  revision: number
  supersedes_letter_id: string | null
  superseded_by_letter_id: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  approved_by: string | null
  approved_at: string | null
  issued_by: string | null
  issued_at: string | null
  served_by: string | null
  served_at: string | null
  service_reference: string | null
  deemed_service_date: string | null
  proof_attachment_id: string | null
  deleted_at: string | null
  retention_until: string | null
  legal_hold: boolean
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
  subject?: string | null
  revision?: number
  supersedes_letter_id?: string | null
}

/** Forward-only status transitions — mirrors projects.jbcc_status_can_transition. */
const LETTER_TRANSITIONS: Record<LetterStatus, LetterStatus[]> = {
  draft:      ['in_review', 'approved', 'issued', 'withdrawn'],
  in_review:  ['approved', 'draft', 'withdrawn'],
  approved:   ['issued', 'in_review', 'draft', 'withdrawn'],
  issued:     ['served', 'superseded'],
  served:     ['superseded'],
  superseded: [],
  withdrawn:  [],
}

export function canTransitionLetter(from: LetterStatus, to: LetterStatus): boolean {
  return LETTER_TRANSITIONS[from]?.includes(to) ?? false
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

// --- letter attachments ---------------------------------------------------

export interface JbccLetterAttachment {
  id: string
  letter_id: string
  organisation_id: string
  file_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number | null
  created_by: string
  created_at: string
}

export async function listLetterAttachments(
  client: Client,
  letterId: string,
): Promise<JbccLetterAttachment[]> {
  const { data, error } = await client
    .schema('projects')
    .from('jbcc_letter_attachments')
    .select('*')
    .eq('letter_id', letterId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as JbccLetterAttachment[]
}

export async function createLetterAttachment(client: Client, input: {
  letter_id: string
  organisation_id: string
  file_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number | null
  created_by: string
}): Promise<JbccLetterAttachment> {
  const { data, error } = await client
    .schema('projects')
    .from('jbcc_letter_attachments')
    .insert(input)
    .select('*')
    .single()
  if (error) throw error
  return data as JbccLetterAttachment
}

export async function deleteLetterAttachment(client: Client, id: string): Promise<void> {
  const { error } = await client
    .schema('projects')
    .from('jbcc_letter_attachments')
    .delete()
    .eq('id', id)
  if (error) throw error
}

/** Letter detail needs the notice by id (not by code) since the letter stores notice_id. */
export async function getNoticeById(client: Client, id: string): Promise<JbccNotice | null> {
  const { data, error } = await client
    .schema('projects')
    .from('jbcc_notices')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as JbccNotice | null
}

// ---------------------------------------------------------------------------
// ISO 9001 lifecycle: audit events, controlled transitions, supersede, retention
// ---------------------------------------------------------------------------

export type LetterEventType =
  | 'created' | 'submitted_for_review' | 'approved' | 'issued' | 'served'
  | 'superseded' | 'withdrawn' | 'reverted_to_draft' | 'attachment_added'
  | 'attachment_removed' | 'legal_hold_set' | 'legal_hold_cleared' | 'soft_deleted' | 'note'

export interface JbccLetterEvent {
  id: string
  letter_id: string
  organisation_id: string
  event_type: LetterEventType
  from_status: LetterStatus | null
  to_status: LetterStatus | null
  actor_id: string
  occurred_at: string
  metadata: Record<string, unknown>
}

/** Append an immutable audit-trail event (ISO 7.5.3 change control). */
export async function logLetterEvent(client: Client, input: {
  letter_id: string
  organisation_id: string
  event_type: LetterEventType
  from_status?: LetterStatus | null
  to_status?: LetterStatus | null
  actor_id: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const { error } = await client
    .schema('projects')
    .from('jbcc_letter_events')
    .insert({
      letter_id:       input.letter_id,
      organisation_id: input.organisation_id,
      event_type:      input.event_type,
      from_status:     input.from_status ?? null,
      to_status:       input.to_status ?? null,
      actor_id:        input.actor_id,
      metadata:        input.metadata ?? {},
    })
  if (error) throw error
}

export async function listLetterEvents(client: Client, letterId: string): Promise<JbccLetterEvent[]> {
  const { data, error } = await client
    .schema('projects')
    .from('jbcc_letter_events')
    .select('*')
    .eq('letter_id', letterId)
    .order('occurred_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as JbccLetterEvent[]
}

/** Patch a letter's lifecycle columns (status + actor/date stamps). */
export async function transitionLetter(client: Client, id: string, patch: {
  status?: LetterStatus
  reviewed_by?: string | null
  reviewed_at?: string | null
  approved_by?: string | null
  approved_at?: string | null
  issued_by?: string | null
  issued_at?: string | null
  issued_date?: string | null
  served_by?: string | null
  served_at?: string | null
  served_date?: string | null
  service_method?: ServiceMethod | null
  service_reference?: string | null
  deemed_service_date?: string | null
  proof_attachment_id?: string | null
  superseded_by_letter_id?: string | null
  notes?: string | null
  deleted_at?: string | null
  legal_hold?: boolean
}): Promise<JbccLetter> {
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

// ---------------------------------------------------------------------------
// Distribution list (to / cc) with a name snapshot for provenance
// ---------------------------------------------------------------------------

export interface JbccLetterRecipient {
  id: string
  letter_id: string
  organisation_id: string
  party_id: string | null
  party_name_snapshot: string
  disposition: 'to' | 'cc'
  created_at: string
}

export async function addLetterRecipient(client: Client, input: {
  letter_id: string
  organisation_id: string
  party_id: string | null
  party_name_snapshot: string
  disposition: 'to' | 'cc'
}): Promise<JbccLetterRecipient> {
  const { data, error } = await client
    .schema('projects')
    .from('jbcc_letter_recipients')
    .insert(input)
    .select('*')
    .single()
  if (error) throw error
  return data as JbccLetterRecipient
}

/** Update draft content (field_values / subject / document_path). The DB
 * immutability trigger rejects this once the letter has left 'draft'. */
export async function updateLetterContent(client: Client, id: string, patch: {
  field_values?: Record<string, string>
  subject?: string | null
  document_path?: string
}): Promise<JbccLetter> {
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

export async function listLetterRecipients(client: Client, letterId: string): Promise<JbccLetterRecipient[]> {
  const { data, error } = await client
    .schema('projects')
    .from('jbcc_letter_recipients')
    .select('*')
    .eq('letter_id', letterId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as JbccLetterRecipient[]
}
