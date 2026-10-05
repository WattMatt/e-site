import 'server-only'
import { gateTender, type AnyClient } from '@/lib/tender/gate'
import { adjudicate, type AdjBid, type AdjItem, type Adjudication, type AdjCompliance, type AdjRequirement } from './adjudication'

export interface AdjudicationLoad {
  adjudication: Adjudication
  tender: { id: string; project_id: string; package: string; title: string; status: string; closing_at: string | null }
  projectName: string
  draftsAtClosing: string[]
  profiles: Record<string, AdjCompliance['profile']>
}

const READ_FAILED = 'Could not read the tender. Try again.'

/** PostgREST caps every response at max_rows (1 000): page until a short page. */
const PAGE = 1000
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<{ data: T[] } | { error: string }> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) return { error: error.message }
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) return { data: out }
  }
}

/**
 * Load everything adjudication needs through the MANAGER'S OWN session. The
 * prices and documents come back only because the database lifts the seal at
 * closing_at (for submitted bids, never for a cancelled tender), and only to a
 * caller projects.user_can_open_tender admits. Adjudication also waits for the
 * tender to be CLOSED, so bids are never compared while it is still issued.
 * Only submitted bids are adjudicated; a draft still open at closing is listed.
 */
export async function loadAdjudication(tenderId: string): Promise<{ ok: true; data: AdjudicationLoad } | { ok: false; error: string }> {
  const g = await gateTender(tenderId)
  if (!g.ok) return g
  if (g.tender.status === 'cancelled') return { ok: false, error: 'This tender was cancelled; its bids are never opened.' }
  const sb = (g.supabase as AnyClient).schema('projects')
  const [{ data: lifted, error: liftErr }, { data: mayOpen, error: openErr }] = await Promise.all([
    sb.rpc('tender_seal_lifted', { p_tender_id: tenderId }),
    sb.rpc('user_can_open_tender', { p_tender_id: tenderId }),
  ])
  if (liftErr || openErr) return { ok: false, error: 'Could not check the seal. Try again.' }
  if (!lifted) return { ok: false, error: 'Bids are sealed until the closing time.' }
  if (!mayOpen) return { ok: false, error: 'Your role may not open the bids on this tender.' }
  if (g.tender.status !== 'closed' && g.tender.status !== 'adjudicated') {
    return { ok: false, error: 'The closing time has passed. Close the tender to open the bids.' }
  }

  const [items, est, parts, subs, reqs, proj] = await Promise.all([
    readAll<AdjItem>((f, t) =>
      sb.from('tender_boq_items').select('id, sheet_name, row_number, bill_code, code, description, unit, quantity, rate_cell_type, fixed_amount').eq('tender_id', tenderId).eq('kind', 'item').order('sort_order').range(f, t)),
    readAll<{ item_id: string; rate: number | null; amount: number | null }>((f, t) =>
      sb.from('tender_estimate_lines').select('item_id, rate, amount').eq('tender_id', tenderId).order('item_id').range(f, t)),
    readAll<{ id: string; company_name: string; cidb_grade: string | null; bbbee_level: string | null; registration_number: string | null; vat_number: string | null }>((f, t) =>
      sb.from('tender_participants').select('id, company_name, cidb_grade, bbbee_level, registration_number, vat_number').eq('tender_id', tenderId).order('id').range(f, t)),
    readAll<{ id: string; participant_id: string; status: string; submitted_at: string | null; declarations: string[] }>((f, t) =>
      sb.from('tender_submissions').select('id, participant_id, status, submitted_at, declarations').eq('tender_id', tenderId).order('id').range(f, t)),
    readAll<AdjRequirement>((f, t) => sb.from('tender_requirements').select('id, kind, label, mandatory').eq('tender_id', tenderId).order('sort_order').range(f, t)),
    sb.from('projects').select('name').eq('id', g.tender.project_id).maybeSingle(),
  ])
  if ('error' in items) return { ok: false, error: READ_FAILED }
  if ('error' in est) return { ok: false, error: READ_FAILED }
  if ('error' in parts) return { ok: false, error: READ_FAILED }
  if ('error' in subs) return { ok: false, error: READ_FAILED }
  if ('error' in reqs) return { ok: false, error: READ_FAILED }

  const submitted = subs.data.filter((s) => s.status === 'submitted')
  const companyOf = new Map(parts.data.map((p) => [p.id, p.company_name]))
  const subIds = submitted.map((s) => s.id)
  type Line = { submission_id: string; item_id: string; rate: number | null; not_priced: boolean }
  type Doc = { submission_id: string; requirement_id: string; file_name: string }
  const [lines, docs] = subIds.length
    ? await Promise.all([
        readAll<Line>((f, t) =>
          sb.from('tender_submission_lines').select('submission_id, item_id, rate, not_priced').eq('tender_id', tenderId).in('submission_id', subIds).order('submission_id').order('item_id').range(f, t)),
        readAll<Doc>((f, t) =>
          sb.from('tender_submission_documents').select('submission_id, requirement_id, file_name').eq('tender_id', tenderId).in('submission_id', subIds).order('id').range(f, t)),
      ])
    : [{ data: [] as Line[] }, { data: [] as Doc[] }]
  if ('error' in lines) return { ok: false, error: READ_FAILED }
  if ('error' in docs) return { ok: false, error: READ_FAILED }

  const linesBySub = new Map<string, Line[]>()
  for (const l of lines.data) {
    const list = linesBySub.get(l.submission_id) ?? []
    list.push(l)
    linesBySub.set(l.submission_id, list)
  }
  const bids: AdjBid[] = submitted.map((s) => ({
    participantId: s.participant_id,
    company: companyOf.get(s.participant_id) ?? 'Unknown',
    submittedAt: s.submitted_at,
    lines: Object.fromEntries((linesBySub.get(s.id) ?? []).map((l) => [l.item_id, { rate: l.rate == null ? null : Number(l.rate), not_priced: l.not_priced }])),
  }))
  const profiles: Record<string, AdjCompliance['profile']> = {}
  for (const p of parts.data) {
    profiles[p.id] = { cidb_grade: p.cidb_grade, bbbee_level: p.bbbee_level, registration_number: p.registration_number, vat_number: p.vat_number }
  }
  const compliance: AdjCompliance[] = submitted.map((s) => {
    const documents: Record<string, string[]> = {}
    for (const d of docs.data) {
      if (d.submission_id !== s.id) continue
      ;(documents[d.requirement_id] ??= []).push(d.file_name)
    }
    return { participantId: s.participant_id, documents, declarations: s.declarations ?? [], profile: profiles[s.participant_id] ?? null }
  })
  const estimate = Object.fromEntries(
    est.data.map((e) => [e.item_id, { rate: e.rate == null ? null : Number(e.rate), amount: e.amount == null ? null : Number(e.amount) }]),
  )
  const adjudication = adjudicate(
    items.data.map((i) => ({ ...i, quantity: i.quantity == null ? null : Number(i.quantity), fixed_amount: i.fixed_amount == null ? null : Number(i.fixed_amount) })),
    estimate,
    bids,
    reqs.data,
    compliance,
  )
  // A submitted bid always carries a rate for every priced and rate-only item
  // (tender_submit refuses otherwise). A gap means the data did not all arrive;
  // ranking it would rank a fiction, so refuse.
  if (adjudication.integrity.length > 0) {
    const who = adjudication.integrity.map((x) => `${x.company} (${x.missing})`).join(', ')
    return { ok: false, error: `Some submitted rates could not be read: ${who}. Nothing has been compared. Try again, and report it if it persists.` }
  }
  const draftsAtClosing = subs.data
    .filter((s) => s.status !== 'submitted')
    .map((s) => companyOf.get(s.participant_id) ?? 'Unknown')

  return {
    ok: true,
    data: {
      adjudication,
      tender: { id: g.tender.id, project_id: g.tender.project_id, package: g.tender.package, title: g.tender.title, status: g.tender.status, closing_at: g.tender.closing_at },
      projectName: (proj.data as { name?: string } | null)?.name ?? '',
      draftsAtClosing,
      profiles,
    },
  }
}
