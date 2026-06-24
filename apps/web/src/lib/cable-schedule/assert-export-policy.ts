/**
 * Shared auth + payload + policy + redaction + size-guard preamble for
 * per-revision cable-schedule export routes (Excel, PDF, CSV, ZIP,
 * tag-list PDF, tag-labels PDF).
 *
 * Returns either a NextResponse to short-circuit, or the effective
 * payload + raw policy for the caller to render. Each caller picks
 * the size-guard format ('excel'/'pdf'/'csv'/'zip') because PDF + ZIP
 * have stricter cable-count caps than Excel/CSV.
 *
 * Route handler shape after this helper:
 *
 *   export async function GET(req: NextRequest) {
 *     const gate = await assertExportPolicy(req, 'pdf')
 *     if (gate instanceof NextResponse) return gate
 *     const { effectivePayload } = gate
 *     const bytes = await renderXxx(effectivePayload)
 *     return new Response(...)
 *   }
 *
 * multi-zip stays separate — it iterates revisions instead of taking
 * one as a query param.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getRevisionExportPayload, type ExportPayload } from './export-payload'
import {
  getExportPolicy,
  redactPayloadCost,
  checkExportSize,
  type ExportPolicy,
} from './export-role'

export interface ExportGateResult {
  effectivePayload: ExportPayload
  policy: ExportPolicy
}

export async function assertExportPolicy(
  req: NextRequest,
  format: 'excel' | 'pdf' | 'csv' | 'zip',
): Promise<NextResponse | ExportGateResult> {
  const projectId = req.nextUrl.searchParams.get('projectId')
  const revisionId = req.nextUrl.searchParams.get('revisionId')
  if (!projectId || !revisionId) {
    return NextResponse.json(
      { error: 'projectId and revisionId required' },
      { status: 400 },
    )
  }
  // Reject malformed ids up front (defense-in-depth; PostgREST is parameterized
  // already). A non-UUID would otherwise fall through to a 404.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(projectId) || !UUID_RE.test(revisionId)) {
    return NextResponse.json(
      { error: 'projectId and revisionId must be valid UUIDs' },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await getRevisionExportPayload(supabase, projectId, revisionId)
  if (!payload) {
    return NextResponse.json({ error: 'Revision not found' }, { status: 404 })
  }

  const policy = await getExportPolicy(
    supabase,
    userData.user.id,
    payload.project.organisation_id,
    payload.project.id,
  )
  if (!policy.canExport) {
    return NextResponse.json(
      { error: policy.reason ?? 'Forbidden' },
      { status: 403 },
    )
  }
  const effectivePayload = policy.redactCost ? redactPayloadCost(payload) : payload

  const sizeCheck = checkExportSize(effectivePayload, format)
  if (!sizeCheck.ok) {
    return NextResponse.json({ error: sizeCheck.reason }, { status: sizeCheck.status })
  }

  return { effectivePayload, policy }
}
