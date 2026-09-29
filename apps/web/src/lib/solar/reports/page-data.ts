import 'server-only'
/** Reports & Proposal tab view model (spec §9). JSON only; money parts empty below Edit + financials. */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SolarAccessLevel } from '@esite/shared'
import {
  effectiveProposalStatus, proposalControls, readProposalDraft, zarCents,
  type EffectiveProposalStatus, type ProposalControls, type ProposalDraft, type ProposalStatus,
} from '@esite/shared/solar-reports'
import { latestMoney } from '@/lib/solar/cases/page-data'
import { solarEmailEnabled } from '@/lib/solar/proposals/email-toggle'
import { narrativeStatus } from '@/lib/solar/proposals/narrative'
import { loadSelectedCase } from './selected-case'
import { REPORT_ERRORS } from './generate'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export interface ProposalEventView {
  kind: string; via: string; at: string; actorName: string | null; actorEmail: string | null
  ip: string | null; userAgent: string | null; pdfSha256: string | null; authority: boolean | null; reason: string | null; hasSignature: boolean
}
export interface ProposalListItem {
  id: string; familyId: string; version: number; status: ProposalStatus; effectiveStatus: EffectiveProposalStatus
  expiresAt: string | null; issuedAt: string | null; updatedAt: string; draft: ProposalDraft
  offerExclVat: string | null; controls: ProposalControls; events: ProposalEventView[]
}
export type SelectedCaseView = { ok: true; caseId: string; caseName: string; runId: string } | { ok: false; stale: boolean; reason: string }
export interface ReportsPageData {
  level: SolarAccessLevel
  selected: SelectedCaseView
  feasibility: { ok: boolean; reason: string | null }
  layoutSheet: { available: boolean; reason: string | null }
  proposals: ProposalListItem[]
  clientContacts: Array<{ userId: string; name: string; email: string }>
  narrative: { available: boolean; reason: string | null }
  emailEnabled: boolean
}

export async function loadReportsPageData(user: AnyClient, svc: AnyClient, projectId: string, level: SolarAccessLevel): Promise<ReportsPageData> {
  const money = level === 'edit_financials'
  const sel = await loadSelectedCase(user, svc, projectId)
  const selected: SelectedCaseView = sel.ok
    ? { ok: true, caseId: sel.caseRow.id, caseName: sel.caseRow.name, runId: sel.run.id }
    : { ok: false, stale: sel.stale, reason: sel.reason }

  let feasibility: ReportsPageData['feasibility'] = { ok: false, reason: null }
  if (money && sel.ok) {
    const fin = (await latestMoney(user, [sel.caseRow.id])).get(sel.caseRow.id) as Row | undefined
    feasibility = fin && fin.case_run_id === sel.run.id ? { ok: true, reason: null } : { ok: false, reason: REPORT_ERRORS.noFinancials }
  }

  let layoutSheet: ReportsPageData['layoutSheet'] = { available: false, reason: 'Choose a selected case first.' }
  if (sel.ok) {
    if (sel.caseRow.pv_source !== 'layout' || !sel.caseRow.layout_id) layoutSheet = { available: false, reason: 'This case uses a manual system size.' }
    else {
      const { data } = await user.schema('projects').from('reports').select('id').eq('project_id', projectId)
        .eq('kind', 'solar_layout_sheet').eq('source_id', sel.caseRow.layout_id).eq('status', 'issued').limit(1)
      layoutSheet = Array.isArray(data) && data.length ? { available: true, reason: null } : { available: false, reason: REPORT_ERRORS.noSheet }
    }
  }

  let proposals: ProposalListItem[] = []
  let clientContacts: ReportsPageData['clientContacts'] = []
  if (money) {
    const { data: rows } = await user.schema('solar').from('proposals')
      .select('id, family_id, version, status, expires_at, issued_at, updated_at, draft, snapshot, created_at').eq('project_id', projectId).order('created_at', { ascending: false })
    const list = (rows ?? []) as Row[]
    const ids = list.map((r) => String(r.id))
    const { data: evs } = ids.length
      ? await user.schema('solar').from('proposal_events').select('proposal_id, kind, via, at, actor_name, actor_email, ip, user_agent, pdf_sha256, authority_confirmed, reason, signature_png').in('proposal_id', ids).order('at', { ascending: true })
      : { data: [] }
    const now = Date.now()
    const byFamily = new Map<string, Row[]>()
    for (const r of list) byFamily.set(String(r.family_id), [...(byFamily.get(String(r.family_id)) ?? []), r])
    // Family, then version descending — a family's draft (the newest version) comes first.
    proposals = [...list]
      .sort((a, b) => String(a.family_id).localeCompare(String(b.family_id)) || Number(b.version) - Number(a.version))
      .map((r) => {
        const fam = byFamily.get(String(r.family_id)) ?? []
        const status = r.status as ProposalStatus
        const expiresAt = (r.expires_at as string | null) ?? null
        const price = (r.snapshot as { price?: { offerExclVatZar?: number } } | null)?.price?.offerExclVatZar
        return {
          id: String(r.id), familyId: String(r.family_id), version: Number(r.version), status,
          effectiveStatus: effectiveProposalStatus(status, expiresAt, now),
          expiresAt, issuedAt: (r.issued_at as string | null) ?? null, updatedAt: String(r.updated_at),
          draft: readProposalDraft(r.draft),
          offerExclVat: typeof price === 'number' ? zarCents(price) : null,
          controls: proposalControls({
            status, expiresAt,
            isLatest: Number(r.version) === Math.max(...fam.map((f) => Number(f.version))),
            familyHasDraft: fam.some((f) => f.status === 'draft'),
            familyHasAccepted: fam.some((f) => f.status === 'accepted'),
          }, now),
          events: ((evs ?? []) as Row[]).filter((e) => e.proposal_id === r.id).map((e) => ({
            kind: String(e.kind), via: String(e.via), at: String(e.at),
            actorName: (e.actor_name as string | null) ?? null, actorEmail: (e.actor_email as string | null) ?? null,
            ip: (e.ip as string | null) ?? null, userAgent: (e.user_agent as string | null) ?? null,
            pdfSha256: (e.pdf_sha256 as string | null) ?? null, authority: (e.authority_confirmed as boolean | null) ?? null,
            reason: (e.reason as string | null) ?? null, hasSignature: typeof e.signature_png === 'string',
          })),
        }
      })
    const { data: members } = await svc.schema('projects').from('project_members').select('user_id')
      .eq('project_id', projectId).eq('role', 'client_viewer').eq('is_active', true)
    const cids = ((members ?? []) as Row[]).map((m) => String(m.user_id))
    const { data: profs } = cids.length ? await svc.from('profiles').select('id, full_name, email').in('id', cids) : { data: [] }
    clientContacts = ((profs ?? []) as Row[])
      .filter((p) => typeof p.email === 'string')
      .map((p) => ({ userId: String(p.id), name: ((p.full_name as string | null) ?? '').trim() || String(p.email), email: String(p.email) }))
  }

  const n = narrativeStatus()
  return {
    level, selected, feasibility, layoutSheet, proposals, clientContacts,
    narrative: { available: n.narrativeAvailable, reason: n.narrativeReason },
    emailEnabled: money ? await solarEmailEnabled(projectId) : false,
  }
}
