import { type NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { gatherSnagVisitReportData } from '@/lib/reports/snag-visit-report-data'
import { renderSnagVisitReport } from '@/lib/reports/snag-visit-report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALL_PROJECT_ROLES = [
  'owner', 'admin', 'project_manager', 'contractor', 'inspector', 'supplier', 'client_viewer',
] as const

/**
 * GET /api/projects/[id]/snags/visits/[visitId]/report
 *
 * Inline PDF preview of the Snag & Defect Report for a specific site visit.
 * Any project member may preview. Does NOT persist to projects.reports.
 *
 * Model: branding-preview/route.ts — gate → gather → render → return inline.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; visitId: string }> },
) {
  const { id: projectId, visitId } = await params

  // ── Auth: any project member may preview ──────────────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const roleGate = await requireEffectiveRole(supabase, projectId, ALL_PROJECT_ROLES)
  if (!roleGate.ok) {
    return NextResponse.json({ error: roleGate.error }, { status: 403 })
  }

  // ── Gather data ───────────────────────────────────────────────────────────
  let reportData: Awaited<ReturnType<typeof gatherSnagVisitReportData>>
  try {
    reportData = await gatherSnagVisitReportData(supabase, projectId, visitId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'Visit not found') {
      return NextResponse.json({ error: 'Visit not found' }, { status: 404 })
    }
    if (msg === 'Project not found') {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
    console.error('[snag-visit-report] gather error', err)
    return NextResponse.json({ error: 'Failed to gather report data' }, { status: 500 })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderSnagVisitReport(reportData)
  } catch (err) {
    console.error('[snag-visit-report] render error', err)
    return NextResponse.json({ error: 'PDF render failed' }, { status: 500 })
  }

  const visitLabel = reportData.visit.isBacklog
    ? 'backlog'
    : `visit-${reportData.visit.visitNo}`

  return new Response(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="snag-defect-report-${visitLabel}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
