/**
 * Tag-list PDF export route — returns a multi-page A4 portrait
 * schedule-list document for the given revision. Sibling to the full
 * /export/pdf revision-pack route. Same auth/policy/size-guard shape;
 * different renderer (renderTagListPdf instead of renderRevisionPdf).
 *
 * Tag list scales with cable count similarly to the full PDF; use the
 * same 'pdf' size class (300-cable cap from T10).
 */

import { type NextRequest, NextResponse } from 'next/server'
import { exportFilenameStem } from '@/lib/cable-schedule/export-payload'
import { renderTagListPdf } from '@/lib/cable-schedule/export-tag-list-pdf'
import { assertExportPolicy } from '@/lib/cable-schedule/assert-export-policy'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const gate = await assertExportPolicy(req, 'pdf')
  if (gate instanceof NextResponse) return gate
  const { effectivePayload } = gate

  const bytes = await renderTagListPdf(effectivePayload)
  const filename = `${exportFilenameStem(effectivePayload)}-tag-list.pdf`

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
