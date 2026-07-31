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
  // Same up-front UUID validation as assertExportPolicy — a malformed id
  // should 400, not fall through to PostgREST and surface as a 404.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'projectId must be a valid UUID' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Existence check before the policy gate so a bad id 404s instead of 403ing.
  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .single()
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const policy = await getExportPolicy(supabase, user.id, projectId)
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
