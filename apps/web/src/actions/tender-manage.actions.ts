'use server'

/**
 * WM-side tender management for slice C: requirements, clarifications and
 * addenda, and the submissions overview. Gated on ORG_WRITE_ROLES for the
 * tender's project; every table access runs under row security, so the
 * overview can only ever show WHO submitted and WHEN — the prices and the
 * documents stay sealed in the database until the closing time.
 */

import { revalidatePath } from 'next/cache'
import { gateTender } from '@/lib/tender/gate'

type Result<T> = { data: T } | { error: string }

function bust(projectId: string, tenderId: string) {
  revalidatePath(`/projects/${projectId}/tenders/${tenderId}`, 'page')
}

export interface RequirementInput {
  kind: 'document' | 'declaration'
  label: string
  detail?: string | null
  mandatory: boolean
}

export async function addRequirementAction(tenderId: string, r: RequirementInput): Promise<Result<true>> {
  if (r.kind !== 'document' && r.kind !== 'declaration') return { error: 'Choose document or declaration' }
  if (!r.label?.trim()) return { error: 'Give the requirement a label' }
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  if (g.tender.status !== 'draft') return { error: 'Requirements are frozen once the tender is issued (publish an addendum instead)' }
  const sb = g.supabase.schema('projects')
  const { count } = await sb.from('tender_requirements').select('id', { count: 'exact', head: true }).eq('tender_id', tenderId)
  const { error } = await sb.from('tender_requirements').insert({
    tender_id: tenderId,
    kind: r.kind,
    label: r.label.trim().slice(0, 300),
    detail: r.detail?.trim() || null,
    mandatory: !!r.mandatory,
    sort_order: count ?? 0,
  })
  if (error) return { error: error.message }
  bust(g.tender.project_id, tenderId)
  return { data: true }
}

export async function removeRequirementAction(tenderId: string, requirementId: string): Promise<Result<true>> {
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  if (g.tender.status !== 'draft') return { error: 'Requirements are frozen once the tender is issued' }
  const { data, error } = await g.supabase
    .schema('projects')
    .from('tender_requirements')
    .delete()
    .eq('id', requirementId)
    .eq('tender_id', tenderId)
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'Nothing was removed' }
  bust(g.tender.project_id, tenderId)
  return { data: true }
}

export interface RequirementRow { id: string; kind: string; label: string; detail: string | null; mandatory: boolean }

export interface ClarificationRow {
  id: string
  kind: 'question' | 'addendum'
  title: string
  body: string
  answer: string | null
  published_at: string | null
  created_at: string
  company: string | null
}

export interface SubmissionRow {
  participantId: string
  company: string
  profileComplete: boolean
  status: 'not started' | 'draft' | 'submitted'
  submittedAt: string | null
  submissionCount: number
  acknowledgedAddenda: number
}

export async function getTenderManagementAction(tenderId: string): Promise<Result<{
  requirements: RequirementRow[]
  clarifications: ClarificationRow[]
  submissions: SubmissionRow[]
  publishedAddenda: number
}>> {
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  const sb = g.supabase.schema('projects')
  const [{ data: reqs }, { data: clar }, { data: parts }, { data: subs }, { data: acks }] = await Promise.all([
    sb.from('tender_requirements').select('id, kind, label, detail, mandatory').eq('tender_id', tenderId).order('sort_order'),
    sb.from('tender_clarifications').select('id, kind, title, body, answer, published_at, created_at, participant_id').eq('tender_id', tenderId).order('created_at'),
    sb.from('tender_participants').select('id, company_name, profile_completed_at').eq('tender_id', tenderId).order('created_at'),
    // Status and time only. tender_submissions carries no prices by design.
    sb.from('tender_submissions').select('participant_id, status, submitted_at, submission_count').eq('tender_id', tenderId),
    sb.from('tender_addendum_acks').select('participant_id, clarification_id'),
  ])
  const companyOf = new Map((parts ?? []).map((p: { id: string; company_name: string }) => [p.id, p.company_name]))
  const subOf = new Map((subs ?? []).map((s: { participant_id: string }) => [s.participant_id, s]))
  const addendumIds = new Set((clar ?? []).filter((c: { kind: string; published_at: string | null }) => c.kind === 'addendum' && c.published_at).map((c: { id: string }) => c.id))
  const ackCount = new Map<string, number>()
  for (const a of (acks ?? []) as { participant_id: string; clarification_id: string }[]) {
    if (addendumIds.has(a.clarification_id)) ackCount.set(a.participant_id, (ackCount.get(a.participant_id) ?? 0) + 1)
  }
  return {
    data: {
      requirements: (reqs ?? []) as RequirementRow[],
      clarifications: (clar ?? []).map((c: ClarificationRow & { participant_id: string | null }) => ({
        id: c.id, kind: c.kind, title: c.title, body: c.body, answer: c.answer, published_at: c.published_at, created_at: c.created_at,
        company: c.participant_id ? companyOf.get(c.participant_id) ?? null : null,
      })),
      submissions: (parts ?? []).map((p: { id: string; company_name: string; profile_completed_at: string | null }) => {
        const s = subOf.get(p.id) as { status: 'draft' | 'submitted'; submitted_at: string | null; submission_count: number } | undefined
        return {
          participantId: p.id,
          company: p.company_name,
          profileComplete: !!p.profile_completed_at,
          status: s ? s.status : 'not started',
          submittedAt: s?.submitted_at ?? null,
          submissionCount: s?.submission_count ?? 0,
          acknowledgedAddenda: ackCount.get(p.id) ?? 0,
        }
      }),
      publishedAddenda: addendumIds.size,
    },
  }
}

/**
 * Answer a bidder's question. Publishing makes the question and answer visible
 * to every bidder (the asker's company is never shown to the others).
 */
export async function answerClarificationAction(tenderId: string, clarificationId: string, answer: string, publish: boolean): Promise<Result<true>> {
  if (!answer.trim()) return { error: 'Write an answer' }
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  const { data, error } = await g.supabase
    .schema('projects')
    .from('tender_clarifications')
    .update({ answer: answer.trim(), published_at: publish ? new Date().toISOString() : null })
    .eq('id', clarificationId)
    .eq('tender_id', tenderId)
    .eq('kind', 'question')
    .select('id')
  if (error) return { error: error.code === '55000' ? 'That answer was already published to every bidder, so it is final. Publish an addendum instead.' : 'Could not save the answer. Try again.' }
  if (!data || data.length === 0) return { error: 'Nothing was changed' }
  bust(g.tender.project_id, tenderId)
  return { data: true }
}

/** An addendum is published at once; every bidder must acknowledge it before they can submit. */
export async function publishAddendumAction(tenderId: string, title: string, body: string): Promise<Result<true>> {
  if (!title.trim() || !body.trim()) return { error: 'An addendum needs a title and its text' }
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  if (g.tender.status !== 'issued') return { error: 'Addenda are for an issued tender that has not closed' }
  const { error } = await g.supabase.schema('projects').from('tender_clarifications').insert({
    tender_id: tenderId, kind: 'addendum', title: title.trim().slice(0, 200), body: body.trim(), published_at: new Date().toISOString(),
  })
  if (error) return { error: error.code === '55000' ? 'The closing time has passed: no addendum can be published now.' : 'Could not publish the addendum. Try again.' }
  bust(g.tender.project_id, tenderId)
  return { data: true }
}
