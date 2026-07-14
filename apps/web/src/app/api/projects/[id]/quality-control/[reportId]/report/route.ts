import { type NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { gatherQcReportData } from '@/lib/reports/qc-report-data'
import { renderQcReport } from '@/lib/reports/qc-report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/projects/[id]/quality-control/[reportId]/report
 *
 * Inline PDF preview of a Quality Control Report.
 * Any project member may preview; client viewers only see issued reports —
 * the RLS-gated report read inside gatherQcReportData is the visibility gate,
 * so a draft surfaces to them as 404, never as a leaked preview.
 * Does NOT persist to projects.reports.
 *
 * Model: snags/visits/[visitId]/report/route.ts — auth → gather (gate inside)
 * → render → return inline.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; reportId: string }> },
) {
  const { id: projectId, reportId } = await params

  // ── Auth: reject unauthenticated callers ──────────────────────────────────
  // The deeper gates (RLS report read + requireEffectiveRole) are enforced
  // INSIDE gatherQcReportData — do not duplicate them here.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // ── Gather data (I/O + RBAC gates) ────────────────────────────────────────
  let reportData: Awaited<ReturnType<typeof gatherQcReportData>>
  try {
    reportData = await gatherQcReportData(supabase, projectId, reportId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // gatherQcReportData throws:
    //   "Report not found" / "Project not found"  → 404 (incl. RLS-invisible drafts)
    //   gate.error from requireEffectiveRole      → 403 (access/role errors)
    //   anything else                             → 500
    if (msg.toLowerCase().includes('not found')) {
      return NextResponse.json({ error: msg }, { status: 404 })
    }
    if (
      msg.includes('No access to this project') ||
      msg.includes('not allowed to perform') ||
      msg.includes('Not authenticated')
    ) {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    console.error('[qc-report] gather error', err)
    return NextResponse.json({ error: 'Failed to gather report data' }, { status: 500 })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderQcReport(reportData)
  } catch (err) {
    console.error('[qc-report] render error', err)
    return NextResponse.json({ error: 'PDF render failed' }, { status: 500 })
  }

  return new Response(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="qc-report-${reportData.report.reportNo}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
