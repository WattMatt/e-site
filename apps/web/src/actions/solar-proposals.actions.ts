'use server'
/**
 * Solar proposals (spec §9.3). Every action gates Solar Edit + financials FIRST (proposals are a
 * money table). Drafts are written through the caller's session — 00217's RLS and guard decide.
 * Issue / withdraw / new link run the SERVICE-ONLY definer functions after the gate (Task 21).
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseFinanceConfig } from '@esite/shared/solar-cases'
import { readSolarOrgSettings } from '@esite/shared'
import { FINANCE_OPTION_LABELS, PROPOSAL_FAMILY_ACCEPTED, defaultProposalDraft, parseProposalDraft, readProposalDraft, zar, zarCents, type FinanceOptionKind } from '@esite/shared/solar-reports'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'
import { createHash } from 'node:crypto'
import { rateLimit } from '@/lib/rate-limit'
import { prepareProposalSnapshot } from '@/lib/solar/proposals/prepare'
import { loadSolarBrandingData } from '@/lib/solar/reports/branding-loader'
import { solarBranding } from '@/lib/solar/reports/branding'
import { renderProposalPdf } from '@/lib/solar/reports/render-proposal'
import { newShareToken } from '@/lib/solar/proposals/token'
import { solarEmailEnabled } from '@/lib/solar/proposals/email-toggle'
import { sendProposalToClients } from '@/lib/solar/proposals/notify'
import { draftNarrative, narrativeAvailable, NO_KEY_REASON } from '@/lib/solar/proposals/narrative'

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

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.e-site.live').replace(/\/$/, '')
const proposalLink = (token: string) => `${siteUrl()}/proposal/${token}`
const NOT_FOUND = 'This proposal no longer exists — reload.'
const ISSUE_ERRORS: Record<string, string> = {
  stale: STALE_MESSAGE,
  not_draft: 'This proposal has already been issued — reload.',
  run_mismatch: 'The selected case’s run changed — preview the proposal again, then issue it.',
  invalid_expiry: 'Set a validity between 1 and 365 days.',
  family_accepted: PROPOSAL_FAMILY_ACCEPTED,
  not_found: NOT_FOUND,
}
const EMAIL_OFF = 'Solar emails are off for this project (Project settings, Integrations), so no email was sent.'

async function actorOf(svc: AnyClient, userId: string) {
  const { data } = await svc.from('profiles').select('full_name, email').eq('id', userId).maybeSingle()
  const p = data as { full_name?: string | null; email?: string | null } | null
  return { id: userId, name: p?.full_name?.trim() || 'Your proposer', email: p?.email ?? null }
}

export async function issueSolarProposalAction(input: {
  projectId: string; proposalId: string; expectedUpdatedAt: string; emailClientUserIds: string[]
}): Promise<{ ok: true; link: string; emailed: number; emailNote: string | null } | { error: string } | { error: string; fieldErrors: Record<string, string> }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  if (!rateLimit(`solar-issue:${g.userId}`, 5, 60_000)) return { error: 'Too many issues at once — wait a minute and try again.' }
  const { data: row } = await g.supabase.schema('solar').from('proposals')
    .select('id, project_id, organisation_id, family_id, version, status, case_id, draft, updated_at').eq('id', input.proposalId).eq('project_id', input.projectId).maybeSingle()
  const p = row as { id: string; organisation_id: string; family_id: string; version: number; status: string; case_id: string | null; draft: unknown; updated_at: string } | null
  if (!p) return { error: NOT_FOUND }
  if (p.status !== 'draft') return { error: ISSUE_ERRORS.not_draft! }
  if (p.updated_at !== input.expectedUpdatedAt) return { error: STALE_MESSAGE }

  const svc = createServiceClient() as unknown as AnyClient
  const actor = await actorOf(svc, g.userId)
  const prepared = await prepareProposalSnapshot({ user: g.supabase, svc, projectId: input.projectId, proposal: p, actor, issuedAt: new Date() })
  if (!prepared.ok) return prepared.fieldErrors ? { error: prepared.error, fieldErrors: prepared.fieldErrors } : { error: prepared.error }
  const snap = prepared.snapshot
  const brandData = await loadSolarBrandingData(svc, input.projectId)
  const { branding } = solarBranding(brandData, { title: 'Solar PV proposal', kicker: 'PROPOSAL', date: snap.proposal.issuedAt.slice(0, 10) })
  const pdf = new Uint8Array(await renderProposalPdf(snap, branding, { preview: false }))
  const sha = createHash('sha256').update(pdf).digest('hex')

  const path = `${p.organisation_id}/${input.projectId}/solar-proposals/${p.id}-v${p.version}.pdf`
  const { error: upErr } = await svc.storage.from('reports').upload(path, pdf, { contentType: 'application/pdf', upsert: false })
  if (upErr) return { error: 'Could not store the proposal PDF — try again.' }
  const { data: rep, error: repErr } = await svc.schema('projects').from('reports').insert({
    organisation_id: p.organisation_id,
    project_id: input.projectId,
    kind: 'solar_proposal',
    source_table: 'solar.proposals',
    source_id: p.id,
    title: `Solar proposal v${p.version} — ${snap.client.name}`,
    storage_path: path,
    mime_type: 'application/pdf',
    size_bytes: pdf.length,
    status: 'issued',
    version: p.version,
    summary: { kwp: Math.round(snap.system.dcKwp * 10) / 10, offer: zar(snap.price.offerExclVatZar), familyId: p.family_id },
    generated_by: g.userId,
  }).select('id')
  const reportId = Array.isArray(rep) ? (rep[0]?.id as string | undefined) : undefined
  if (repErr || !reportId) {
    await svc.storage.from('reports').remove([path])
    return { error: 'Could not save the proposal — try again.' }
  }

  const { token, hash } = newShareToken()
  const { data: res, error: rpcErr } = await svc.rpc('solar_issue_proposal', {
    p_proposal_id: p.id, p_expected_updated_at: p.updated_at, p_case_run_id: prepared.runId, p_snapshot: snap,
    p_pdf_path: path, p_pdf_sha256: sha, p_token_hash: hash, p_expires_at: snap.proposal.validUntil,
    p_report_id: reportId, p_actor: g.userId,
  })
  const out = res as { ok?: boolean; error?: string } | null
  if (rpcErr || !out?.ok) {
    await svc.storage.from('reports').remove([path])
    await svc.schema('projects').from('reports').delete().eq('id', reportId)
    return { error: ISSUE_ERRORS[out?.error ?? ''] ?? humanSolarError(rpcErr) }
  }

  // Supersede the family's earlier proposal PDF rows (the DB already withdrew their proposals).
  const { data: fam } = await g.supabase.schema('solar').from('proposals').select('id').eq('family_id', p.family_id)
  const famIds = ((fam ?? []) as Row[]).map((r) => String(r.id)).filter((id) => id !== p.id)
  if (famIds.length) {
    await svc.schema('projects').from('reports').update({ status: 'superseded', superseded_by: reportId })
      .eq('project_id', input.projectId).eq('kind', 'solar_proposal').eq('status', 'issued').in('source_id', famIds)
  }

  const link = proposalLink(token)
  let emailed = 0
  let emailNote: string | null = null
  const wanted = (input.emailClientUserIds ?? []).filter((id) => typeof id === 'string')
  if (wanted.length) {
    if (!(await solarEmailEnabled(input.projectId))) emailNote = EMAIL_OFF
    else {
      const { data: members } = await svc.schema('projects').from('project_members').select('user_id')
        .eq('project_id', input.projectId).eq('role', 'client_viewer').eq('is_active', true).in('user_id', wanted)
      const ids = ((members ?? []) as Row[]).map((m) => String(m.user_id))
      const { data: profs } = ids.length ? await svc.from('profiles').select('id, email').in('id', ids) : { data: [] }
      const emails = ((profs ?? []) as Row[]).map((x) => x.email).filter((e): e is string => typeof e === 'string' && e.includes('@'))
      emailed = await sendProposalToClients({ emails, projectName: snap.project.name, orgName: snap.issuer.orgName, link, validUntil: snap.proposal.validUntil, accent: brandData.projectAccent ?? brandData.orgAccent })
    }
  }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'proposal_issued', objectRef: { proposalId: p.id, version: p.version } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_proposal_issued', properties: { version: p.version, emailed } })
  revalidate(input.projectId)
  return { ok: true, link, emailed, emailNote }
}

async function visibleProposal(supabase: AnyClient, projectId: string, proposalId: string): Promise<{ id: string; version: number } | null> {
  const { data } = await supabase.schema('solar').from('proposals').select('id, version').eq('id', proposalId).eq('project_id', projectId).maybeSingle()
  return (data as { id: string; version: number } | null) ?? null
}

export async function withdrawSolarProposalAction(input: { projectId: string; proposalId: string }): Promise<{ ok: true } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const p = await visibleProposal(g.supabase, input.projectId, input.proposalId)
  if (!p) return { error: NOT_FOUND }
  const svc = createServiceClient() as unknown as AnyClient
  const { data, error } = await svc.rpc('solar_withdraw_proposal', { p_proposal_id: p.id, p_actor: g.userId })
  const out = data as { ok?: boolean; error?: string } | null
  if (error || !out?.ok) return { error: out?.error === 'not_live' ? 'Only an issued proposal can be withdrawn.' : humanSolarError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'proposal_withdrawn', objectRef: { proposalId: p.id, version: p.version } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_proposal_withdrawn' })
  revalidate(input.projectId)
  return { ok: true }
}

export async function newSolarProposalLinkAction(input: { projectId: string; proposalId: string }): Promise<{ ok: true; link: string } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const p = await visibleProposal(g.supabase, input.projectId, input.proposalId)
  if (!p) return { error: NOT_FOUND }
  const { token, hash } = newShareToken()
  const svc = createServiceClient() as unknown as AnyClient
  const { data, error } = await svc.rpc('solar_rotate_proposal_link', { p_proposal_id: p.id, p_token_hash: hash, p_actor: g.userId })
  const out = data as { ok?: boolean; error?: string } | null
  if (error || !out?.ok) return { error: out?.error === 'not_live' ? 'Only a live (issued, unexpired) proposal can get a new link.' : humanSolarError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'proposal_link_rotated', objectRef: { proposalId: p.id, version: p.version } })
  revalidate(input.projectId)
  return { ok: true, link: proposalLink(token) }
}

/**
 * Optional AI narrative (D-17, owner decision). Only the proposal's figures (computed from the
 * selected case's STORED run by the same builder as Issue) and the project/client names are sent.
 * The text is saved into the draft, stale-guarded, and stays editable.
 */
export async function draftSolarProposalNarrativeAction(input: { projectId: string; proposalId: string; expectedUpdatedAt: string }):
  Promise<{ ok: true; narrative: string; updatedAt: string } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  if (!narrativeAvailable()) return { error: NO_KEY_REASON }
  const { data: row } = await g.supabase.schema('solar').from('proposals')
    .select('id, organisation_id, family_id, version, status, case_id, draft, updated_at').eq('id', input.proposalId).eq('project_id', input.projectId).maybeSingle()
  const p = row as { id: string; organisation_id: string; family_id: string; version: number; status: string; case_id: string | null; draft: unknown; updated_at: string } | null
  if (!p) return { error: NOT_FOUND }
  if (p.status !== 'draft') return { error: 'Only a draft can be changed.' }
  if (!rateLimit(`solar-narrative:${p.organisation_id}`, 10, 10 * 60_000)) return { error: 'Too many AI drafts for your organisation — try again in a few minutes.' }
  const svc = createServiceClient() as unknown as AnyClient
  const prepared = await prepareProposalSnapshot({ user: g.supabase, svc, projectId: input.projectId, proposal: p, actor: await actorOf(svc, g.userId), issuedAt: new Date() })
  if (!prepared.ok) return { error: prepared.error }
  const s = prepared.snapshot
  const r = await draftNarrative({
    projectName: s.project.name, clientName: s.client.name,
    dcKwp: s.system.dcKwp, acKw: s.system.acKw, batteryKwh: s.system.batteryKwh,
    year1Mwh: Math.round(s.system.year1PvKwh / 100) / 10, solarSharePct: Math.round(s.system.solarFraction * 1000) / 10,
    offerExclVat: zarCents(s.price.offerExclVatZar),
    financeOptions: s.financeOptions.map((o) => FINANCE_OPTION_LABELS[o.kind]),
  })
  if (!r.ok) return { error: r.error }
  const draft = { ...readProposalDraft(p.draft), narrative: r.text }
  const { data, error } = await g.supabase.schema('solar').from('proposals').update({ draft })
    .eq('id', p.id).eq('project_id', input.projectId).eq('status', 'draft').eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_narrative_drafted' })
  revalidate(input.projectId)
  return { ok: true, narrative: r.text, updatedAt: String((data[0] as Row).updated_at) }
}
