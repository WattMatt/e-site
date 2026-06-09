import { type NextRequest, NextResponse } from 'next/server'

import { createServiceClient } from '@/lib/supabase/server'
import { requireRoleAPI } from '@/lib/auth/require-role'
import { COST_VIEW_ROLES } from '@esite/shared'
import { parseBoqXlsx } from '@/lib/boq/parse-boq-xlsx'
import { reconcile } from '@/lib/boq/reconcile'

// Node runtime: exceljs + Buffer are not available on the edge runtime.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/projects/[id]/boq/import
 *
 * Parse + reconcile a priced BOQ workbook WITHOUT persisting. The client
 * uploads the .xlsx; the server classifies/parses every sheet and reconciles
 * the computed totals against the workbook's own Main Summary, then returns the
 * `ParsedBoq` + the `ReconciliationReport` for the user to review before
 * committing via importBoqAction.
 *
 * Mirrors branding-preview/route.ts: nodejs runtime, resolve the project's org
 * via the service client, gate with requireRoleAPI against that org.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params

  // Resolve the project's organisation (service client — no RLS dependency).
  const service = createServiceClient()
  const { data: project, error: projErr } = await (service as any)
    .schema('projects')
    .from('projects')
    .select('id, organisation_id')
    .eq('id', projectId)
    .maybeSingle()

  if (projErr || !project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Gate against the project's org with the cost-view roles.
  const guard = await requireRoleAPI(COST_VIEW_ROLES, project.organisation_id)
  if (!guard.ok) return guard.response

  // Read the uploaded file from the multipart body.
  let buffer: Buffer
  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }
    buffer = Buffer.from(await (file as File).arrayBuffer())
  } catch {
    return NextResponse.json({ error: 'Could not read uploaded file' }, { status: 400 })
  }

  // Parse + reconcile (no persist).
  try {
    const parsed = await parseBoqXlsx(buffer)
    const report = reconcile(parsed)
    return NextResponse.json({ parsed, report })
  } catch (err) {
    console.error('[boq/import] parse error', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to parse the BOQ workbook' },
      { status: 400 },
    )
  }
}
