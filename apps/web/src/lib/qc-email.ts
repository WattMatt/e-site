/**
 * QC-report notifications — bell + email to the full project roster, via the
 * shared `notifyEntityEvent` helper (one live recipient resolve for both
 * channels). Called by issueQcReportAction AFTER the PDF is saved and the
 * report row is flipped to issued, so the email can carry a 7-day signed link
 * to the exact version just published. Email is gated by the project
 * `notifyQcEmail` toggle. Best-effort and never throws — a notification
 * failure must not block (or surface from) the issue.
 */

import { projectSettingsService, renderQcIssuedEmail } from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'
import { notifyEntityEvent } from './notify'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.e-site.live'
const QC_REPORTS_BUCKET = 'qc-reports'
const SIGNED_URL_TTL = 60 * 60 * 24 * 7 // 7 days — survives email-client open delays

export interface NotifyQcIssuedArgs {
  reportId: string
  projectId: string
  /** The issuer (excluded from the bell). */
  actorId: string
}

export async function notifyQcIssued(args: NotifyQcIssuedArgs): Promise<void> {
  try {
    const svc = createServiceClient()
    const cfg = await projectSettingsService.getNotificationConfig(svc as any, args.projectId)

    const { data: report } = await (svc as any)
      .schema('projects').from('qc_reports')
      .select('id, report_no, title')
      .eq('id', args.reportId).maybeSingle()
    if (!report) return

    const { data: issuer } = await svc
      .from('profiles').select('full_name').eq('id', args.actorId).maybeSingle()
    const { data: project } = await (svc as any)
      .schema('projects').from('projects').select('name').eq('id', args.projectId).maybeSingle()

    // Entry/photo counts for the summary line. Photos carry entry_id (not
    // report_id), so resolve them through the report's entries.
    const { data: entryRows } = await (svc as any)
      .schema('projects').from('qc_entries')
      .select('id')
      .eq('report_id', args.reportId)
    const entryIds = ((entryRows ?? []) as { id: string }[]).map((e) => e.id)
    let photoCount = 0
    if (entryIds.length) {
      const { data: photoRows } = await (svc as any)
        .schema('projects').from('qc_entry_photos')
        .select('id')
        .in('entry_id', entryIds)
      photoCount = (photoRows ?? []).length
    }

    // 7-day signed link to the just-saved PDF (latest issued version). Signing
    // failure just omits the link — the deep link still gets people there.
    const { data: pdfRow } = await (svc as any)
      .schema('projects').from('reports')
      .select('storage_path')
      .eq('source_table', 'qc_reports')
      .eq('source_id', args.reportId)
      .eq('status', 'issued')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    let pdfUrl: string | null = null
    if (pdfRow?.storage_path) {
      const { data: signed } = await svc.storage
        .from(QC_REPORTS_BUCKET)
        .createSignedUrl(pdfRow.storage_path as string, SIGNED_URL_TTL)
      pdfUrl = signed?.signedUrl ?? null
    }

    const route = `/projects/${args.projectId}/quality-control/${args.reportId}`
    const { subject, html } = renderQcIssuedEmail({
      projectName: project?.name ?? 'your project',
      reportTitle: report.title as string,
      reportNo: report.report_no as number,
      issuerName: issuer?.full_name ?? 'A team member',
      entryCount: entryIds.length,
      photoCount,
      deepLink: `${SITE_URL}${route}`,
      pdfUrl,
    })

    await notifyEntityEvent({
      projectId: args.projectId,
      actorId: args.actorId,
      bell: {
        title: 'QC report issued',
        body: `"${report.title}" — QC Report ${report.report_no}`,
        route,
        type: 'qc_issued',
        entityType: 'qc_report',
        entityId: args.reportId,
      },
      email: { enabled: cfg.qcEmail, subject, html },
    })
  } catch {
    // Notification failures must never propagate to the issue.
  }
}
