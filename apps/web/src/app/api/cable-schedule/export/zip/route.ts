import { type NextRequest, NextResponse } from 'next/server'
import { exportFilenameStem } from '@/lib/cable-schedule/export-payload'
import { renderRevisionZip } from '@/lib/cable-schedule/export-zip'
import { assertExportPolicy } from '@/lib/cable-schedule/assert-export-policy'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const gate = await assertExportPolicy(req, 'zip')
  if (gate instanceof NextResponse) return gate
  const { effectivePayload } = gate

  const bytes = await renderRevisionZip(effectivePayload)
  const filename = `${exportFilenameStem(effectivePayload)}-pack.zip`

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
