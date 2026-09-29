'use server'
/**
 * Solar proposals (spec §9.3). Every action gates Solar Edit + financials FIRST (proposals are a
 * money table). Drafts are written through the caller's session — 00216's RLS and guard decide.
 * Issue / withdraw / new link run the SERVICE-ONLY definer functions after the gate (Task 21).
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseFinanceConfig } from '@esite/shared/solar-cases'
import { readSolarOrgSettings } from '@esite/shared'
import { defaultProposalDraft, parseProposalDraft, readProposalDraft, type FinanceOptionKind } from '@esite/shared/solar-reports'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

const NO_SELECTION = 'Choose a selected case on the Overview first.'
const revalidate = (projectId: string) => revalidatePath(`/projects/${projectId}/solar`, 'layout')

async function gate(projectId: string): Promise<{ supabase: AnyClient; userId: string } | { error: string }> {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, 'edit_financials', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  return { supabase, userId: user.id }
}

async function selectedCase(supabase: AnyClient, projectId: string): Promise<{ studyId: string; orgId: string; caseId: string } | null> {
  const { data } = await supabase.schema('solar').from('studies').select('id, organisation_id, selected_case_id').eq('project_id', projectId).maybeSingle()
  const s = data as Row | null
  if (!s?.selected_case_id) return null
  return { studyId: String(s.id), orgId: String(s.organisation_id ?? ''), caseId: String(s.selected_case_id) }
}

export async function createSolarProposalAction(input: { projectId: string }): Promise<{ ok: true; proposalId: string } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const sel = await selectedCase(g.supabase, input.projectId)
  if (!sel) return { error: NO_SELECTION }
  const svc = createServiceClient() as unknown as AnyClient
  const [{ data: proj }, { data: finRows }, { data: os }, { data: tpl }] = await Promise.all([
    g.supabase.schema('projects').from('projects').select('client_name').eq('id', input.projectId).maybeSingle(),
    g.supabase.schema('solar').from('case_financials').select('config').eq('case_id', sel.caseId),
    svc.schema('solar').from('org_settings').select('settings').eq('organisation_id', sel.orgId).maybeSingle(),
    svc.schema('solar').from('proposal_templates').select('terms_text, validity_days').eq('organisation_id', sel.orgId).maybeSingle(),
  ])
  const finRow = Array.isArray(finRows) ? (finRows[0] as Row | undefined) : undefined
  const fin = finRow ? parseFinanceConfig(finRow.config) : null
  const models = (fin?.ok ? fin.fin.models : (finRow?.config as { models?: Record<string, { enabled?: boolean }> } | undefined)?.models) ?? {}
  const enabledKinds = (['cash', 'debt', 'ppa', 'lease'] as FinanceOptionKind[]).filter((k) => (models as Record<string, { enabled?: boolean }>)[k]?.enabled)
  const margin = readSolarOrgSettings((os as Row | null)?.settings ?? null).rc_margin_pct
  const t = tpl as Row | null
  const draft = defaultProposalDraft({
    clientName: ((proj as Row | null)?.client_name as string | null) ?? null,
    marginPct: typeof margin === 'number' ? margin : null,
    validityDays: typeof t?.validity_days === 'number' ? (t.validity_days as number) : null,
    termsText: (t?.terms_text as string | null) ?? null,
    enabledKinds,
  })
  const { data, error } = await g.supabase.schema('solar').from('proposals')
    .insert({ study_id: sel.studyId, case_id: sel.caseId, draft }).select('id, version')
  if (error) return { error: humanSolarError(error) }
  const row = Array.isArray(data) ? (data[0] as Row | undefined) : undefined
  if (!row?.id) return { error: humanSolarError(null) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'proposal_created', objectRef: { proposalId: row.id, version: row.version } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_proposal_created' })
  revalidate(input.projectId)
  return { ok: true, proposalId: String(row.id) }
}

export async function saveSolarProposalDraftAction(input: { projectId: string; proposalId: string; draft: unknown; expectedUpdatedAt: string }):
  Promise<{ ok: true; updatedAt: string } | { error: string } | { fieldErrors: Record<string, string> }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const d = parseProposalDraft(input.draft)
  if (!d.ok) return { fieldErrors: d.errors }
  const sel = await selectedCase(g.supabase, input.projectId)
  if (!sel) return { error: NO_SELECTION }
  const { data, error } = await g.supabase.schema('solar').from('proposals')
    .update({ draft: d.draft, case_id: sel.caseId })
    .eq('id', input.proposalId).eq('project_id', input.projectId).eq('status', 'draft').eq('updated_at', input.expectedUpdatedAt)
    .select('updated_at')
  if (error) return { error: humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  revalidate(input.projectId)
  return { ok: true, updatedAt: String((data[0] as Row).updated_at) }
}

export async function deleteSolarProposalDraftAction(input: { projectId: string; proposalId: string }): Promise<{ ok: true } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const { data, error } = await g.supabase.schema('solar').from('proposals')
    .delete().eq('id', input.proposalId).eq('project_id', input.projectId).eq('status', 'draft').select('id')
  if (error) return { error: humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: 'Only a draft can be deleted — withdraw an issued proposal instead.' }
  revalidate(input.projectId)
  return { ok: true }
}

export async function reviseSolarProposalAction(input: { projectId: string; proposalId: string }): Promise<{ ok: true; proposalId: string; version: number } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const { data: src } = await g.supabase.schema('solar').from('proposals')
    .select('id, study_id, family_id, version, status, draft').eq('id', input.proposalId).eq('project_id', input.projectId).maybeSingle()
  const s = src as Row | null
  if (!s) return { error: 'This proposal no longer exists — reload.' }
  if (s.status === 'draft') return { error: 'Edit the draft instead of revising it.' }
  const sel = await selectedCase(g.supabase, input.projectId)
  if (!sel) return { error: NO_SELECTION }
  const { data, error } = await g.supabase.schema('solar').from('proposals')
    .insert({ study_id: s.study_id, family_id: s.family_id, case_id: sel.caseId, draft: readProposalDraft(s.draft) }).select('id, version')
  if (error) {
    if (error.code === '23505') return { error: 'A draft of this proposal already exists — edit it instead.' }
    if (error.code === '23514' && /accepted/.test(error.message ?? '')) return { error: 'An accepted proposal cannot be revised.' }
    return { error: humanSolarError(error) }
  }
  const row = Array.isArray(data) ? (data[0] as Row | undefined) : undefined
  if (!row?.id) return { error: humanSolarError(null) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'proposal_created', objectRef: { proposalId: row.id, version: row.version } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_proposal_created' })
  revalidate(input.projectId)
  return { ok: true, proposalId: String(row.id), version: Number(row.version) }
}
