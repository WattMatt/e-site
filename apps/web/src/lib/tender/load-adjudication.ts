import 'server-only'
import { gateTender, type AnyClient } from '@/lib/tender/gate'
import { adjudicate, type AdjBid, type AdjItem, type Adjudication, type AdjCompliance, type AdjRequirement } from './adjudication'

export interface AdjudicationLoad {
  adjudication: Adjudication
  tender: { id: string; project_id: string; package: string; title: string; status: string; closing_at: string | null }
  projectName: string
  draftsAtClosing: string[]
}

/**
 * Load everything adjudication needs through the MANAGER'S OWN session. The
 * prices and documents come back only because the database lifts the seal at
 * closing_at; before that this refuses rather than showing an empty grid.
 * Only submitted bids are adjudicated; a draft still open at closing is listed.
 */
export async function loadAdjudication(tenderId: string): Promise<{ ok: true; data: AdjudicationLoad } | { ok: false; error: string }> {
  const g = await gateTender(tenderId)
  if (!g.ok) return g
  const sb = (g.supabase as AnyClient).schema('projects')
  const { data: lifted } = await sb.rpc('tender_seal_lifted', { p_tender_id: tenderId })
  if (!lifted) return { ok: false, error: 'Bids are sealed until the closing time.' }

  const [items, est, parts, subs, reqs, proj] = await Promise.all([
    sb.from('tender_boq_items').select('id, sheet_name, row_number, bill_code, code, description, unit, quantity, rate_cell_type, fixed_amount, kind').eq('tender_id', tenderId).eq('kind', 'item').order('sort_order').range(0, 19999),
    sb.from('tender_estimate_lines').select('item_id, rate, amount').eq('tender_id', tenderId).range(0, 19999),
    sb.from('tender_participants').select('id, company_name, cidb_grade, bbbee_level, registration_number, vat_number').eq('tender_id', tenderId),
    sb.from('tender_submissions').select('id, participant_id, status, submitted_at, declarations').eq('tender_id', tenderId),
    sb.from('tender_requirements').select('id, kind, label, mandatory').eq('tender_id', tenderId).order('sort_order'),
    sb.from('projects').select('name').eq('id', g.tender.project_id).maybeSingle(),
  ])
  for (const r of [items, est, parts, subs, reqs]) if (r.error) return { ok: false, error: r.error.message }

  const submitted = (subs.data ?? []).filter((s: { status: string }) => s.status === 'submitted')
  const companyOf = new Map((parts.data ?? []).map((p: { id: string; company_name: string }) => [p.id, p.company_name]))
  const subIds = submitted.map((s: { id: string }) => s.id)
  const [lines, docs] = subIds.length
    ? await Promise.all([
        sb.from('tender_submission_lines').select('submission_id, item_id, rate, not_priced').in('submission_id', subIds).range(0, 199999),
        sb.from('tender_submission_documents').select('submission_id, requirement_id, file_name').in('submission_id', subIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }]
  if (lines.error) return { ok: false, error: lines.error.message }
  if (docs.error) return { ok: false, error: docs.error.message }

  const bids: AdjBid[] = submitted.map((s: { id: string; participant_id: string; submitted_at: string | null }) => ({
    participantId: s.participant_id,
    company: companyOf.get(s.participant_id) ?? 'Unknown',
    submittedAt: s.submitted_at,
    lines: Object.fromEntries(
      (lines.data ?? [])
        .filter((l: { submission_id: string }) => l.submission_id === s.id)
        .map((l: { item_id: string; rate: number | null; not_priced: boolean }) => [l.item_id, { rate: l.rate == null ? null : Number(l.rate), not_priced: l.not_priced }]),
    ),
  }))
  const compliance: AdjCompliance[] = submitted.map((s: { id: string; participant_id: string; declarations: string[] }) => {
    const p = (parts.data ?? []).find((x: { id: string }) => x.id === s.participant_id) as AdjCompliance['profile'] | undefined
    const documents: Record<string, string[]> = {}
    for (const d of (docs.data ?? []) as { submission_id: string; requirement_id: string; file_name: string }[]) {
      if (d.submission_id !== s.id) continue
      ;(documents[d.requirement_id] ??= []).push(d.file_name)
    }
    return { participantId: s.participant_id, documents, declarations: s.declarations ?? [], profile: p ?? null }
  })
  const estimate = Object.fromEntries(
    (est.data ?? []).map((e: { item_id: string; rate: number | null; amount: number | null }) => [e.item_id, { rate: e.rate == null ? null : Number(e.rate), amount: e.amount == null ? null : Number(e.amount) }]),
  )
  const adjudication = adjudicate(
    (items.data ?? []).map((i: AdjItem) => ({ ...i, quantity: i.quantity == null ? null : Number(i.quantity), fixed_amount: i.fixed_amount == null ? null : Number(i.fixed_amount) })),
    estimate,
    bids,
    (reqs.data ?? []) as AdjRequirement[],
    compliance,
  )
  const draftsAtClosing = (subs.data ?? [])
    .filter((s: { status: string }) => s.status !== 'submitted')
    .map((s: { participant_id: string }) => companyOf.get(s.participant_id) ?? 'Unknown')

  return {
    ok: true,
    data: {
      adjudication,
      tender: { id: g.tender.id, project_id: g.tender.project_id, package: g.tender.package, title: g.tender.title, status: g.tender.status, closing_at: g.tender.closing_at },
      projectName: (proj.data as { name?: string } | null)?.name ?? '',
      draftsAtClosing,
    },
  }
}
