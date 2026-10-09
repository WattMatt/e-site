import { type NextRequest, NextResponse } from 'next/server'
import { gatherTenantScheduleReportData } from '@/lib/reports/tenant-schedule-report-data'
import { resolveBranding } from '@/lib/reports/branding'
import { buildTenantScheduleBrandingInput } from '@/lib/reports/tenant-schedule-report-branding'
import { renderTenantScheduleReport } from '@/lib/reports/render-tenant-schedule'
import { loadReportAppendix } from '@/lib/status-plans/report-appendix'
import { johannesburgDate } from '@/lib/status-plans/load-plan-page'
import { createClient } from '@/lib/supabase/server'

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

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="tenant-schedule.pdf"',
      'Cache-Control': 'no-store',
    },
  })
}
