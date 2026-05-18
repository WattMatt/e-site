/**
 * Avery L7173 label-sheet PDF export route — returns a multi-page A4
 * portrait sheet of pre-cut adhesive labels (4 columns × 7 rows) for
 * the given revision. Sibling to the tag-list PDF route. Same
 * auth/policy/size-guard shape; different renderer (renderAveryLabelsPdf
 * instead of renderTagListPdf).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getRevisionExportPayload, exportFilenameStem } from '@/lib/cable-schedule/export-payload'
import { renderAveryLabelsPdf } from '@/lib/cable-schedule/export-avery-labels'
import {
  getExportPolicy,
  redactPayloadCost,
  checkExportSize,
} from '@/lib/cable-schedule/export-role'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')
  const revisionId = req.nextUrl.searchParams.get('revisionId')
  if (!projectId || !revisionId) {
    return NextResponse.json(
      { error: 'projectId and revisionId required' },
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

  // Label sheet scales with cable count similarly to the full PDF; use the
  // same 'pdf' size class (300-cable cap from T10).
  const sizeCheck = checkExportSize(effectivePayload, 'pdf')
  if (!sizeCheck.ok) {
    return NextResponse.json({ error: sizeCheck.reason }, { status: sizeCheck.status })
  }

  const bytes = await renderAveryLabelsPdf(effectivePayload)
  const filename = `${exportFilenameStem(effectivePayload)}-avery-l7173-labels.pdf`

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
