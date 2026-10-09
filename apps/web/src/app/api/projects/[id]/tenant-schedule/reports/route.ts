import { type NextRequest, NextResponse } from 'next/server'
import { gatherTenantScheduleReportData } from '@/lib/reports/tenant-schedule-report-data'
import { resolveBranding } from '@/lib/reports/branding'
import { buildTenantScheduleBrandingInput } from '@/lib/reports/tenant-schedule-report-branding'
import { renderTenantScheduleReport } from '@/lib/reports/render-tenant-schedule'
import { loadReportAppendix } from '@/lib/status-plans/report-appendix'
import { johannesburgDate } from '@/lib/status-plans/load-plan-page'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { MAX_HANDOFF_PDF_BYTES } from '@/lib/reports/pdf-limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The status-plan appendix embeds drawings: allow for the extra render time.
export const maxDuration = 120

const REPORTS_BUCKET = 'reports'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // Authorization is VIEW-level by design: gatherTenantScheduleReportData gates on
  // project access (RLS SELECT), not a manage role. A tenant schedule report is a
  // read-derived snapshot exposing nothing the viewer can't already see, so any
  // project member may generate + save one. (This is intentionally more permissive
  // than the projects.reports manage-only RLS write policy, which the service
  // client bypasses here.) Tighten to owner/admin/project_manager if that changes.

  // Gather (enforces project access) + render.
  let data: Awaited<ReturnType<typeof gatherTenantScheduleReportData>>
  try {
    data = await gatherTenantScheduleReportData(id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.toLowerCase().includes('not found')) return NextResponse.json({ error: msg }, { status: 404 })
    return NextResponse.json({ error: 'Failed to load tenant schedule data' }, { status: 500 })
  }
  const today = new Date().toISOString().slice(0, 10)
  const branding = resolveBranding(buildTenantScheduleBrandingInput(data, today))

  // Status plans (?tenantPlans=1 / ?schematicPlans=1): gated + loaded in one helper shared with the
  // other report route, so the preview and the saved version cannot differ. Colours use the SA date,
  // as on the plan page.
  const appendixResult = await loadReportAppendix({ url: req.url, sessionClient: supabase, projectId: id, today: johannesburgDate(new Date()) })
  if (!appendixResult.ok) return NextResponse.json({ error: appendixResult.error }, { status: appendixResult.status })
  let pdf: Buffer
  // What the appendix ACTUALLY holds (after embedding and any size fallback), not the loader's pre-embed counts.
  let outcome: { appended: number; notIncluded: unknown[] } | null = null
  try {
    pdf = await renderTenantScheduleReport(data, branding, appendixResult.appendix, { onOutcome: (o) => { outcome = o } })
  } catch {
    return NextResponse.json({ error: 'PDF render failed' }, { status: 500 })
  }
  // The renderer already fell back to a plan-free report when the appendix made it too big; this is
  // the last check before the `reports` bucket (50 MiB limit) would refuse the upload.
  if (pdf.length > MAX_HANDOFF_PDF_BYTES) {
    return NextResponse.json({ error: 'This report is too large to save.' }, { status: 413 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const { data: projRow } = await service.schema('projects').from('projects')
    .select('organisation_id').eq('id', id).maybeSingle()
  const orgId = (projRow as { organisation_id: string } | null)?.organisation_id
  if (!orgId) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data: priorRow } = await service.schema('projects').from('reports')
    .select('id, version').eq('project_id', id).eq('kind', 'tenant_schedule').eq('status', 'issued')
    .order('version', { ascending: false }).limit(1).maybeSingle()
  const newVersion: number = priorRow ? (priorRow as { version: number }).version + 1 : 1

  const storagePath = `${orgId}/${id}/tenant-schedule-v${newVersion}.pdf`
  const { error: upErr } = await service.storage.from(REPORTS_BUCKET)
    .upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false })
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 })

  const brandingSnapshot = {
    accent: branding.accent,
    issuer: (branding.issuer as { wordmark?: string }).wordmark ? { wordmark: (branding.issuer as { wordmark?: string }).wordmark } : { hasLogo: true },
    kicker: branding.kicker,
    projectLine: branding.projectLine,
  }

  const { data: newReport, error: insErr } = await service.schema('projects').from('reports')
    .insert({
      organisation_id: orgId,
      project_id: id,
      kind: 'tenant_schedule',
      title: 'Tenant Schedule Report',
      storage_path: storagePath,
      mime_type: 'application/pdf',
      size_bytes: pdf.length,
      status: 'issued',
      version: newVersion,
      branding_snapshot: brandingSnapshot,
      generated_by: user.id,
      // What this version holds (00183 summary): the saved-reports panel can say so.
      summary: outcome
        ? { statusPlans: (outcome as { appended: number }).appended, statusPlansNotIncluded: (outcome as { notIncluded: unknown[] }).notIncluded.length }
        : null,
    })
    .select('id, version').single()
  if (insErr || !newReport) {
    await service.storage.from(REPORTS_BUCKET).remove([storagePath])
    return NextResponse.json({ error: `Failed to save report: ${(insErr as { message?: string } | null)?.message ?? 'unknown'}` }, { status: 500 })
  }
  const reportId = (newReport as { id: string }).id

  await service.schema('projects').from('reports')
    .update({ status: 'superseded', superseded_by: reportId })
    .eq('project_id', id).eq('kind', 'tenant_schedule').eq('status', 'issued').neq('id', reportId)

  return NextResponse.json({ reportId, version: newVersion }, { status: 201 })
}
