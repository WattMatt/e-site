import { type NextRequest, NextResponse } from 'next/server'
import {
  gatherEquipmentMaterialsReportData,
  buildEquipmentReportSummary,
  ReportAccessError,
} from '@/lib/reports/equipment-materials-report-data'
import { resolveBranding } from '@/lib/reports/branding'
import { buildEquipmentMaterialsBrandingInput } from '@/lib/reports/equipment-materials-report-branding'
import { renderEquipmentMaterialsReport } from '@/lib/reports/render-equipment-materials'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REPORTS_BUCKET = 'reports'
const REPORT_KIND = 'equipment_materials'
const MAX_NOTE_LENGTH = 500

/**
 * POST — render the Equipment & Materials report and persist it as the next
 * version: PDF in the `reports` bucket + a projects.reports row, superseding the
 * previously issued version.
 *
 * The role gate (ORG_WRITE_ROLES) lives in gatherEquipmentMaterialsReportData.
 * Reads of the saved artifact are gated separately and by kind — see
 * lib/reports/report-kind-access.ts and migration 00183.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // Optional revision note. Never trusted for length — it lands in a TEXT column
  // that the history list renders.
  let note: string | null = null
  try {
    const body = (await req.json().catch(() => ({}))) as { note?: unknown }
    if (typeof body.note === 'string' && body.note.trim()) {
      note = body.note.trim().slice(0, MAX_NOTE_LENGTH)
    }
  } catch {
    // No body is fine — the note is optional.
  }

  let data: Awaited<ReturnType<typeof gatherEquipmentMaterialsReportData>>
  try {
    data = await gatherEquipmentMaterialsReportData(id)
  } catch (err) {
    if (err instanceof ReportAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 })
    }
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.toLowerCase().includes('not found')) return NextResponse.json({ error: msg }, { status: 404 })
    console.error('[equipment-materials-report-save] gather error', err)
    return NextResponse.json({ error: 'Failed to load equipment & materials data' }, { status: 500 })
  }

  const today = new Date().toISOString().slice(0, 10)
  const branding = resolveBranding(buildEquipmentMaterialsBrandingInput(data, today))

  let pdf: Buffer
  try {
    pdf = await renderEquipmentMaterialsReport(data, branding)
  } catch (err) {
    console.error('[equipment-materials-report-save] render error', err)
    return NextResponse.json({ error: 'PDF render failed' }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const { data: projRow } = await service
    .schema('projects').from('projects')
    .select('organisation_id').eq('id', id).maybeSingle()
  const orgId = (projRow as { organisation_id: string } | null)?.organisation_id
  if (!orgId) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data: priorRow } = await service
    .schema('projects').from('reports')
    .select('id, version')
    .eq('project_id', id).eq('kind', REPORT_KIND).eq('status', 'issued')
    .order('version', { ascending: false }).limit(1).maybeSingle()
  const newVersion: number = priorRow ? (priorRow as { version: number }).version + 1 : 1

  const storagePath = `${orgId}/${id}/equipment-materials-v${newVersion}.pdf`
  const { error: upErr } = await service.storage.from(REPORTS_BUCKET)
    .upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false })
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 })

  const brandingSnapshot = {
    accent: branding.accent,
    issuer: (branding.issuer as { wordmark?: string }).wordmark
      ? { wordmark: (branding.issuer as { wordmark?: string }).wordmark }
      : { hasLogo: true },
    kicker: branding.kicker,
    projectLine: branding.projectLine,
  }

  const { data: newReport, error: insErr } = await service
    .schema('projects').from('reports')
    .insert({
      organisation_id: orgId,
      project_id: id,
      kind: REPORT_KIND,
      title: 'Equipment & Materials Report',
      storage_path: storagePath,
      mime_type: 'application/pdf',
      size_bytes: pdf.length,
      status: 'issued',
      version: newVersion,
      branding_snapshot: brandingSnapshot,
      summary: buildEquipmentReportSummary(data.kpis),
      note,
      generated_by: user.id,
    })
    .select('id, version').single()

  if (insErr || !newReport) {
    // Leave no orphan object behind when the row fails.
    await service.storage.from(REPORTS_BUCKET).remove([storagePath])
    return NextResponse.json(
      { error: `Failed to save report: ${(insErr as { message?: string } | null)?.message ?? 'unknown'}` },
      { status: 500 },
    )
  }
  const reportId = (newReport as { id: string }).id

  await service
    .schema('projects').from('reports')
    .update({ status: 'superseded', superseded_by: reportId })
    .eq('project_id', id).eq('kind', REPORT_KIND).eq('status', 'issued').neq('id', reportId)

  return NextResponse.json({ reportId, version: newVersion }, { status: 201 })
}
