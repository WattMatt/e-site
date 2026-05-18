/**
 * Avery L7173 label-sheet PDF export route — returns a multi-page A4
 * portrait sheet of pre-cut adhesive labels (4 columns × 7 rows) for
 * the given revision. Sibling to the tag-list PDF route. Same
 * auth/policy/size-guard shape; different renderer (renderAveryLabelsPdf
 * instead of renderTagListPdf).
 *
 * Label sheet scales with cable count similarly to the full PDF; use the
 * same 'pdf' size class (300-cable cap from T10).
 */

import { type NextRequest, NextResponse } from 'next/server'
import { exportFilenameStem } from '@/lib/cable-schedule/export-payload'
import { renderAveryLabelsPdf } from '@/lib/cable-schedule/export-avery-labels'
import { assertExportPolicy } from '@/lib/cable-schedule/assert-export-policy'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const gate = await assertExportPolicy(req, 'pdf')
  if (gate instanceof NextResponse) return gate
  const { effectivePayload } = gate

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
