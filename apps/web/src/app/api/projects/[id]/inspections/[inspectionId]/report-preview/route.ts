import { type NextRequest, NextResponse } from 'next/server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { gatherInspectionReportData } from '@/lib/reports/inspection-report-data'
import { resolveBranding, type BrandingInput } from '@/lib/reports/branding'
import { renderInspectionReport } from '@/lib/reports/render-inspection'
import {
  INLINE_PDF_MAX_BYTES,
  inspectionPreviewPath,
  pdfHandoffResponse,
  pruneOldPreviews,
  tenantSchedulePreviewFolder,
  type HandoffStorage,
} from '@/lib/reports/pdf-handoff'
import { randomBytes } from 'node:crypto'
import { requireProjectAccess } from '@/lib/auth/require-project-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; inspectionId: string }> },
) {
  const { id: projectId, inspectionId } = await params

  // ── Auth: reject unauthenticated callers ──────────────────────────────────
  // The deeper role gate (requireEffectiveRole) is enforced INSIDE
  // gatherInspectionReportData — do not duplicate it here.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // ── Gather data (I/O + RBAC gate) ─────────────────────────────────────────
  let data: Awaited<ReturnType<typeof gatherInspectionReportData>>
  try {
    data = await gatherInspectionReportData(inspectionId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // gatherInspectionReportData throws:
    //   "Inspection <id> not found"             → 404
    //   gate.error from requireEffectiveRole     → 403 (access/role errors)
    //   anything else                            → 500
    if (msg.toLowerCase().includes('not found')) {
      return NextResponse.json({ error: msg }, { status: 404 })
    }
    if (
      msg.includes('No access to this project') ||
      msg.includes('Not a member') ||
      msg.includes('not allowed to perform') ||
      msg.includes('Not authenticated')
    ) {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    console.error('[inspection-report-preview] gather error', err)
    return NextResponse.json({ error: 'Failed to load inspection data' }, { status: 500 })
  }

  // ── Build BrandingInput ────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const { brandingInput } = data

  const input: BrandingInput = {
    org: {
      name: brandingInput.orgName,
      logoSrc: brandingInput.orgLogoDataUri ?? undefined,
      accent: brandingInput.orgAccent,
    },
    project: {
      name: data.summary.projectName,
      clientLogoSrc: brandingInput.clientLogoDataUri ?? undefined,
      projectMarkSrc: brandingInput.projectMarkDataUri ?? undefined,
      accent: brandingInput.projectAccent,
      subtitle: brandingInput.projectSubtitle || undefined,
    },
    // ④ No contractor source for inspection reports — slot omitted from the
    // parties strip.
    contractor: null,
    title: 'Inspection & Test Report',
    kicker: 'ELECTRICAL INSPECTION',
    date: today,
  }

  const branding = resolveBranding(input)

  // ── Render ─────────────────────────────────────────────────────────────────
  let pdf: Buffer
  try {
    pdf = await renderInspectionReport(data, branding)
  } catch (err) {
    console.error('[inspection-report-preview] render error', err)
    return NextResponse.json({ error: 'PDF render failed' }, { status: 500 })
  }

  // A report with many photos can pass Vercel's ~4.5 MB response cap even with every photo shrunk
  // (report-image.ts): hand those over through storage and a 10-minute signed URL.
  if (pdf.byteLength > INLINE_PDF_MAX_BYTES) {
    // The file goes under the INSPECTION's own project and org, read through the caller's session,
    // never under the project id in the URL.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: insp } = await (supabase as any).schema('inspections').from('inspections')
      .select('project_id, organisation_id').eq('id', inspectionId).maybeSingle()
    const own = insp as { project_id: string; organisation_id: string } | null
    if (!own || own.project_id !== projectId) return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
    const access = await requireProjectAccess(supabase, own.project_id)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
    const storage = createServiceClient().storage as unknown as HandoffStorage
    const res = await pdfHandoffResponse(storage, inspectionPreviewPath(own.organisation_id, own.project_id, user.id, randomBytes(6).toString('hex')), new Uint8Array(pdf), {
      logTag: 'inspection-report-preview',
    })
    if (res.status === 303) await pruneOldPreviews(storage, tenantSchedulePreviewFolder(own.organisation_id, own.project_id, user.id), 3, 'inspection-')
    return res
  }

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="inspection-report.pdf"',
      'Cache-Control': 'no-store',
    },
  })
}
