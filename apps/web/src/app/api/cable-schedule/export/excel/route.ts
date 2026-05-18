import { type NextRequest, NextResponse } from 'next/server'
import { exportFilenameStem } from '@/lib/cable-schedule/export-payload'
import { renderScheduleWorkbook } from '@/lib/cable-schedule/export-excel'
import { assertExportPolicy } from '@/lib/cable-schedule/assert-export-policy'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const gate = await assertExportPolicy(req, 'excel')
  if (gate instanceof NextResponse) return gate
  const { effectivePayload } = gate

  const buffer = await renderScheduleWorkbook(effectivePayload)
  const filename = `${exportFilenameStem(effectivePayload)}.xlsx`

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
