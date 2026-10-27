'use server'

/**
 * The tender issue pack, WM side (00252): the documents issued with a tender,
 * the tender's particulars, extending the closing time, and cancelling.
 *
 * Every gate is gateTender (project write role, through the caller's session);
 * the database's guard trigger decides every state rule (pack documents only
 * while draft; after issue only on an unpublished addendum; published = final),
 * so a refusal here is the database's own sentence. The service client touches
 * ONLY storage (the private tender-files bucket has no client policies), and
 * only after the gate; a row is registered through the caller's session first,
 * so RLS and the guard run before any file becomes reachable.
 */

import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { gateTender, tenderPrefix, type AnyClient } from '@/lib/tender/gate'
import {
  isTenderDocumentCategory,
  TENDER_DOCUMENT_EXT_RE,
  TENDER_DOCUMENT_MAX_BYTES,
  type TenderDocumentRow,
} from '@/lib/tender/documents'
import { renderCancelledEmail, renderClosingExtendedEmail, sendToMany, tenderAudience } from '@/lib/tender/notify'

type Result<T> = { data: T } | { error: string }

const BUCKET = 'tender-files'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120) || 'document'

function bust(projectId: string, tenderId: string) {
  revalidatePath(`/projects/${projectId}/tenders/${tenderId}`, 'page')
}

/** The database's refusal, in words WM can act on. */
function refusal(error: { code?: string; message: string }): string {
  if (error.code === '55000') return error.message.replace(/^.*?:\s*/, '')
  return error.message || 'Refused'
}

export interface TenderDocumentWithReceipts extends TenderDocumentRow {
  /** Participants who downloaded it at least once. */
  downloadedBy: number
}

export async function listTenderDocumentsAction(tenderId: string): Promise<Result<{
  documents: TenderDocumentWithReceipts[]
  participants: number
}>> {
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  const sb = g.supabase.schema('projects')
  const [{ data: docs, error }, { data: dls }, { count: participants }] = await Promise.all([
    sb.from('tender_documents')
      .select('id, clarification_id, category, label, file_name, file_size, sort_order, created_at')
      .eq('tender_id', tenderId)
      .order('sort_order')
      .order('created_at'),
    sb.from('tender_document_downloads').select('document_id, participant_id').eq('tender_id', tenderId),
    sb.from('tender_participants').select('id', { count: 'exact', head: true }).eq('tender_id', tenderId),
  ])
  if (error) return { error: 'Could not read the documents. Try again.' }
  const byDoc = new Map<string, number>()
  for (const d of (dls ?? []) as { document_id: string }[]) byDoc.set(d.document_id, (byDoc.get(d.document_id) ?? 0) + 1)
  return {
    data: {
      documents: ((docs ?? []) as TenderDocumentRow[]).map((d) => ({ ...d, downloadedBy: byDoc.get(d.id) ?? 0 })),
      participants: participants ?? 0,
    },
  }
}

export async function getTenderDocumentUploadUrlAction(
  tenderId: string,
  fileName: string,
  sizeBytes: number,
): Promise<Result<{ path: string; token: string }>> {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > TENDER_DOCUMENT_MAX_BYTES) return { error: 'Files must be under 50 MB' }
  if (!TENDER_DOCUMENT_EXT_RE.test(fileName)) return { error: 'Upload a PDF, image, Word, Excel, DWG/DXF or ZIP file' }
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  const path = `${tenderPrefix(g.tender)}documents/${Date.now()}-${safeName(fileName)}`
  const svc = createServiceClient() as AnyClient
  const { data, error } = await svc.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false })
  if (error || !data) return { error: 'Could not prepare the upload. Try again.' }
  return { data: { path, token: data.token as string } }
}

export interface RegisterDocumentInput {
  /** Attach to this (unpublished) addendum; null = part of the issued pack (draft only). */
  clarificationId: string | null
  category: string
  label: string
  fileName: string
  path: string
  contentType?: string | null
}

export async function registerTenderDocumentAction(tenderId: string, input: RegisterDocumentInput): Promise<Result<{ id: string }>> {
  if (!isTenderDocumentCategory(input.category)) return { error: 'Choose a category' }
  if (!input.label?.trim()) return { error: 'Give the document a label' }
  if (input.clarificationId != null && !UUID_RE.test(input.clarificationId)) return { error: 'Unknown addendum' }
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  const prefix = `${tenderPrefix(g.tender)}documents/`
  if (!input.path.startsWith(prefix) || input.path.includes('..')) return { error: 'That upload does not belong to this tender' }
  // The size that actually arrived in storage, never what the browser claimed.
  const svc = createServiceClient() as AnyClient
  const dir = input.path.slice(0, input.path.lastIndexOf('/'))
  const name = input.path.slice(input.path.lastIndexOf('/') + 1)
  const { data: listed } = await svc.storage.from(BUCKET).list(dir, { search: name })
  const object = ((listed ?? []) as { name: string; metadata?: { size?: number } }[]).find((o) => o.name === name)
  const size = object?.metadata?.size
  if (!size || size <= 0) return { error: 'The upload did not arrive. Try again.' }
  const { data, error } = await g.supabase
    .schema('projects')
    .from('tender_documents')
    .insert({
      tender_id: tenderId,
      clarification_id: input.clarificationId,
      category: input.category,
      label: input.label.trim().slice(0, 300),
      file_name: input.fileName.slice(0, 300),
      file_path: input.path,
      file_size: size,
      content_type: input.contentType ?? null,
    })
    .select('id')
    .single()
  if (error || !data) {
    await svc.storage.from(BUCKET).remove([input.path])
    return { error: error ? refusal(error) : 'Could not register the document. Try again.' }
  }
  bust(g.tender.project_id, tenderId)
  return { data: { id: data.id as string } }
}

export async function updateTenderDocumentAction(
  tenderId: string,
  documentId: string,
  patch: { label?: string; category?: string; sortOrder?: number },
): Promise<Result<true>> {
  if (!UUID_RE.test(documentId)) return { error: 'Unknown document' }
  if (patch.category != null && !isTenderDocumentCategory(patch.category)) return { error: 'Choose a category' }
  if (patch.label != null && !patch.label.trim()) return { error: 'Give the document a label' }
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  const { data, error } = await g.supabase
    .schema('projects')
    .from('tender_documents')
    .update({
      ...(patch.label != null ? { label: patch.label.trim().slice(0, 300) } : {}),
      ...(patch.category != null ? { category: patch.category } : {}),
      ...(patch.sortOrder != null ? { sort_order: patch.sortOrder } : {}),
    })
    .eq('id', documentId)
    .eq('tender_id', tenderId)
    .select('id')
  if (error) return { error: refusal(error) }
  if (!data || data.length === 0) return { error: 'Nothing was changed' }
  bust(g.tender.project_id, tenderId)
  return { data: true }
}

export async function removeTenderDocumentAction(tenderId: string, documentId: string): Promise<Result<true>> {
  if (!UUID_RE.test(documentId)) return { error: 'Unknown document' }
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  const { data, error } = await g.supabase
    .schema('projects')
    .from('tender_documents')
    .delete()
    .eq('id', documentId)
    .eq('tender_id', tenderId)
    .select('file_path')
  if (error) return { error: refusal(error) }
  if (!data || data.length === 0) return { error: 'Nothing was removed' }
  const svc = createServiceClient() as AnyClient
  await svc.storage.from(BUCKET).remove(data.map((d: { file_path: string }) => d.file_path))
  bust(g.tender.project_id, tenderId)
  return { data: true }
}

/** A short-lived download for WM's own review of an issued document. */
export async function getWmTenderDocumentUrlAction(tenderId: string, documentId: string): Promise<Result<{ url: string }>> {
  if (!UUID_RE.test(documentId)) return { error: 'Unknown document' }
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  const { data: doc } = await g.supabase
    .schema('projects')
    .from('tender_documents')
    .select('file_path, file_name')
    .eq('id', documentId)
    .eq('tender_id', tenderId)
    .maybeSingle()
  if (!doc) return { error: 'Document not found' }
  const svc = createServiceClient() as AnyClient
  const { data: signed } = await svc.storage.from(BUCKET).createSignedUrl(doc.file_path, 600, { download: doc.file_name })
  if (!signed?.signedUrl) return { error: 'Could not prepare the download. Try again.' }
  return { data: { url: signed.signedUrl } }
}

/**
 * A bidder's uploaded document, for adjudication. The row is read through the
 * CALLER's session: the sealed-bid policies return it only after the closing
 * time, only for a submitted bid, and only to a caller user_can_open_tender
 * admits — so if the row comes back, the caller may have the file.
 */
export async function getBidderDocumentUrlAction(tenderId: string, documentId: string): Promise<Result<{ url: string }>> {
  if (!UUID_RE.test(documentId)) return { error: 'Unknown document' }
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  const { data: doc } = await g.supabase
    .schema('projects')
    .from('tender_submission_documents')
    .select('storage_path, file_name')
    .eq('id', documentId)
    .eq('tender_id', tenderId)
    .maybeSingle()
  if (!doc) return { error: 'Sealed until the closing time, or not found' }
  const svc = createServiceClient() as AnyClient
  const { data: signed } = await svc.storage.from('tender-submissions').createSignedUrl(doc.storage_path, 600, { download: doc.file_name })
  if (!signed?.signedUrl) return { error: 'Could not prepare the download. Try again.' }
  return { data: { url: signed.signedUrl } }
}

export interface TenderDetailsInput {
  reference: string
  description: string
  siteInspection: string
  queriesCloseAt: string | null
  validityDays: number | null
  contactName: string
  contactEmail: string
}

/** The particulars, while the tender is a draft. Frozen at issue by the database. */
export async function updateTenderDetailsAction(tenderId: string, d: TenderDetailsInput): Promise<Result<true>> {
  if (d.validityDays != null && (!Number.isInteger(d.validityDays) || d.validityDays < 1 || d.validityDays > 365)) {
    return { error: 'Validity must be between 1 and 365 days' }
  }
  if (d.contactEmail.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.contactEmail.trim())) {
    return { error: 'The contact email does not look like an address' }
  }
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  if (g.tender.status !== 'draft') return { error: 'An issued tender’s particulars are frozen. Publish an addendum instead.' }
  const { data, error } = await g.supabase
    .schema('projects')
    .from('tenders')
    .update({
      reference: d.reference.trim().slice(0, 100) || null,
      description: d.description.trim().slice(0, 5000) || null,
      site_inspection: d.siteInspection.trim().slice(0, 2000) || null,
      queries_close_at: d.queriesCloseAt,
      validity_days: d.validityDays,
      contact_name: d.contactName.trim().slice(0, 200) || null,
      contact_email: d.contactEmail.trim().toLowerCase() || null,
    })
    .eq('id', tenderId)
    .select('id')
  if (error) return { error: refusal(error) }
  if (!data || data.length === 0) return { error: 'Nothing was changed' }
  bust(g.tender.project_id, tenderId)
  return { data: true }
}

/** Extend the closing time of an issued tender (the database refuses any other move) and tell the bidders. */
export async function extendClosingAction(tenderId: string, newClosingIso: string): Promise<Result<{ emailed: number }>> {
  const when = new Date(newClosingIso)
  if (Number.isNaN(when.getTime())) return { error: 'Set the new closing date and time' }
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  if (g.tender.status !== 'issued') return { error: 'Only an issued tender’s closing time can be extended' }
  if (g.tender.closing_at && when <= new Date(g.tender.closing_at)) return { error: 'The closing time can only be extended, not brought forward' }
  const { data, error } = await g.supabase
    .schema('projects')
    .from('tenders')
    .update({ closing_at: when.toISOString() })
    .eq('id', tenderId)
    .select('reference, package, title, closing_at, project_id, projects!inner(name)')
  if (error) return { error: refusal(error) }
  const row = (data as ({ reference: string | null; package: string; title: string; closing_at: string; projects: { name: string } }[]) | null)?.[0]
  if (!row) return { error: 'Nothing was changed' }
  const { subject, html } = renderClosingExtendedEmail({
    projectName: row.projects?.name ?? '',
    tender: { package: row.package, title: row.title, reference: row.reference },
    newClosing: row.closing_at,
  })
  const out = await sendToMany(await tenderAudience(g.supabase, tenderId), subject, html)
  bust(g.tender.project_id, tenderId)
  return { data: { emailed: out.sent } }
}

/** Cancel the tender (bids stay sealed for ever) and tell the bidders. */
export async function cancelTenderAction(tenderId: string): Promise<Result<{ emailed: number }>> {
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  if (g.tender.status === 'adjudicated' || g.tender.status === 'cancelled') return { error: 'This tender can no longer be cancelled' }
  // The audience is read BEFORE the cancel: tender_invitations stays readable
  // either way, but the list belongs to the moment the decision was taken.
  const audience = await tenderAudience(g.supabase, tenderId)
  const { data, error } = await g.supabase
    .schema('projects')
    .from('tenders')
    .update({ status: 'cancelled' })
    .eq('id', tenderId)
    .select('reference, package, title, project_id, projects!inner(name)')
  if (error) return { error: refusal(error) }
  const row = (data as ({ reference: string | null; package: string; title: string; projects: { name: string } }[]) | null)?.[0]
  if (!row) return { error: 'Nothing was changed' }
  const { subject, html } = renderCancelledEmail({
    projectName: row.projects?.name ?? '',
    tender: { package: row.package, title: row.title, reference: row.reference },
  })
  const out = await sendToMany(audience, subject, html)
  bust(g.tender.project_id, tenderId)
  return { data: { emailed: out.sent } }
}
