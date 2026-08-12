/**
 * file-site-form-report.ts
 *
 * Render a site form's branded PDF and file it as a versioned, superseding
 * `projects.reports` row. Mirrors exportSnagVisitReportAction (snag-visit.actions
 * .ts) and file-inspection-report.ts step-for-step, so all three report families
 * version, upload, insert and supersede identically.
 *
 * Authorisation lives in the GATHERER (gatherSiteFormReportData gates the
 * caller's cookie client before any service read). Everything after the render
 * uses the service client, exactly as the other two pipelines do.
 *
 * NOTE: `projects.reports.kind` carries no CHECK constraint (verified against
 * prod), so the new 'site_form' kind needs no migration.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { gatherSiteFormReportData } from './site-form-report-data'
import { renderSiteFormReport } from './render-site-form'

const REPORTS_BUCKET = 'reports'

export type GenerateAndFileSiteFormReportResult =
  | { reportId: string; version: number }
  | { error: string }

/**
 * Generate the PDF for `formId` and file it into projects.reports.
 *
 * Returns the new report id + its version, or `{ error }`. The caller is
 * responsible for stamping `field.site_forms.report_id` and for any
 * notification / email — this module only produces the artefact.
 */
export async function generateAndFileSiteFormReport(
  formId: string,
  projectId: string,
): Promise<GenerateAndFileSiteFormReportResult> {
  // ── 1. Gather (gated) + render ────────────────────────────────────────────
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  let pdfBuffer: Buffer
  let orgId: string
  let title: string
  let brandingSnapshot: unknown
  try {
    const data = await gatherSiteFormReportData(supabase, projectId, formId)
    pdfBuffer = await renderSiteFormReport(data)
    orgId = data.organisationId
    title = `${data.summary.formNo} — ${data.summary.boardLabel}`
    // Strip every `data:` URI from the snapshot — the embedded logo bytes would
    // bloat the row by megabytes. Keep only the identity fields.
    const issuerWordmark = (data.branding.issuer as { wordmark?: string }).wordmark
    brandingSnapshot = {
      accent: data.branding.accent,
      issuer: issuerWordmark ? { wordmark: issuerWordmark } : { hasLogo: true },
      kicker: data.branding.kicker,
      projectLine: data.branding.projectLine,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[file-site-form-report] gather/render error', err)
    return { error: message }
  }

  const service = createServiceClient() as any

  // ── 2. Version = prior issued version + 1 ─────────────────────────────────
  const { data: priorRow } = await service
    .schema('projects')
    .from('reports')
    .select('id, version')
    .eq('source_table', 'site_forms')
    .eq('source_id', formId)
    .eq('status', 'issued')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const version: number = priorRow ? (priorRow as { version: number }).version + 1 : 1

  // ── 3. Upload (never upsert — a colliding path means a lost prior version) ─
  const storagePath = `${orgId}/${projectId}/site-form-${formId}-v${version}.pdf`
  const { error: uploadError } = await service.storage
    .from(REPORTS_BUCKET)
    .upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: false })
  if (uploadError) return { error: `Upload failed: ${uploadError.message}` }

  // ── 4. Insert the report row ──────────────────────────────────────────────
  const { data: newReport, error: insertError } = await service
    .schema('projects')
    .from('reports')
    .insert({
      organisation_id: orgId,
      project_id: projectId,
      kind: 'site_form',
      source_table: 'site_forms',
      source_id: formId,
      title,
      storage_path: storagePath,
      mime_type: 'application/pdf',
      size_bytes: pdfBuffer.length,
      status: 'issued',
      version,
      branding_snapshot: brandingSnapshot,
      generated_by: user.id,
    })
    .select('id')
    .single()

  if (insertError || !newReport) {
    // Orphan-safety: the object exists but nothing references it. Remove it,
    // otherwise the next attempt collides on the same path with upsert:false.
    await service.storage.from(REPORTS_BUCKET).remove([storagePath])
    const message = (insertError as { message?: string } | null)?.message ?? 'unknown error'
    return { error: `Failed to save report record: ${message}` }
  }

  const reportId = (newReport as { id: string }).id

  // ── 5. Supersede every other issued row for this form, in one statement ───
  //     Self-healing: also catches duplicates left by an interrupted run.
  const { error: supersedeError } = await service
    .schema('projects')
    .from('reports')
    .update({ status: 'superseded', superseded_by: reportId })
    .eq('source_table', 'site_forms')
    .eq('source_id', formId)
    .eq('status', 'issued')
    .neq('id', reportId)
  if (supersedeError) {
    // Non-blocking: the new row is valid and the UI reads the highest version.
    console.error('[file-site-form-report] supersede error', supersedeError)
  }

  return { reportId, version }
}
