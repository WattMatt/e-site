import { type NextRequest, NextResponse } from 'next/server'
import { exportFilenameStem } from '@/lib/cable-schedule/export-payload'
import { renderRevisionPdf } from '@/lib/cable-schedule/export-pdf'
import { assertExportPolicy, wantsRouteSheets } from '@/lib/cable-schedule/assert-export-policy'
import { loadRouteSheetAttachments } from '@/lib/cable-schedule/route-sheets'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const gate = await assertExportPolicy(req, 'pdf')
  if (gate instanceof NextResponse) return gate
  const { effectivePayload, supabase } = gate

  // Opt-in: the marked-up cable route sheets ride along. Listed through the
  // caller's session (RLS); bytes come from the bucket via the service client,
  // as every saved-report download does.
  if (wantsRouteSheets(req)) {
    effectivePayload.routeSheets = await loadRouteSheetAttachments(
      supabase,
      createServiceClient().storage,
      effectivePayload.project.id,
      effectivePayload.revision.id,
    )
  }

  const bytes = await renderRevisionPdf(effectivePayload)
  const filename = `${exportFilenameStem(effectivePayload)}.pdf`

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
