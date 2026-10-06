'use server'

/**
 * Bidder pricing, documents, declarations, questions and submission (E5 slice C).
 *
 * Every read and write runs through the bidder's OWN session: prices, documents
 * and acknowledgements are written only by the 00233 definer functions (one
 * gate each: an open tender, the caller's own submission, an email-proved
 * session), and reads go through row security or the column-limited portal
 * functions. The service client is used only for storage — signed upload URLs
 * into this bidder's own folder, and the sanitised BOQ workbook — and only after
 * the portal function has confirmed this caller is a participant.
 */

import ExcelJS from 'exceljs'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { AnyClient } from '@/lib/tender/gate'
import { checkCompliance, type ComplianceResult, type RateCellType } from '@/lib/tender/compliance'
import { compareUploadedBoq, type RoundTripResult, type StoredRow } from '@/lib/tender/excel-roundtrip'
import { parseTenderWorkbook } from '@/lib/tender/parse-tender-workbook'
import { sanitiseWorkbookForBidder, type BidderWorkbookItem } from '@/lib/tender/bidder-workbook'
import { readAll } from '@/lib/tender/read-all'

type Result<T> = { data: T } | { error: string }

const SUBMISSION_BUCKET = 'tender-submissions'
const MAX_DOC_BYTES = 50 * 1024 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CLOSED = 'This tender is closed.'

/** A database refusal, in words a bidder can act on. */
function refusal(error: { code?: string; message: string }): string {
  if (error.code === '55000') return CLOSED
  if (error.code === '42501') return 'You are not signed in to this tender with your emailed link.'
  return error.message.replace(/^.*?:\s*/, '') || 'Refused'
}

interface Ctx {
  supabase: AnyClient
  userId: string
  tender: { id: string; status: string; closing_at: string | null; package: string; title: string }
  participantId: string
  profileComplete: boolean
}

/** The caller must be a participant of this (issued) tender, in an email-proved session. */
async function participantCtx(tenderId: string): Promise<{ ok: true; ctx: Ctx } | { ok: false; error: string }> {
  const supabase = (await createClient()) as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in' }
  const sb = supabase.schema('projects')
  const { data: summary } = await sb.rpc('tender_portal_summary', { p_tender_id: tenderId })
  const tender = (summary as Ctx['tender'][] | null)?.[0]
  if (!tender) return { ok: false, error: 'Tender not found' }
  const { data: part } = await sb
    .from('tender_participants')
    .select('id, profile_completed_at')
    .eq('tender_id', tenderId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!part) return { ok: false, error: 'Tender not found' }
  return { ok: true, ctx: { supabase, userId: user.id, tender, participantId: part.id, profileComplete: !!part.profile_completed_at } }
}

/** Every BOQ row the bidder may see, paged past PostgREST's max_rows. */
function portalItems(supabase: AnyClient, tenderId: string) {
  return readAll<PricingState['items'][number]>((f, t) =>
    supabase.schema('projects').rpc('tender_portal_items', { p_tender_id: tenderId }).order('sort_order').order('id').range(f, t))
}

/** The caller's submission id, created if missing (refused once the tender is closed). */
async function ensureSubmission(ctx: Ctx): Promise<{ id: string } | { error: string }> {
  const { data, error } = await ctx.supabase.schema('projects').rpc('tender_lock_my_submission', { p_tender_id: ctx.tender.id })
  if (error || !data) return { error: error ? refusal(error) : 'Could not start your submission' }
  return { id: data as string }
}

export interface PricingState {
  tender: Ctx['tender']
  items: (StoredRow & { fixed_amount: number | null; heading_path: string[]; bill_code: string })[]
  lines: Record<string, { rate: number | null; not_priced: boolean; amount: number }>
  requirements: { id: string; kind: 'document' | 'declaration'; label: string; detail: string | null; mandatory: boolean }[]
  documents: { id: string; requirement_id: string; file_name: string; size_bytes: number; uploaded_at: string }[]
  declarations: string[]
  submission: { id: string; status: string; submitted_at: string | null; submission_count: number } | null
  clarifications: { id: string; kind: string; title: string; body: string; answer: string | null; published_at: string | null; mine: boolean; acknowledged: boolean }[]
  compliance: ComplianceResult
}

export async function getPricingAction(tenderId: string): Promise<Result<PricingState>> {
  const g = await participantCtx(tenderId)
  if (!g.ok) return { error: g.error }
  const { ctx } = g
  const sb = ctx.supabase.schema('projects')
  const [itemsRead, { data: reqs }, { data: sub }, { data: clar }] = await Promise.all([
    portalItems(ctx.supabase, tenderId),
    sb.rpc('tender_portal_requirements', { p_tender_id: tenderId }),
    sb.from('tender_submissions').select('id, status, submitted_at, submission_count, declarations').eq('participant_id', ctx.participantId).maybeSingle(),
    // Published clarifications and the caller's own questions — never who else asked.
    sb.rpc('tender_portal_clarifications', { p_tender_id: tenderId }),
  ])
  if ('error' in itemsRead) return { error: 'Could not read the BOQ. Try again.' }
  const items = itemsRead.data
  const lines: PricingState['lines'] = {}
  let documents: PricingState['documents'] = []
  if (sub) {
    const [l, { data: d }] = await Promise.all([
      readAll<{ item_id: string; rate: number | null; not_priced: boolean; amount: number }>((f, t) =>
        sb.from('tender_submission_lines').select('item_id, rate, not_priced, amount').eq('submission_id', sub.id).order('item_id').range(f, t)),
      sb.from('tender_submission_documents').select('id, requirement_id, file_name, size_bytes, uploaded_at').eq('submission_id', sub.id),
    ])
    if ('error' in l) return { error: 'Could not read your rates. Try again.' }
    for (const x of l.data) lines[x.item_id] = { rate: x.rate == null ? null : Number(x.rate), not_priced: x.not_priced, amount: Number(x.amount) }
    documents = d ?? []
  }
  const clarifications = ((clar ?? []) as PricingState['clarifications']).map((c) => ({
    id: c.id, kind: c.kind, title: c.title, body: c.body, answer: c.answer, published_at: c.published_at,
    mine: !!c.mine, acknowledged: !!c.acknowledged,
  }))
  const typedItems = (items ?? []) as PricingState['items']
  const requirements = (reqs ?? []) as PricingState['requirements']
  const declarations: string[] = sub?.declarations ?? []
  const compliance = checkCompliance({
    items: typedItems.filter((i) => i.kind === 'item').map((i) => ({
      id: i.id, sheet_name: i.sheet_name, row_number: i.row_number, code: i.code, description: i.description,
      quantity: i.quantity == null ? null : Number(i.quantity), rate_cell_type: i.rate_cell_type as RateCellType,
      fixed_amount: i.fixed_amount == null ? null : Number(i.fixed_amount),
    })),
    lines: Object.entries(lines).map(([item_id, l]) => ({ item_id, rate: l.rate, not_priced: l.not_priced })),
    requirements,
    uploadedRequirementIds: documents.map((d) => d.requirement_id),
    acceptedDeclarationIds: declarations,
    profileComplete: ctx.profileComplete,
    unacknowledgedAddenda: clarifications.filter((c: { kind: string; published_at: string | null; acknowledged: boolean }) => c.kind === 'addendum' && c.published_at && !c.acknowledged).map((c: { id: string; title: string }) => ({ id: c.id, title: c.title })),
    tender: ctx.tender,
    now: new Date(),
  })
  return {
    data: {
      tender: ctx.tender,
      items: typedItems,
      lines,
      requirements,
      documents,
      declarations,
      submission: sub ? { id: sub.id, status: sub.status, submitted_at: sub.submitted_at, submission_count: sub.submission_count } : null,
      clarifications,
      compliance,
    },
  }
}

export interface RateEntry {
  itemId: string
  rate: number | null
  notPriced?: boolean
}

/** Save rates through projects.tender_save_rates (amounts computed in the database; unchanged rows untouched). */
export async function saveRatesAction(tenderId: string, entries: RateEntry[]): Promise<Result<{ saved: number }>> {
  if (!Array.isArray(entries) || entries.length === 0) return { data: { saved: 0 } }
  if (entries.length > 20000) return { error: 'Too many rows in one save' }
  for (const e of entries) {
    if (e.rate != null && (!Number.isFinite(e.rate) || e.rate < 0 || e.rate >= 1e11)) return { error: 'Rates must be positive numbers' }
    if (e.rate != null && e.notPriced) return { error: 'A row cannot be both priced and marked not priced' }
  }
  const g = await participantCtx(tenderId)
  if (!g.ok) return { error: g.error }
  const rows = entries.map((e) => ({
    item_id: e.itemId,
    rate: e.rate == null ? null : Math.round(e.rate * 10000) / 10000,
    not_priced: !!e.notPriced,
  }))
  // One call per 2 000 rows: the database gates once, writes only changed rows,
  // and computes every amount (3 000 rows ≈ 0.3 s, measured on production).
  let saved = 0
  for (let i = 0; i < rows.length; i += 2000) {
    const { data, error } = await g.ctx.supabase
      .schema('projects')
      .rpc('tender_save_rates', { p_tender_id: tenderId, p_rows: rows.slice(i, i + 2000) })
    if (error) return { error: refusal(error) }
    saved += Number(data ?? 0)
  }
  return { data: { saved } }
}

export async function setDeclarationsAction(tenderId: string, requirementIds: string[]): Promise<Result<true>> {
  if (!Array.isArray(requirementIds) || requirementIds.some((id) => !UUID_RE.test(id))) return { error: 'Unknown declaration' }
  const g = await participantCtx(tenderId)
  if (!g.ok) return { error: g.error }
  const sub = await ensureSubmission(g.ctx)
  if ('error' in sub) return sub
  const { data, error } = await g.ctx.supabase
    .schema('projects')
    .from('tender_submissions')
    .update({ declarations: Array.from(new Set(requirementIds)) })
    .eq('id', sub.id)
    .select('id')
  if (error) return { error: refusal(error) }
  if (!data || data.length === 0) return { error: CLOSED }
  return { data: true }
}

const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-100) || 'document'

export async function getDocumentUploadUrlAction(
  tenderId: string,
  requirementId: string,
  fileName: string,
  sizeBytes: number,
): Promise<Result<{ path: string; token: string }>> {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_DOC_BYTES) return { error: 'Files must be under 50 MB' }
  if (!/\.(pdf|jpe?g|png|xlsx|xlsm|docx|zip)$/i.test(fileName)) return { error: 'Upload a PDF, image, Word, Excel or ZIP file' }
  if (!UUID_RE.test(requirementId)) return { error: 'Unknown requirement' }
  const g = await participantCtx(tenderId)
  if (!g.ok) return { error: g.error }
  const { data: reqs } = await g.ctx.supabase.schema('projects').rpc('tender_portal_requirements', { p_tender_id: tenderId })
  if (!((reqs ?? []) as { id: string; kind: string }[]).some((r) => r.id === requirementId && r.kind === 'document')) {
    return { error: 'Unknown requirement' }
  }
  const sub = await ensureSubmission(g.ctx)
  if ('error' in sub) return sub
  const path = `${tenderId}/${sub.id}/${requirementId}-${Date.now()}-${safeName(fileName)}`
  const svc = createServiceClient() as AnyClient
  const { data, error } = await svc.storage.from(SUBMISSION_BUCKET).createSignedUploadUrl(path, { upsert: false })
  if (error || !data) return { error: 'Could not prepare the upload. Try again.' }
  return { data: { path, token: data.token } }
}

export async function recordDocumentAction(
  tenderId: string,
  requirementId: string,
  path: string,
  fileName: string,
): Promise<Result<true>> {
  if (!UUID_RE.test(requirementId)) return { error: 'Unknown requirement' }
  const g = await participantCtx(tenderId)
  if (!g.ok) return { error: g.error }
  const sub = await ensureSubmission(g.ctx)
  if ('error' in sub) return sub
  const prefix = `${tenderId}/${sub.id}/${requirementId}-`
  if (!path.startsWith(prefix) || path.includes('..')) return { error: 'That upload does not belong to this submission' }
  // tender_record_document re-checks the path, the requirement, and reads the
  // size that actually arrived from storage (never what the browser claimed).
  const { error } = await g.ctx.supabase
    .schema('projects')
    .rpc('tender_record_document', { p_tender_id: tenderId, p_requirement_id: requirementId, p_path: path, p_file_name: fileName.slice(0, 200) })
  if (error) {
    const svc = createServiceClient() as AnyClient
    await svc.storage.from(SUBMISSION_BUCKET).remove([path])
    return { error: error.code === '23514' && /arrive/.test(error.message) ? 'The upload did not arrive. Try again.' : refusal(error) }
  }
  return { data: true }
}

export async function deleteDocumentAction(tenderId: string, documentId: string): Promise<Result<true>> {
  if (!UUID_RE.test(documentId)) return { error: 'Unknown document' }
  const g = await participantCtx(tenderId)
  if (!g.ok) return { error: g.error }
  const sb = g.ctx.supabase.schema('projects')
  const { data, error } = await sb.from('tender_submission_documents').delete().eq('id', documentId).eq('tender_id', tenderId).select('storage_path')
  if (error) return { error: refusal(error) }
  if (!data || data.length === 0) return { error: 'Nothing was removed (the tender may have closed)' }
  const svc = createServiceClient() as AnyClient
  await svc.storage.from(SUBMISSION_BUCKET).remove(data.map((d: { storage_path: string }) => d.storage_path))
  return { data: true }
}

export async function submitTenderAction(tenderId: string): Promise<Result<{ submittedAt: string; total: number }>> {
  const g = await participantCtx(tenderId)
  if (!g.ok) return { error: g.error }
  const { data, error } = await g.ctx.supabase.schema('projects').rpc('tender_submit', { p_tender_id: tenderId })
  if (error) return { error: refusal(error) }
  const row = (data as { submitted_at: string; total: number }[] | null)?.[0]
  if (!row) return { error: 'Submission refused' }
  return { data: { submittedAt: row.submitted_at, total: Number(row.total) } }
}

export async function reopenSubmissionAction(tenderId: string): Promise<Result<true>> {
  const g = await participantCtx(tenderId)
  if (!g.ok) return { error: g.error }
  const { error } = await g.ctx.supabase.schema('projects').rpc('tender_reopen_submission', { p_tender_id: tenderId })
  if (error) return { error: refusal(error) }
  return { data: true }
}

export async function askQuestionAction(tenderId: string, title: string, body: string): Promise<Result<true>> {
  if (!title.trim() || !body.trim()) return { error: 'Write a short title and your question' }
  if (title.length > 200 || body.length > 5000) return { error: 'Keep the question under 5 000 characters' }
  const g = await participantCtx(tenderId)
  if (!g.ok) return { error: g.error }
  const { error } = await g.ctx.supabase.schema('projects').from('tender_clarifications').insert({
    tender_id: tenderId, kind: 'question', participant_id: g.ctx.participantId, title: title.trim(), body: body.trim(),
  })
  if (error) return { error: error.code === '42501' ? 'Questions close with the tender.' : error.message }
  return { data: true }
}

export async function acknowledgeAddendumAction(tenderId: string, clarificationId: string): Promise<Result<true>> {
  if (!UUID_RE.test(clarificationId)) return { error: 'Unknown addendum' }
  const g = await participantCtx(tenderId)
  if (!g.ok) return { error: g.error }
  const { error } = await g.ctx.supabase
    .schema('projects')
    .rpc('tender_acknowledge_addendum', { p_tender_id: tenderId, p_clarification_id: clarificationId })
  if (error) return { error: refusal(error) }
  return { data: true }
}

/**
 * The BOQ workbook for pricing offline. The imported file may be WM's
 * PRE-PRICED estimate, so it is sanitised first (lib/tender/bidder-workbook):
 * hidden sheets, formulas, comments, names and every WM rate and amount are
 * removed. Returned as a short-lived signed download URL in the bidder's own
 * folder.
 */
export async function downloadPricingWorkbookAction(tenderId: string): Promise<Result<{ url: string; fileName: string }>> {
  const g = await participantCtx(tenderId)
  if (!g.ok) return { error: g.error }
  const svc = createServiceClient() as AnyClient
  const { data: t } = await svc.schema('projects').from('tenders').select('source_path, source_filename').eq('id', tenderId).maybeSingle()
  if (!t?.source_path) return { error: 'The BOQ workbook is not available' }
  const { data: blob } = await svc.storage.from('tender-files').download(t.source_path)
  if (!blob) return { error: 'The BOQ workbook is not available' }
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(new Uint8Array(await (blob as Blob).arrayBuffer()) as unknown as ArrayBuffer)
  const items = await readAll<BidderWorkbookItem>((f, t) =>
    svc
      .schema('projects')
      .from('tender_boq_items')
      .select('sheet_name, row_number, kind, code, description, unit, quantity, rate_cell_type, rate_column, amount_column')
      .eq('tender_id', tenderId)
      .order('sort_order')
      .order('id')
      .range(f, t))
  if ('error' in items) return { error: 'The BOQ workbook is not available' }
  sanitiseWorkbookForBidder(wb, items.data)
  const bytes = Buffer.from(await wb.xlsx.writeBuffer())
  const sub = await ensureSubmission(g.ctx)
  if ('error' in sub) return sub
  const path = `${tenderId}/${sub.id}/boq-download-${Date.now()}.xlsx`
  const { error: upErr } = await svc.storage.from(SUBMISSION_BUCKET).upload(path, bytes, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  if (upErr) return { error: 'Could not prepare the workbook. Try again.' }
  // Named after the tender, never the source file (which may read "Priced estimate", or be .xlsm).
  const fileName = `${g.ctx.tender.package} - ${g.ctx.tender.title} - BOQ.xlsx`.replace(/[^A-Za-z0-9._ -]+/g, '_')
  const { data: signed } = await svc.storage.from(SUBMISSION_BUCKET).createSignedUrl(path, 600, { download: fileName })
  if (!signed?.signedUrl) return { error: 'Could not prepare the workbook. Try again.' }
  return { data: { url: signed.signedUrl, fileName } }
}

export async function getPricedUploadUrlAction(tenderId: string, fileName: string): Promise<Result<{ path: string; token: string }>> {
  if (!/\.(xlsx|xlsm)$/i.test(fileName)) return { error: 'Upload the Excel workbook (.xlsx or .xlsm)' }
  const g = await participantCtx(tenderId)
  if (!g.ok) return { error: g.error }
  const sub = await ensureSubmission(g.ctx)
  if ('error' in sub) return sub
  const path = `${tenderId}/${sub.id}/priced-upload-${Date.now()}.xlsx`
  const svc = createServiceClient() as AnyClient
  const { data, error } = await svc.storage.from(SUBMISSION_BUCKET).createSignedUploadUrl(path, { upsert: false })
  if (error || !data) return { error: 'Could not prepare the upload. Try again.' }
  return { data: { path, token: data.token } }
}

/**
 * Read a priced copy back: refuse it if any locked cell changed (nothing is
 * saved), otherwise save its rates through the bidder's own session.
 */
export async function importPricedWorkbookAction(tenderId: string, path: string): Promise<Result<RoundTripResult & { saved: number }>> {
  const g = await participantCtx(tenderId)
  if (!g.ok) return { error: g.error }
  const sub = await ensureSubmission(g.ctx)
  if ('error' in sub) return sub
  if (!path.startsWith(`${tenderId}/${sub.id}/priced-upload-`) || path.includes('..')) return { error: 'That upload does not belong to this submission' }
  const svc = createServiceClient() as AnyClient
  const { data: blob } = await svc.storage.from(SUBMISSION_BUCKET).download(path)
  await svc.storage.from(SUBMISSION_BUCKET).remove([path])
  if (!blob) return { error: 'The workbook did not arrive. Upload it again.' }
  let parsed
  try {
    parsed = await parseTenderWorkbook(new Uint8Array(await (blob as Blob).arrayBuffer()))
  } catch {
    return { error: 'Could not read that workbook. Upload the .xlsx you downloaded here, with rates typed in.' }
  }
  const items = await portalItems(g.ctx.supabase, tenderId)
  if ('error' in items) return { error: 'Could not read the BOQ. Try again.' }
  const result = compareUploadedBoq(items.data as StoredRow[], parsed)
  if (!result.ok) return { data: { ...result, saved: 0 } }
  const save = await saveRatesAction(
    tenderId,
    result.rates.filter((r) => r.rate != null).map((r) => ({ itemId: r.itemId, rate: r.rate })),
  )
  if ('error' in save) return save
  return { data: { ...result, saved: save.data.saved } }
}
