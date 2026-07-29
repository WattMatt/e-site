'use server'

import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const QC_REPORTS_BUCKET = 'qc-reports'
const SIGNED_URL_TTL_SECONDS = 300 // 5 minutes — portal downloads are one-shot

const uuidSchema = z.string().uuid()

type ErrResult = { error: string }

/**
 * Portal-safe signed URL for the latest issued PDF of a QC report.
 *
 * Deliberately NO role gate: both reads run on the cookie/RLS client, so the
 * caller's own row visibility is the authorization boundary —
 *  - projects.qc_reports (00176): a client_viewer sees status IN
 *    ('issued','closed') rows, so a draft report id is a miss for them, and any
 *    non-member's read returns nothing;
 *  - projects.reports (00117 reports_select): user_has_project_access.
 * On top of RLS the action explicitly requires status IN ('issued','closed')
 * (an app-layer draft block, defense-in-depth: even a staff caller — who CAN
 * read drafts under RLS — can't sign a draft's PDF through the portal path).
 * The saved PDF read stays pinned to `status='issued'` (the reports-table
 * lifecycle status of the published PDF, which closing the QC report never
 * changes). Only the signing step uses the service client (storage objects
 * aren't user-signable) — mirroring getProjectReportUrlAction.
 */
export async function getPortalQcReportPdfUrlAction(
  projectId: string,
  reportId: string,
): Promise<{ url: string } | ErrResult> {
  if (!uuidSchema.safeParse(projectId).success || !uuidSchema.safeParse(reportId).success) {
    return { error: 'Not found' }
  }

  const supabase = await createClient()

  // Visibility gate: the QC report itself must be readable by the caller.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: reportRow } = await (supabase as any)
    .schema('projects').from('qc_reports')
    .select('id, report_no, status')
    .eq('id', reportId)
    .eq('project_id', projectId)
    .maybeSingle()
  const report = reportRow as { id: string; report_no: number; status: string } | null
  if (!report) return { error: 'Not found' }

  // Only published reports have a downloadable PDF. Drafts are never portal-
  // downloadable (RLS already hides them from a client_viewer; this is the
  // explicit app-layer backstop). Closed reports stay downloadable ("Archived").
  if (report.status !== 'issued' && report.status !== 'closed') {
    return { error: 'Not found' }
  }

  // Latest issued saved PDF for this report (issue supersedes prior versions).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: savedRow } = await (supabase as any)
    .schema('projects').from('reports')
    .select('storage_path, version')
    .eq('project_id', projectId)
    .eq('kind', 'qc')
    .eq('source_table', 'qc_reports')
    .eq('source_id', reportId)
    .eq('status', 'issued')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  const saved = savedRow as { storage_path: string; version: number } | null
  if (!saved) return { error: 'No PDF is available for this report yet' }

  const service = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: signed, error: signErr } = await (service as any).storage
    .from(QC_REPORTS_BUCKET)
    .createSignedUrl(saved.storage_path, SIGNED_URL_TTL_SECONDS, {
      download: `qc-report-${report.report_no}-v${saved.version}.pdf`,
    })

  if (signErr || !signed?.signedUrl) return { error: 'Failed to create download link' }
  return { url: signed.signedUrl as string }
}
