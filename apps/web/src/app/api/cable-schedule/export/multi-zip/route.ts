/**
 * Multi-revision handover ZIP — bundles every ISSUED revision on the
 * project into one download. See lib/cable-schedule/export-multi-zip.ts
 * for the pack layout + per-revision redaction/size-guard behaviour.
 *
 * Aggregate guard rails (separate from per-revision checkExportSize):
 *
 *   MAX_REVISIONS_PER_MULTI_ZIP
 *     A project with >10 ISSUED revisions is almost always a sign that
 *     someone wants a date-range bundle, not the whole history. Per-revision
 *     render (Excel + PDF + 3 CSVs) runs sequentially at ~3–5s each, so
 *     10 revisions sits comfortably under the Vercel serverless 60s
 *     timeout. Per CLAUDE.md, real projects hold 5–15 issued revisions
 *     over their lifecycle, so 10 covers nearly all valid cases.
 *     Outliers get a clear 413 instead of an opaque timeout. If this
 *     fires, the right answer is usually to narrow the range
 *     (TODO: ?since=YYYY-MM-DD) or upgrade the runtime.
 *
 * Memory shape: each rendered file lives in JSZip until generateAsync
 * compresses the whole archive at the end. Big projects can OOM the
 * 1 GB Vercel function. The per-revision MAX_CABLES_PER_PDF cap (300)
 * already bounds the per-file size; the revision-count cap above bounds
 * the count. Combined, the worst-case archive is ~10 × few-MB ≈ 25–40 MB
 * which compresses comfortably.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { renderProjectAllRevisionsZip } from '@/lib/cable-schedule/export-multi-zip'
import { getExportPolicy } from '@/lib/cable-schedule/export-role'

export const runtime = 'nodejs'

const MAX_REVISIONS_PER_MULTI_ZIP = 10

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Look up organisation_id for policy check. Extra round-trip vs.
  // single-revision routes (which get it free from getRevisionExportPayload)
  // but the client doesn't know the org and threading it through the URL
  // would be a trust boundary regression.
  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('id, organisation_id')
    .eq('id', projectId)
    .single()
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const policy = await getExportPolicy(
    supabase,
    user.id,
    (project as { organisation_id: string }).organisation_id,
    projectId,
  )
  if (!policy.canExport) {
    return NextResponse.json(
      { error: policy.reason ?? 'Forbidden' },
      { status: 403 },
    )
  }

  // Pre-check the aggregate count before doing any rendering work.
  // Cheap query — just IDs + status, no joins.
  const { data: issuedRevs } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id')
    .eq('project_id', projectId)
    .eq('status', 'ISSUED')
  const issuedCount = (issuedRevs ?? []).length
  if (issuedCount > MAX_REVISIONS_PER_MULTI_ZIP) {
    return NextResponse.json(
      {
        error: `Project has ${issuedCount} ISSUED revisions. Multi-revision pack is capped at ${MAX_REVISIONS_PER_MULTI_ZIP}. Contact support for a date-range bundle.`,
      },
      { status: 413 },
    )
  }

  const result = await renderProjectAllRevisionsZip(
    supabase,
    projectId,
    policy,
  )
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 404 })
  }

  return new NextResponse(new Uint8Array(result.bytes) as any, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
