import { type NextRequest, NextResponse } from 'next/server'
import {
  gatherEquipmentMaterialsReportData,
  ReportAccessError,
} from '@/lib/reports/equipment-materials-report-data'
import { resolveBranding } from '@/lib/reports/branding'
import { buildEquipmentMaterialsBrandingInput } from '@/lib/reports/equipment-materials-report-branding'
import { renderEquipmentMaterialsReport } from '@/lib/reports/render-equipment-materials'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET — render the Equipment & Materials report and stream it, without saving.
 *
 * The role gate lives in gatherEquipmentMaterialsReportData (ORG_WRITE_ROLES).
 * Preview streams byte-identical content to the saved artifact, so gating only
 * the save route would be theatre.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let data: Awaited<ReturnType<typeof gatherEquipmentMaterialsReportData>>
  try {
    data = await gatherEquipmentMaterialsReportData(id)
  } catch (err) {
    if (err instanceof ReportAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 })
    }
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.toLowerCase().includes('not found')) return NextResponse.json({ error: msg }, { status: 404 })
    console.error('[equipment-materials-report-preview] gather error', err)
    return NextResponse.json({ error: 'Failed to load equipment & materials data' }, { status: 500 })
  }

  const today = new Date().toISOString().slice(0, 10)
  const branding = resolveBranding(buildEquipmentMaterialsBrandingInput(data, today))

  let pdf: Buffer
  try {
    pdf = await renderEquipmentMaterialsReport(data, branding)
  } catch (err) {
    console.error('[equipment-materials-report-preview] render error', err)
    return NextResponse.json({ error: 'PDF render failed' }, { status: 500 })
  }

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="equipment-materials.pdf"',
      'Cache-Control': 'no-store',
    },
  })
}
