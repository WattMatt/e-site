import { type NextRequest, NextResponse } from 'next/server'
import { gatherTenantScheduleReportData } from '@/lib/reports/tenant-schedule-report-data'
import { resolveBranding } from '@/lib/reports/branding'
import { buildTenantScheduleBrandingInput } from '@/lib/reports/tenant-schedule-report-branding'
import { renderTenantScheduleReport } from '@/lib/reports/render-tenant-schedule'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  let pdf: Buffer
  try {
    pdf = await renderTenantScheduleReport(data, branding)
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
