'use server'
/**
 * Platform tariff library actions (spec §12; D-03). Every action re-checks
 * is_platform_tariff_admin (requirePlatformTariffAdmin) and writes through the
 * admin's session where 00209/00213 give admins a policy. The service client
 * is used only for what 00209/00213 reserve for the service role (Storage in
 * the private tariff-sources bucket, the due-year monitor) and only after the
 * gate. Errors are sentences (spec §0.4 rule 5).
 */
import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { LICENSEE_KINDS } from '@esite/shared'
import { normaliseAlias, PROVINCES } from '@esite/shared/tariffs/ingest'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePlatformTariffAdmin } from '@/lib/tariffs/admin-gate'
import { humanTariffError } from '@/lib/tariffs/errors'
import { contentTypeFor, sourceStoragePath, validateSourceMeta, type SourceMeta, type SourceMetaField } from '@/lib/tariffs/source-files'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Ok<T = object> = ({ ok: true } & T) | { error: string }

const BUCKET = 'tariff-sources'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FY = /^\d{4}\/\d{2}$/
const STALE = 'Someone else changed this — reload to see their version.'

// ── Licensees ───────────────────────────────────────────────────────────────
export interface LicenseeForm {
  id: string | null
  name: string
  kind: string
  mdbCode: string
  province: string
  nersaLicenceNo: string
  expectedUpdatedAt: string | null
}

export async function saveLicenseeAction(f: LicenseeForm): Promise<
  { ok: true; id: string; updatedAt: string } | { error: string } | { fieldErrors: Partial<Record<'name' | 'kind' | 'province' | 'mdbCode', string>> }
> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const fieldErrors: Partial<Record<'name' | 'kind' | 'province' | 'mdbCode', string>> = {}
  const name = String(f.name ?? '').trim()
  if (!name) fieldErrors.name = 'Enter the licensee name'
  else if (name.length > 200) fieldErrors.name = 'Keep the name under 200 characters'
  if (!(LICENSEE_KINDS as readonly string[]).includes(f.kind)) fieldErrors.kind = 'Choose the licensee kind'
  if (f.province && !(PROVINCES as readonly string[]).includes(f.province)) fieldErrors.province = 'Choose a province'
  if (String(f.mdbCode ?? '').trim().length > 20) fieldErrors.mdbCode = 'MDB codes are short (e.g. JHB)'
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }
  const row = {
    name, kind: f.kind, mdb_code: f.mdbCode.trim() || null, province: f.province || null,
    nersa_licence_no: f.nersaLicenceNo.trim() || null,
  }
  const t = gate.supabase.schema('tariffs').from('licensee')
  const res = f.id === null
    ? await t.insert(row).select('id, updated_at')
    : await t.update(row).eq('id', f.id).eq('updated_at', f.expectedUpdatedAt ?? '').select('id, updated_at')
  if (res.error) return { error: res.error.code === '23505' ? 'A licensee with that name or MDB code already exists.' : humanTariffError(res.error) }
  const r = (res.data as Array<{ id: string; updated_at: string }> | null)?.[0]
  if (!r) return { error: STALE }
  revalidatePath('/admin/tariffs/licensees')
  return { ok: true, id: r.id, updatedAt: r.updated_at }
}

export async function addLicenseeAliasAction(input: { licenseeId: string; alias: string }): Promise<Ok> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const alias = normaliseAlias(String(input.alias ?? ''))
  if (!alias) return { error: 'Enter the alias as it appears in the source' }
  if (!UUID.test(input.licenseeId)) return { error: 'Choose a licensee' }
  const { error } = await gate.supabase.schema('tariffs').from('licensee_alias').insert({ alias, licensee_id: input.licenseeId })
  if (error) return { error: error.code === '23505' ? 'That alias already points at a licensee.' : humanTariffError(error) }
  revalidatePath('/admin/tariffs/licensees')
  return { ok: true }
}

export async function removeLicenseeAliasAction(input: { alias: string }): Promise<Ok> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const { error } = await gate.supabase.schema('tariffs').from('licensee_alias').delete().eq('alias', String(input.alias ?? ''))
  if (error) return { error: humanTariffError(error) }
  revalidatePath('/admin/tariffs/licensees')
  return { ok: true }
}

// ── Source documents ────────────────────────────────────────────────────────
function firstError(e: Partial<Record<SourceMetaField, string>>): string | null {
  const v = Object.values(e)[0]
  return v ?? null
}

export async function createSourceUploadAction(m: SourceMeta): Promise<{ ok: true; path: string; token: string } | { error: string }> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const bad = firstError(validateSourceMeta(m))
  if (bad) return { error: bad }
  const { data: existing } = await gate.supabase.schema('tariffs').from('source_document')
    .select('id, title').eq('sha256', m.sha256).limit(1)
  const dup = (existing as Array<{ title: string }> | null)?.[0]
  if (dup) return { error: `This file is already in the library as "${dup.title}".` }
  const path = sourceStoragePath({ financialYear: m.financialYear.trim() || null, sha256: m.sha256, fileName: m.fileName })
  const svc = createServiceClient() as unknown as AnyClient
  const { data, error } = await svc.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true })
  if (error || !data) return { error: 'Could not prepare the upload. Try again.' }
  return { ok: true, path, token: data.token }
}

export async function registerSourceDocumentAction(m: SourceMeta): Promise<{ ok: true; id: string } | { error: string }> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const bad = firstError(validateSourceMeta(m))
  if (bad) return { error: bad }
  const path = sourceStoragePath({ financialYear: m.financialYear.trim() || null, sha256: m.sha256, fileName: m.fileName })
  const svc = createServiceClient() as unknown as AnyClient
  const { data: blob, error: dlError } = await svc.storage.from(BUCKET).download(path)
  if (dlError || !blob) return { error: 'The upload did not arrive. Try again.' }
  const bytes = new Uint8Array(await (blob as Blob).arrayBuffer())
  const sha = createHash('sha256').update(bytes).digest('hex')
  if (sha !== m.sha256) {
    await svc.storage.from(BUCKET).remove([path])
    return { error: 'The uploaded file does not match its checksum. Upload it again.' }
  }
  const { data, error } = await gate.supabase.schema('tariffs').from('source_document').insert({
    licensee_id: m.licenseeId && UUID.test(m.licenseeId) ? m.licenseeId : null,
    kind: m.kind, title: m.title.trim(), financial_year: m.financialYear.trim() || null, status: m.status,
    published_on: m.publishedOn || null, storage_path: path, sha256: sha, url: m.url.trim() || null,
    retrieved_at: new Date().toISOString(),
  }).select('id')
  if (error) return { error: error.code === '23505' ? 'This file is already in the library.' : humanTariffError(error) }
  revalidatePath('/admin/tariffs/sources')
  return { ok: true, id: String((data as Array<{ id: string }>)[0]?.id ?? '') }
}

/** A short-lived signed URL (10 min) for the review queue's source viewer. */
export async function getTariffSourceUrlAdminAction(input: { sourceDocumentId: string }): Promise<
  { url: string; kind: 'pdf' | 'xlsx' | 'link' } | { error: string }
> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const { data } = await gate.supabase.schema('tariffs').from('source_document')
    .select('storage_path, url').eq('id', input.sourceDocumentId).maybeSingle()
  const doc = data as { storage_path: string | null; url: string | null } | null
  if (!doc) return { error: 'That source document no longer exists.' }
  if (doc.storage_path) {
    const svc = createServiceClient() as unknown as AnyClient
    const { data: s, error } = await svc.storage.from(BUCKET).createSignedUrl(doc.storage_path, 600)
    if (error || !s) return { error: 'Could not open the source document. Try again.' }
    return { url: s.signedUrl, kind: contentTypeFor(doc.storage_path) === 'application/pdf' ? 'pdf' : 'xlsx' }
  }
  if (doc.url) return { url: doc.url, kind: 'link' }
  return { error: 'This source has no stored file or link.' }
}

// ── Ingest jobs (PDF: the staff worker runs them) ───────────────────────────
export interface QueueJobInput {
  sourceDocumentId: string
  parser: 'province_xlsx' | 'eskom_xlsm' | 'rfd_pdf'
  financialYear: string
  licenseeName: string
  createLicensees: boolean
}

export async function queueIngestJobAction(i: QueueJobInput): Promise<{ ok: true; id: string } | { error: string }> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  if (!['province_xlsx', 'eskom_xlsm', 'rfd_pdf'].includes(i.parser)) return { error: 'Choose a parser' }
  if (!FY.test(String(i.financialYear ?? ''))) return { error: 'Use the form 2026/27' }
  const licenseeName = String(i.licenseeName ?? '').trim()
  if (i.parser === 'rfd_pdf' && !licenseeName) return { error: 'An RfD covers one licensee: enter its name as the registry spells it.' }
  const { data, error } = await gate.supabase.schema('tariffs').from('ingest_job').insert({
    source_document_id: i.sourceDocumentId, parser: i.parser, financial_year: i.financialYear,
    licensee_name: licenseeName || null, create_licensees: Boolean(i.createLicensees),
  }).select('id')
  if (error) return { error: humanTariffError(error) }
  revalidatePath('/admin/tariffs/sources')
  return { ok: true, id: String((data as Array<{ id: string }>)[0]?.id ?? '') }
}

// ── Due-year monitor (the cron job's function, runnable on demand) ──────────
export async function runDueYearCheckAction(input: { regime: 'eskom' | 'municipal' }): Promise<{ ok: true; inserted: number } | { error: string }> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  if (input.regime !== 'eskom' && input.regime !== 'municipal') return { error: 'Choose Eskom or municipal' }
  const svc = createServiceClient() as unknown as AnyClient
  const { data, error } = await svc.schema('tariffs').rpc('record_due_year_alerts', { p_regime: input.regime })
  if (error) return { error: humanTariffError(error) }
  revalidatePath('/admin/tariffs')
  return { ok: true, inserted: Number(data ?? 0) }
}

// ── Error reports ───────────────────────────────────────────────────────────
export async function resolveErrorReportAction(input: { id: string; status: 'open' | 'resolved' | 'rejected'; resolutionNote: string }): Promise<Ok> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  if (!['open', 'resolved', 'rejected'].includes(input.status)) return { error: 'Choose a status' }
  const note = String(input.resolutionNote ?? '').trim()
  if (input.status === 'rejected' && !note) return { error: 'Say why the report is rejected.' }
  if (note.length > 1000) return { error: 'Keep the note under 1000 characters.' }
  const { data, error } = await gate.supabase.schema('tariffs').from('error_report')
    .update({ status: input.status, resolution_note: note || null }).eq('id', input.id).select('id')
  if (error) return { error: humanTariffError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: 'That report no longer exists.' }
  revalidatePath('/admin/tariffs/reports')
  return { ok: true }
}
