import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { gatherSiteFormReportData } from '@/lib/reports/site-form-report-data'
import { renderSiteFormReport } from '@/lib/reports/render-site-form'

// Node runtime: @react-pdf/renderer's renderToBuffer needs Node streams + Buffer.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const uuid = z.string().uuid()

/**
 * GET /api/projects/[id]/forms/[formId]/report
 *
 * Inline PDF preview of a site form (termination & making-safe) record.
 * Nothing is persisted — filing a versioned copy is
 * `generateAndFileSiteFormReport`, which the distribute action calls.
 *
 * Only the authentication check lives here. The REAL role gate is inside
 * gatherSiteFormReportData (requireEffectiveRole on the caller's own client,
 * before any service-role read), so it cannot be bypassed by a caller that
 * forgets to gate — and cannot drift out of step with the filing path.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; formId: string }> },
) {
  const { id: projectId, formId } = await params

  const parsed = z.tuple([uuid, uuid]).safeParse([projectId, formId])
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let reportData: Awaited<ReturnType<typeof gatherSiteFormReportData>>
  try {
    reportData = await gatherSiteFormReportData(supabase, projectId, formId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'Form not found' || msg === 'Project not found') {
      return NextResponse.json({ error: msg }, { status: 404 })
    }
    if (msg === 'Not authenticated') {
      return NextResponse.json({ error: msg }, { status: 401 })
    }
    // requireEffectiveRole failures land here — a generic 403 so no DB
    // internals leak into the response body (the PR #154 lesson).
    console.error('[site-form-report] gather error', err)
    return NextResponse.json({ error: msg }, { status: 403 })
  }

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderSiteFormReport(reportData)
  } catch (err) {
    console.error('[site-form-report] render error', err)
    return NextResponse.json({ error: 'PDF render failed' }, { status: 500 })
  }

  // Slugify the form number for the filename; a raw form_no can carry
  // characters that break a Content-Disposition header.
  const slug =
    reportData.summary.formNo.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') ||
    `site-form-${formId}`

  return new Response(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${slug}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
