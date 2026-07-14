'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import {
  projectService,
  qcService,
  QC_WRITE_ROLES,
  ORG_WRITE_ROLES,
  createQcReportSchema,
  updateQcReportSchema,
  addQcEntrySchema,
  addQcCommentSchema,
} from '@esite/shared'
import type {
  CreateQcReportInput,
  UpdateQcReportInput,
  AddQcEntryInput,
  AddQcCommentInput,
} from '@esite/shared'
import { gatherQcReportData } from '@/lib/reports/qc-report-data'
import { renderQcReport } from '@/lib/reports/qc-report'
import { notifyQcIssued } from '@/lib/qc-email'

const uuidSchema = z.string().uuid()

/** Shared refusal for every mutation against a closed report. */
const CLOSED_REPORT_ERROR = 'This report is closed and can no longer be edited.'

const QC_ENTRIES_BUCKET = 'qc-report-entries'
const QC_REPORTS_BUCKET = 'qc-reports'

const QC_LIST_PATH = (projectId: string) => `/projects/${projectId}/quality-control`
const QC_REPORT_PATH = (projectId: string, reportId: string) =>
  `/projects/${projectId}/quality-control/${reportId}`

interface QcReportGateRow {
  id: string
  project_id: string
  organisation_id: string
  report_no: number
  title: string
  status: string
}

/**
 * Load a QC report with the cookie/RLS client. The read only returns rows the
 * caller can see (and drafts stay invisible to client viewers — 00172), so it
 * doubles as the tenancy gate and binds every downstream gate to the report's
 * OWN project_id — never a client-supplied one. Matches diary's
 * getEntryForGate pattern.
 */
async function loadQcReportForGate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  reportId: string,
): Promise<QcReportGateRow | null> {
  const { data } = await (supabase as any)
    .schema('projects')
    .from('qc_reports')
    .select('id, project_id, organisation_id, report_no, title, status')
    .eq('id', reportId)
    .maybeSingle()
  return (data as QcReportGateRow | null) ?? null
}

// ── Report lifecycle ──

export async function createQcReportAction(
  input: CreateQcReportInput,
): Promise<{ reportId?: string; error?: string }> {
  const parsed = createQcReportSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const project = await projectService.getById(supabase as never, parsed.data.projectId)
  if (!project) return { error: 'Project not found' }

  const gate = await requireEffectiveRole(supabase, parsed.data.projectId, QC_WRITE_ROLES)
  if (!gate.ok) return { error: gate.error }

  let report: { id: string; report_no: number }
  try {
    report = (await qcService.create(
      supabase as never,
      project.organisation_id as string,
      user.id,
      parsed.data,
    )) as { id: string; report_no: number }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  // No notification at create time — a draft is private working state (00172
  // hides it from client viewers, and its title may carry unvetted findings).
  // The roster is notified once, at issue time, via notifyQcIssued.

  revalidatePath(QC_LIST_PATH(parsed.data.projectId))
  return { reportId: report.id }
}

export async function updateQcReportAction(
  input: UpdateQcReportInput,
): Promise<{ error?: string }> {
  const parsed = updateQcReportSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const { reportId, ...patch } = parsed.data

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const report = await loadQcReportForGate(supabase, reportId)
  if (!report) return { error: 'Report not found' }

  const gate = await requireEffectiveRole(supabase, report.project_id, QC_WRITE_ROLES)
  if (!gate.ok) return { error: gate.error }

  if (report.status === 'closed') {
    return { error: CLOSED_REPORT_ERROR }
  }

  try {
    await qcService.update(supabase as never, reportId, patch)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  revalidatePath(QC_LIST_PATH(report.project_id))
  revalidatePath(QC_REPORT_PATH(report.project_id, reportId))
  return {}
}

/**
 * Permanently delete a QC report (entries/photos/comments cascade).
 *
 * Gate: ORG_WRITE_ROLES. The delete + storage cleanup run with the service
 * client (RLS-bypassing), so the in-app gate is mandatory — matching
 * snag-visit.actions.ts / diary.actions.ts.
 */
export async function deleteQcReportAction(
  reportId: string,
): Promise<{ error?: string }> {
  const parse = uuidSchema.safeParse(reportId)
  if (!parse.success) return { error: 'Invalid report id' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const report = await loadQcReportForGate(supabase, reportId)
  if (!report) return { error: 'Report not found' }

  const gate = await requireEffectiveRole(supabase, report.project_id, ORG_WRITE_ROLES)
  if (!gate.ok) return { error: gate.error }

  const service = createServiceClient()

  // Gather storage paths BEFORE the delete — the child rows cascade with it.
  const { data: entryRows } = await (service as any)
    .schema('projects').from('qc_entries')
    .select('id')
    .eq('report_id', reportId)
  const entryIds = ((entryRows ?? []) as { id: string }[]).map((e) => e.id)

  let photoPaths: string[] = []
  if (entryIds.length) {
    const { data: photoRows } = await (service as any)
      .schema('projects').from('qc_entry_photos')
      .select('file_path')
      .in('entry_id', entryIds)
    photoPaths = ((photoRows ?? []) as { file_path: string }[]).map((p) => p.file_path)
  }

  const { data: pdfRows } = await (service as any)
    .schema('projects').from('reports')
    .select('storage_path')
    .eq('source_table', 'qc_reports')
    .eq('source_id', reportId)
  const pdfPaths = ((pdfRows ?? []) as { storage_path: string }[]).map((r) => r.storage_path)

  const { error: deleteErr } = await (service as any)
    .schema('projects').from('qc_reports')
    .delete()
    .eq('id', reportId)
  if (deleteErr) return { error: deleteErr.message }

  // Best-effort cleanup — orphaned private objects/rows are harmless.
  await (service as any)
    .schema('projects').from('reports')
    .delete()
    .eq('source_table', 'qc_reports')
    .eq('source_id', reportId)
  if (photoPaths.length) {
    await service.storage.from(QC_ENTRIES_BUCKET).remove(photoPaths).catch(() => {})
  }
  if (pdfPaths.length) {
    await service.storage.from(QC_REPORTS_BUCKET).remove(pdfPaths).catch(() => {})
  }

  revalidatePath(QC_LIST_PATH(report.project_id))
  return {}
}

/**
 * Close an issued report (issued → closed).
 *
 * Gate: ORG_WRITE_ROLES. The status flip runs on the SERVICE client — the
 * effective-role gate above is the authorization boundary (per-project
 * promotions don't satisfy the table's RLS write policies; same reasoning as
 * issueQcReportAction's flip) — and is row-verified: a 0-row update surfaces
 * as an error instead of a silent no-op. The `.eq('status', 'issued')` filter
 * makes the transition atomic against a concurrent status change.
 */
export async function closeQcReportAction(
  reportId: string,
): Promise<{ error?: string }> {
  const parse = uuidSchema.safeParse(reportId)
  if (!parse.success) return { error: 'Invalid report id' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const report = await loadQcReportForGate(supabase, reportId)
  if (!report) return { error: 'Report not found' }

  const gate = await requireEffectiveRole(supabase, report.project_id, ORG_WRITE_ROLES)
  if (!gate.ok) return { error: gate.error }

  if (report.status !== 'issued') {
    return { error: 'Only an issued report can be closed.' }
  }

  const service = createServiceClient()
  const { data: closedRow, error: updateErr } = await (service as any)
    .schema('projects').from('qc_reports')
    .update({ status: 'closed' })
    .eq('id', reportId)
    .eq('status', 'issued')
    .select('id')
    .maybeSingle()
  if (updateErr) return { error: updateErr.message }
  if (!closedRow) {
    return { error: 'Close failed — the report was not updated (it may have changed in another tab).' }
  }

  revalidatePath(QC_LIST_PATH(report.project_id))
  revalidatePath(QC_REPORT_PATH(report.project_id, reportId))
  return {}
}

/**
 * Reopen a closed report (closed → issued) — closing is never a dead end.
 *
 * Gate: ORG_WRITE_ROLES. Same service-client + row-verified shape as
 * closeQcReportAction. The report returns to 'issued' (its pre-close state):
 * issued_at/issued_by and the saved PDF versions are untouched.
 */
export async function reopenQcReportAction(
  reportId: string,
): Promise<{ error?: string }> {
  const parse = uuidSchema.safeParse(reportId)
  if (!parse.success) return { error: 'Invalid report id' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const report = await loadQcReportForGate(supabase, reportId)
  if (!report) return { error: 'Report not found' }

  const gate = await requireEffectiveRole(supabase, report.project_id, ORG_WRITE_ROLES)
  if (!gate.ok) return { error: gate.error }

  if (report.status !== 'closed') {
    return { error: 'Only a closed report can be reopened.' }
  }

  const service = createServiceClient()
  const { data: reopenedRow, error: updateErr } = await (service as any)
    .schema('projects').from('qc_reports')
    .update({ status: 'issued' })
    .eq('id', reportId)
    .eq('status', 'closed')
    .select('id')
    .maybeSingle()
  if (updateErr) return { error: updateErr.message }
  if (!reopenedRow) {
    return { error: 'Reopen failed — the report was not updated (it may have changed in another tab).' }
  }

  revalidatePath(QC_LIST_PATH(report.project_id))
  revalidatePath(QC_REPORT_PATH(report.project_id, reportId))
  return {}
}

// ── Entries / comments ──

export async function addQcEntryAction(
  input: AddQcEntryInput,
): Promise<{ entryId?: string; error?: string }> {
  const parsed = addQcEntrySchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const report = await loadQcReportForGate(supabase, parsed.data.reportId)
  if (!report) return { error: 'Report not found' }

  const gate = await requireEffectiveRole(supabase, report.project_id, QC_WRITE_ROLES)
  if (!gate.ok) return { error: gate.error }

  if (report.status === 'closed') {
    return { error: CLOSED_REPORT_ERROR }
  }

  let entry: { id: string }
  try {
    entry = (await qcService.addEntry(
      supabase as never,
      {
        ...parsed.data,
        organisationId: report.organisation_id,
        projectId: report.project_id,
      },
      user.id,
    )) as { id: string }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  revalidatePath(QC_REPORT_PATH(report.project_id, parsed.data.reportId))
  return { entryId: entry.id }
}

export async function addQcCommentAction(
  input: AddQcCommentInput,
): Promise<{ commentId?: string; error?: string }> {
  const parsed = addQcCommentSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // RLS read of the parent entry = tenancy gate + project resolve.
  const { data: entry } = await (supabase as any)
    .schema('projects').from('qc_entries')
    .select('id, report_id, project_id')
    .eq('id', parsed.data.entryId)
    .maybeSingle()
  if (!entry) return { error: 'Entry not found' }

  const gate = await requireEffectiveRole(supabase, entry.project_id as string, QC_WRITE_ROLES)
  if (!gate.ok) return { error: gate.error }

  // Closed-report freeze — resolve the parent report's status via RLS.
  const report = await loadQcReportForGate(supabase, entry.report_id as string)
  if (!report) return { error: 'Report not found' }
  if (report.status === 'closed') {
    return { error: CLOSED_REPORT_ERROR }
  }

  let comment: { id: string }
  try {
    comment = (await qcService.addComment(supabase as never, parsed.data, user.id)) as { id: string }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  revalidatePath(QC_REPORT_PATH(entry.project_id as string, entry.report_id as string))
  return { commentId: comment.id }
}

// ── Author-or-manager deletes (diary delete pattern: RLS read for the gate,
//    service client for the delete + best-effort storage cleanup) ──

export async function deleteQcEntryAction(
  entryId: string,
): Promise<{ error?: string }> {
  const parse = uuidSchema.safeParse(entryId)
  if (!parse.success) return { error: 'Invalid entry id' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: entry } = await (supabase as any)
    .schema('projects').from('qc_entries')
    .select('id, report_id, project_id, created_by')
    .eq('id', entryId)
    .maybeSingle()
  if (!entry) return { error: 'Entry not found' }

  // Closed-report freeze — nobody (author or manager) edits a closed record.
  const report = await loadQcReportForGate(supabase, entry.report_id as string)
  if (!report) return { error: 'Entry not found' }
  if (report.status === 'closed') {
    return { error: CLOSED_REPORT_ERROR }
  }

  const isAuthor = entry.created_by === user.id
  if (!isAuthor) {
    const gate = await requireEffectiveRole(supabase, entry.project_id as string, ORG_WRITE_ROLES)
    if (!gate.ok) return { error: 'You do not have permission to delete this entry.' }
  }

  const service = createServiceClient()

  // Photo rows cascade with the entry — gather their paths first.
  const { data: photoRows } = await (service as any)
    .schema('projects').from('qc_entry_photos')
    .select('file_path')
    .eq('entry_id', entryId)
  const photoPaths = ((photoRows ?? []) as { file_path: string }[]).map((p) => p.file_path)

  const { error: deleteErr } = await (service as any)
    .schema('projects').from('qc_entries')
    .delete()
    .eq('id', entryId)
  if (deleteErr) return { error: deleteErr.message }

  if (photoPaths.length) {
    await service.storage.from(QC_ENTRIES_BUCKET).remove(photoPaths).catch(() => {})
  }

  revalidatePath(QC_REPORT_PATH(entry.project_id as string, entry.report_id as string))
  return {}
}

export async function deleteQcPhotoAction(
  photoId: string,
): Promise<{ error?: string }> {
  const parse = uuidSchema.safeParse(photoId)
  if (!parse.success) return { error: 'Invalid photo id' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: photo } = await (supabase as any)
    .schema('projects').from('qc_entry_photos')
    .select('id, entry_id, project_id, file_path, uploaded_by')
    .eq('id', photoId)
    .maybeSingle()
  if (!photo) return { error: 'Photo not found' }

  // The parent entry supplies report_id for the revalidate path.
  const { data: entry } = await (supabase as any)
    .schema('projects').from('qc_entries')
    .select('id, report_id')
    .eq('id', photo.entry_id)
    .maybeSingle()
  if (!entry) return { error: 'Photo not found' }

  // Closed-report freeze — nobody (author or manager) edits a closed record.
  const report = await loadQcReportForGate(supabase, entry.report_id as string)
  if (!report) return { error: 'Photo not found' }
  if (report.status === 'closed') {
    return { error: CLOSED_REPORT_ERROR }
  }

  const isAuthor = photo.uploaded_by === user.id
  if (!isAuthor) {
    const gate = await requireEffectiveRole(supabase, photo.project_id as string, ORG_WRITE_ROLES)
    if (!gate.ok) return { error: 'You do not have permission to delete this photo.' }
  }

  const service = createServiceClient()
  const { error: deleteErr } = await (service as any)
    .schema('projects').from('qc_entry_photos')
    .delete()
    .eq('id', photoId)
  if (deleteErr) return { error: deleteErr.message }

  await service.storage.from(QC_ENTRIES_BUCKET).remove([photo.file_path as string]).catch(() => {})

  revalidatePath(QC_REPORT_PATH(photo.project_id as string, entry.report_id as string))
  return {}
}

export async function deleteQcCommentAction(
  commentId: string,
): Promise<{ error?: string }> {
  const parse = uuidSchema.safeParse(commentId)
  if (!parse.success) return { error: 'Invalid comment id' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: comment } = await (supabase as any)
    .schema('projects').from('qc_comments')
    .select('id, entry_id, report_id, created_by')
    .eq('id', commentId)
    .maybeSingle()
  if (!comment) return { error: 'Comment not found' }

  // Closed-report freeze — nobody (author or manager) edits a closed record.
  const report = await loadQcReportForGate(supabase, comment.report_id as string)
  if (!report) return { error: 'Comment not found' }
  if (report.status === 'closed') {
    return { error: CLOSED_REPORT_ERROR }
  }

  // Comments don't denormalise project_id — resolve it via the parent entry.
  const { data: entry } = await (supabase as any)
    .schema('projects').from('qc_entries')
    .select('id, project_id')
    .eq('id', comment.entry_id)
    .maybeSingle()
  if (!entry) return { error: 'Comment not found' }

  const isAuthor = comment.created_by === user.id
  if (!isAuthor) {
    const gate = await requireEffectiveRole(supabase, entry.project_id as string, ORG_WRITE_ROLES)
    if (!gate.ok) return { error: 'You do not have permission to delete this comment.' }
  }

  const service = createServiceClient()
  const { error: deleteErr } = await (service as any)
    .schema('projects').from('qc_comments')
    .delete()
    .eq('id', commentId)
  if (deleteErr) return { error: deleteErr.message }

  revalidatePath(QC_REPORT_PATH(entry.project_id as string, comment.report_id as string))
  return {}
}

// ── Issue (render + save + notify) ──

export type IssueQcReportResult =
  | { error: string }
  | { version: number }

/**
 * Issue a QC report.
 *
 * - RBAC: ORG_WRITE_ROLES (owner / admin / project_manager).
 * - Refuses closed reports (issue would silently reopen them) — see
 *   reopenQcReportAction for the deliberate closed → issued path.
 * - Renders the PDF via renderQcReport (gather gates internally too).
 * - Uploads to `qc-reports/{org_id}/{project_id}/qc-report-{reportId}-v{n}.pdf`.
 * - Inserts a `projects.reports` row (kind='qc', source_table='qc_reports').
 * - If a prior `status='issued'` report exists, supersedes it (re-issue bumps
 *   the version).
 * - Flips qc_reports.status to 'issued' (+ issued_at/by), then notifies the
 *   roster (bell + gated email). Mirrors exportSnagVisitReportAction.
 */
export async function issueQcReportAction(
  reportId: string,
): Promise<IssueQcReportResult> {
  const parse = uuidSchema.safeParse(reportId)
  if (!parse.success) return { error: 'Invalid report id' }

  // ── Access + role gate ────────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const report = await loadQcReportForGate(supabase, reportId)
  if (!report) return { error: 'Report not found' }

  const gate = await requireEffectiveRole(supabase, report.project_id, ORG_WRITE_ROLES)
  if (!gate.ok) return { error: gate.error }

  // Closed is terminal for issue: re-issuing would silently flip the report
  // back to 'issued' (resurrecting it in the client portal + re-emailing the
  // roster). Reopening is an explicit manager decision (reopenQcReportAction).
  if (report.status === 'closed') {
    return { error: 'This report is closed — reopen the report before re-issuing.' }
  }

  // ── Gather data + render ──────────────────────────────────────────────────
  let pdfBuffer: Buffer
  let brandingSnapshot: unknown
  let reportTitle: string

  try {
    const reportData = await gatherQcReportData(supabase, report.project_id, reportId)
    pdfBuffer = await renderQcReport(reportData)
    // Serialize branding (strip data: URIs so the snapshot stays small — keep
    // just the plain text / accent fields that describe the identity, not the
    // embedded image bytes).
    brandingSnapshot = {
      accent: reportData.branding.accent,
      issuer: reportData.branding.issuer.wordmark
        ? { wordmark: reportData.branding.issuer.wordmark }
        : { hasLogo: true },
      kicker: reportData.branding.kicker,
      projectLine: reportData.branding.projectLine,
    }
    reportTitle = `Quality Control Report ${reportData.report.reportNo} — ${reportData.report.title}`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[issueQcReportAction] gather/render error', err)
    return { error: msg }
  }

  // ── Supersede check — find the current issued report ──────────────────────
  const serviceClient = createServiceClient()

  const { data: priorRow } = await (serviceClient as any)
    .schema('projects')
    .from('reports')
    .select('id, version')
    .eq('source_table', 'qc_reports')
    .eq('source_id', reportId)
    .eq('status', 'issued')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const newVersion: number = priorRow ? (priorRow as { version: number }).version + 1 : 1

  // ── Upload PDF to storage ─────────────────────────────────────────────────
  const storagePath = `${report.organisation_id}/${report.project_id}/qc-report-${reportId}-v${newVersion}.pdf`
  const { error: uploadError } = await serviceClient.storage
    .from(QC_REPORTS_BUCKET)
    .upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: false,
    })
  if (uploadError) return { error: `Upload failed: ${uploadError.message}` }

  // ── Insert projects.reports row ───────────────────────────────────────────
  const { data: newReport, error: insertError } = await (serviceClient as any)
    .schema('projects')
    .from('reports')
    .insert({
      organisation_id: report.organisation_id,
      project_id: report.project_id,
      kind: 'qc',
      source_table: 'qc_reports',
      source_id: reportId,
      title: reportTitle,
      storage_path: storagePath,
      mime_type: 'application/pdf',
      size_bytes: pdfBuffer.length,
      status: 'issued',
      version: newVersion,
      branding_snapshot: brandingSnapshot,
      generated_by: user.id,
    })
    .select('id')
    .single()

  if (insertError) {
    // Best-effort rollback of the storage upload to avoid orphans.
    await serviceClient.storage.from(QC_REPORTS_BUCKET).remove([storagePath])
    return { error: `Failed to save report record: ${insertError.message}` }
  }

  const newReportRowId = (newReport as { id: string }).id

  // ── Supersede ALL prior issued rows for this report (self-healing) ────────
  // One statement supersedes every issued row, including any duplicates that
  // might have been created by a previous interrupted issue.
  const { error: supersededError } = await (serviceClient as any)
    .schema('projects')
    .from('reports')
    .update({ status: 'superseded', superseded_by: newReportRowId })
    .eq('source_table', 'qc_reports')
    .eq('source_id', reportId)
    .eq('status', 'issued')
    .neq('id', newReportRowId)
  if (supersededError) {
    console.error('[issueQcReportAction] supersede error', supersededError)
    // Non-blocking: the new row is valid; the UI reads the latest version by version number.
  }

  // ── Flip the QC report itself to issued ───────────────────────────────────
  // Service client: the effective-role gate above is the authorization
  // boundary (per-project promotions don't satisfy the table's inline org-role
  // RLS join).
  const { error: statusError } = await (serviceClient as any)
    .schema('projects')
    .from('qc_reports')
    .update({
      status: 'issued',
      issued_at: new Date().toISOString(),
      issued_by: user.id,
    })
    .eq('id', reportId)
  if (statusError) return { error: statusError.message }

  // ── Notify the roster (bell + gated email) — best-effort, never throws ────
  await notifyQcIssued({
    reportId,
    projectId: report.project_id,
    actorId: user.id,
  })

  revalidatePath(QC_LIST_PATH(report.project_id))
  revalidatePath(QC_REPORT_PATH(report.project_id, reportId))
  return { version: newVersion }
}
