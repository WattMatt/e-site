'use server'

/**
 * Tender BOQ server actions (E5 slice A).
 *
 * Every action resolves the tender's project first, then gates on
 * ORG_WRITE_ROLES through requireEffectiveRole (project-scoped, honours
 * promotions) BEFORE any read or write. Table reads and writes go through the
 * caller's cookie client so 00226's row security applies as a second gate. The
 * private `tender-files` bucket has no client policies, so only storage calls
 * use the service client, and only after the gate.
 *
 * Upload: the browser PUTs the workbook to a server-minted signed upload URL
 * (no 4.5 MB request-body cap), then calls importTenderAction with the path.
 */

import { revalidatePath } from 'next/cache'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { parseTenderWorkbook } from '@/lib/tender/parse-tender-workbook'
import { reconcileTender } from '@/lib/tender/reconcile-tender'
import { diffTenderBoqs } from '@/lib/tender/diff-tender-boqs'
import { toEstimateLines, toItemRows, type TenderItemRow } from '@/lib/tender/to-rows'
import { RATE_CELL_TYPES, type RateCellType, type TenderBoqDiff, type TenderReconciliation } from '@/lib/tender/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

const BUCKET = 'tender-files'

export interface TenderRecord {
  id: string
  project_id: string
  organisation_id: string
  package: string
  title: string
  revision: string | null
  status: string
  closing_at: string | null
  source_filename: string | null
  estimate_filename: string | null
  stated_subtotal: number | null
  stated_vat: number | null
  stated_total: number | null
  reconciliation: { source: TenderReconciliation; estimate: TenderReconciliation | null } | null
  structure_diff: (TenderBoqDiff & { unmatchedEstimateRows?: number }) | null
  imported_at: string | null
  created_at: string
}

export interface TenderItem extends TenderItemRow {
  id: string
  tender_id: string
}

type Result<T> = { data: T } | { error: string }

const TENDER_COLUMNS =
  'id, project_id, organisation_id, package, title, revision, status, closing_at, source_filename, estimate_filename, stated_subtotal, stated_vat, stated_total, reconciliation, structure_diff, imported_at, created_at'

function bust(projectId: string, tenderId?: string) {
  revalidatePath(`/projects/${projectId}/tenders`, 'page')
  if (tenderId) revalidatePath(`/projects/${projectId}/tenders/${tenderId}`, 'page')
}

/** Resolve a tender's project with the service client (no RLS dependency), then gate. */
async function gateTender(
  tenderId: string,
): Promise<{ ok: true; supabase: AnyClient; tender: { id: string; project_id: string; organisation_id: string; status: string } } | { ok: false; error: string }> {
  const svc = createServiceClient() as AnyClient
  const { data: t } = await svc
    .schema('projects')
    .from('tenders')
    .select('id, project_id, organisation_id, status')
    .eq('id', tenderId)
    .maybeSingle()
  if (!t) return { ok: false, error: 'Tender not found' }
  const supabase = (await createClient()) as AnyClient
  const guard = await requireEffectiveRole(supabase, t.project_id, ORG_WRITE_ROLES)
  if (!guard.ok) return { ok: false, error: guard.error }
  return { ok: true, supabase, tender: t }
}

export async function listTendersAction(projectId: string): Promise<Result<TenderRecord[]>> {
  const supabase = (await createClient()) as AnyClient
  const guard = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }
  const { data, error } = await supabase
    .schema('projects')
    .from('tenders')
    .select(TENDER_COLUMNS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) return { error: error.message }
  return { data: (data ?? []) as TenderRecord[] }
}

export interface CreateTenderInput {
  package: string
  title: string
  revision?: string | null
  closingAt?: string | null
}

export async function createTenderAction(projectId: string, input: CreateTenderInput): Promise<Result<{ id: string }>> {
  const pkg = input.package?.trim() ?? ''
  const title = input.title?.trim() ?? ''
  if (!pkg) return { error: 'Package is required' }
  if (!title) return { error: 'Title is required' }
  let closingAt: string | null = null
  if (input.closingAt) {
    const d = new Date(input.closingAt)
    if (Number.isNaN(d.getTime())) return { error: 'Closing time is not a valid date' }
    closingAt = d.toISOString()
  }

  const supabase = (await createClient()) as AnyClient
  const guard = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { data: project } = await supabase
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return { error: 'Project not found' }

  const { data, error } = await supabase
    .schema('projects')
    .from('tenders')
    // The bind trigger re-derives organisation_id from the project regardless.
    .insert({ project_id: projectId, organisation_id: project.organisation_id, package: pkg, title, revision: input.revision?.trim() || null, closing_at: closingAt })
    .select('id')
    .single()
  if (error || !data) return { error: error?.message ?? 'Could not create the tender' }
  bust(projectId)
  return { data: { id: data.id as string } }
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120) || 'workbook.xlsx'
}

function tenderPrefix(t: { organisation_id: string; project_id: string; id: string }) {
  return `${t.organisation_id}/${t.project_id}/${t.id}/`
}

export async function getTenderUploadUrlAction(
  tenderId: string,
  kind: 'source' | 'estimate',
  fileName: string,
): Promise<Result<{ path: string; token: string }>> {
  if (!/\.(xlsx|xlsm)$/i.test(fileName)) return { error: 'Upload an Excel workbook (.xlsx or .xlsm)' }
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  if (g.tender.status !== 'draft') return { error: 'Only a draft tender can be re-imported' }
  const path = `${tenderPrefix(g.tender)}${kind}-${Date.now()}-${safeName(fileName)}`
  const svc = createServiceClient() as AnyClient
  const { data, error } = await svc.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false })
  if (error || !data) return { error: 'Could not prepare the upload. Try again.' }
  return { data: { path, token: data.token as string } }
}

async function download(path: string): Promise<Uint8Array | null> {
  const svc = createServiceClient() as AnyClient
  const { data, error } = await svc.storage.from(BUCKET).download(path)
  if (error || !data) return null
  return new Uint8Array(await (data as Blob).arrayBuffer())
}

export interface ImportTenderInput {
  sourcePath: string
  sourceFilename: string
  estimatePath?: string | null
  estimateFilename?: string | null
}

/**
 * Parse the issued tender workbook (and optionally WM's PRE-PRICED INTERNAL copy),
 * reconcile both to the cent, diff their structure, and REPLACE the draft's BOQ
 * with the result. The report is stored on the tender; nothing is hidden when a
 * check fails — the review page shows every mismatch.
 */
export async function importTenderAction(tenderId: string, input: ImportTenderInput): Promise<Result<{ items: number; matched: boolean }>> {
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  if (g.tender.status !== 'draft') return { error: 'Only a draft tender can be re-imported' }
  const prefix = tenderPrefix(g.tender)
  for (const p of [input.sourcePath, input.estimatePath].filter(Boolean) as string[]) {
    if (!p.startsWith(prefix) || p.includes('..')) return { error: 'That file does not belong to this tender' }
  }

  const sourceBytes = await download(input.sourcePath)
  if (!sourceBytes) return { error: 'The tender workbook did not arrive. Upload it again.' }
  let source, estimate = null
  try {
    source = await parseTenderWorkbook(sourceBytes)
    if (input.estimatePath) {
      const eb = await download(input.estimatePath)
      if (!eb) return { error: 'The estimate workbook did not arrive. Upload it again.' }
      estimate = await parseTenderWorkbook(eb)
    }
  } catch (e) {
    return { error: `Could not read the workbook: ${e instanceof Error ? e.message : 'unknown error'}` }
  }
  if (source.sheets.length === 0) return { error: 'No BOQ sheet was found (no row with a DESCRIPTION header).' }

  const rows = toItemRows(source)
  const recSource = reconcileTender(source)
  const recEstimate = estimate ? reconcileTender(estimate) : null
  const diff = estimate ? diffTenderBoqs(source, estimate) : null
  const pairing = estimate ? toEstimateLines(rows, estimate) : { lines: [], unmatched: [] }

  // Only the ISSUED workbook's own summary goes onto the tender's stated
  // figures. WM's internal estimate totals live solely inside the stored
  // reconciliation, which no tenderer path can read.
  const stated = source.summary
  const meta = {
    source_filename: input.sourceFilename,
    source_path: input.sourcePath,
    estimate_filename: estimate ? (input.estimateFilename ?? null) : null,
    estimate_path: estimate ? (input.estimatePath ?? null) : null,
    stated_subtotal: stated?.subtotalExVat ?? null,
    stated_vat: stated?.vat ?? null,
    stated_total: stated?.totalInclVat ?? null,
    reconciliation: { source: recSource, estimate: recEstimate },
    structure_diff: diff ? { ...diff, unmatchedEstimateRows: pairing.unmatched.length } : null,
  }

  // One transaction, under the caller's row security, holding the tender lock.
  const { error: rpcError } = await g.supabase.schema('projects').rpc('tender_replace_boq', {
    p_tender_id: tenderId,
    p_meta: meta,
    p_rows: rows,
    p_estimate: pairing.lines,
  })
  if (rpcError) return { error: `Saving the BOQ failed; nothing was changed. ${rpcError.message}` }

  bust(g.tender.project_id, tenderId)
  const matched = recSource.matched && (recEstimate?.matched ?? true) && (diff?.identical ?? true)
  return { data: { items: rows.filter((r) => r.kind === 'item').length, matched } }
}

export async function setRateCellTypeAction(
  tenderId: string,
  itemId: string,
  type: RateCellType,
  fixedAmount?: number | null,
): Promise<Result<true>> {
  if (!RATE_CELL_TYPES.includes(type)) return { error: 'Unknown rate type' }
  if (type === 'fixed' && (fixedAmount == null || !Number.isFinite(fixedAmount) || fixedAmount < 0)) {
    return { error: 'Enter the fixed amount (in rand) for this item' }
  }
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  if (g.tender.status !== 'draft') return { error: 'The BOQ of an issued tender cannot change' }
  const patch: Record<string, unknown> = {
    rate_cell_type: type,
    fixed_amount: type === 'fixed' ? Math.round((fixedAmount as number) * 100) / 100 : null,
  }
  const { data, error } = await g.supabase
    .schema('projects')
    .from('tender_boq_items')
    .update(patch)
    .eq('id', itemId)
    .eq('tender_id', tenderId)
    .eq('kind', 'item')
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'Nothing was changed (that row is not an item of this tender)' }
  bust(g.tender.project_id, tenderId)
  return { data: true }
}

export async function deleteTenderAction(tenderId: string): Promise<Result<true>> {
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  if (g.tender.status !== 'draft') return { error: 'Only a draft tender can be deleted' }
  const { data, error } = await g.supabase.schema('projects').from('tenders').delete().eq('id', tenderId).select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'Nothing was deleted' }
  const svc = createServiceClient() as AnyClient
  const prefix = tenderPrefix(g.tender)
  const { data: files } = await svc.storage.from(BUCKET).list(prefix.slice(0, -1), { limit: 1000 })
  if (files?.length) await svc.storage.from(BUCKET).remove(files.map((f: { name: string }) => `${prefix}${f.name}`))
  bust(g.tender.project_id)
  return { data: true }
}

export async function getTenderDetailAction(
  tenderId: string,
): Promise<Result<{ tender: TenderRecord; items: TenderItem[]; estimate: Record<string, { rate: number | null; amount: number | null }> }>> {
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  const sb = g.supabase.schema('projects')
  const { data: tender, error } = await sb.from('tenders').select(TENDER_COLUMNS).eq('id', tenderId).maybeSingle()
  if (error || !tender) return { error: error?.message ?? 'Tender not found' }
  const items: TenderItem[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error: e } = await sb
      .from('tender_boq_items')
      .select('*')
      .eq('tender_id', tenderId)
      .order('sort_order')
      .range(from, from + 999)
    if (e) return { error: e.message }
    items.push(...((data ?? []) as TenderItem[]))
    if (!data || data.length < 1000) break
  }
  const estimate: Record<string, { rate: number | null; amount: number | null }> = {}
  for (let from = 0; ; from += 1000) {
    const { data, error: e } = await sb
      .from('tender_estimate_lines')
      .select('item_id, rate, amount')
      .eq('tender_id', tenderId)
      .range(from, from + 999)
    if (e) return { error: e.message }
    for (const l of data ?? []) estimate[l.item_id] = { rate: l.rate, amount: l.amount }
    if (!data || data.length < 1000) break
  }
  return { data: { tender: tender as TenderRecord, items, estimate } }
}
