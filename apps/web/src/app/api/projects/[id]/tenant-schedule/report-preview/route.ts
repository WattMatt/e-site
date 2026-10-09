import { type NextRequest, NextResponse } from 'next/server'
import { gatherTenantScheduleReportData } from '@/lib/reports/tenant-schedule-report-data'
import { resolveBranding } from '@/lib/reports/branding'
import { buildTenantScheduleBrandingInput } from '@/lib/reports/tenant-schedule-report-branding'
import { renderTenantScheduleReport } from '@/lib/reports/render-tenant-schedule'
import { loadReportAppendix } from '@/lib/status-plans/report-appendix'
import { johannesburgDate } from '@/lib/status-plans/load-plan-page'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { pdfHandoffResponse, tenantSchedulePreviewPath, type HandoffStorage } from '@/lib/reports/pdf-handoff'

/*
 * The preview is never streamed in the response: with the status-plan appendix it can pass Vercel's
 * ~4.5 MB limit. It is uploaded to the service-only `reports` bucket at a per-user path (overwritten
 * each preview) and the route answers 303 to a 10-minute signed URL; TenantScheduleReportButton's
 * fetch follows it and frames the result as a blob: URL, as before.
 *
 * Gate: gatherTenantScheduleReportData reads the project as the caller (site_scope) and throws when
 * it is not visible; the org for the path is read through the caller's session too. The service
 * client is created only after both.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The status-plan appendix embeds drawings: allow for the extra render time.
export const maxDuration = 60

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let data: Awaited<ReturnType<typeof gatherTenantScheduleReportData>>
  try {
    data = await gatherTenantScheduleReportData(id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.toLowerCase().includes('not found')) return NextResponse.json({ error: msg }, { status: 404 })
    console.error('[tenant-schedule-report-preview] gather error', err)
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
  try {
    pdf = await renderTenantScheduleReport(data, branding, appendixResult.appendix)
  } catch (err) {
    console.error('[tenant-schedule-report-preview] render error', err)
    return NextResponse.json({ error: 'PDF render failed' }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: projRow } = await (supabase as any).schema('projects').from('projects')
    .select('organisation_id').eq('id', id).maybeSingle()
  const orgId = (projRow as { organisation_id?: string } | null)?.organisation_id
  if (!orgId) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const service = createServiceClient()
  return pdfHandoffResponse(service.storage as unknown as HandoffStorage, tenantSchedulePreviewPath(orgId, id, user.id), new Uint8Array(pdf), {
    logTag: 'tenant-schedule-report-preview',
  })
}
