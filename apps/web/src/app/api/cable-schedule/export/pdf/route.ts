import { type NextRequest, NextResponse } from 'next/server'
import { exportFilenameStem } from '@/lib/cable-schedule/export-payload'
import { renderRevisionPdf } from '@/lib/cable-schedule/export-pdf'
import { assertExportPolicy } from '@/lib/cable-schedule/assert-export-policy'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const gate = await assertExportPolicy(req, 'pdf')
  if (gate instanceof NextResponse) return gate
  const { effectivePayload } = gate

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
