import { type NextRequest, NextResponse } from 'next/server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { hasFeatureSeat } from '@/lib/features'
import { gatherGeneratorReportData } from '@/lib/reports/generator-report-data'
import { resolveBranding } from '@/lib/reports/branding'
import { buildGcrBrandingInput } from '@/lib/reports/generator-report-branding'
import { renderGeneratorReport } from '@/lib/reports/render-generator'
import type { GcrReportRevisionRow, GcrReportSummary } from '@esite/shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REPORTS_BUCKET = 'reports'

function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'project'
}

/**
 * POST — render the generator cost-recovery report and persist it as the next
 * immutable revision: PDF in the `reports` bucket + a gcr.report_revisions row.
 *
 * Gate order mirrors the proven report-preview route: auth → project → seat;
 * the role gate runs inside gatherGeneratorReportData. Unlike the preview,
 * a SAVED revision is a deliverable, so incomplete data is rejected (422).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: projectRow } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', id)
    .maybeSingle() as { data: { organisation_id: string } | null }

  if (!projectRow) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const hasSeat = await hasFeatureSeat(
    projectRow.organisation_id,
    user.id,
    'generator_cost_recovery',
    supabase,
  )
  if (!hasSeat) {
    return NextResponse.json(
      {
        error: 'No generator cost-recovery seat',
        unlockPath: `/projects/${id}/generator-cost-recovery/unlock`,
      },
      { status: 402 },
    )
  }

  // ── Gather (RBAC inside) ───────────────────────────────────────────────────
  let data: Awaited<ReturnType<typeof gatherGeneratorReportData>>
  try {
    data = await gatherGeneratorReportData(id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.toLowerCase().includes('not found')) {
      return NextResponse.json({ error: msg }, { status: 404 })
    }
    if (
      msg.includes('No access') ||
      msg.includes('Not a member') ||
      msg.includes('not allowed')
    ) {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    console.error('[generator-report-save] gather error', err)
    return NextResponse.json({ error: 'Failed to load generator data' }, { status: 500 })
  }

  // ── Readiness — a saved revision is a deliverable; reject incomplete data ──
  if (data.readinessGaps.length > 0) {
    return NextResponse.json(
      { error: 'Generator data is not ready for a report', gaps: data.readinessGaps },
      { status: 422 },
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10)
  const branding = resolveBranding(buildGcrBrandingInput(data, today))

  let pdf: Buffer
  try {
    pdf = await renderGeneratorReport(data, branding)
  } catch (err) {
    console.error('[generator-report-save] render error', err)
    return NextResponse.json({ error: 'PDF render failed' }, { status: 500 })
  }

  // ── Persist: upload once to a unique key, then claim the next revision no. ──
  // The object key is decoupled from the revision number so a concurrent
  // generate (unique-violation on project_id+revision_number) only retries the
  // cheap row insert, never the upload.
  const service = createServiceClient()
  const orgId = projectRow.organisation_id
  const storagePath = `${orgId}/${id}/generator-cost-recovery/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.pdf`

  const { error: uploadErr } = await (service as any).storage
    .from(REPORTS_BUCKET)
    .upload(storagePath, pdf, { contentType: 'application/pdf' })
  if (uploadErr) {
    console.error('[generator-report-save] upload error', uploadErr)
    return NextResponse.json({ error: 'Failed to store report PDF' }, { status: 500 })
  }

  const summary: GcrReportSummary = {
    monthlyCapitalRepayment: data.model.monthlyCapitalRepayment,
    finalTariff: data.model.tariff.finalTariff,
    totalCapitalCost: data.model.totalCapitalCost,
    tenantCount: data.model.allocations.length,
  }
  const slug = slugify(data.projectName)

  let revision: GcrReportRevisionRow | null = null
  let lastInsertError: unknown = null

  for (let attempt = 0; attempt < 3 && !revision; attempt++) {
    const { data: maxRow } = await (service as any)
      .schema('gcr')
      .from('report_revisions')
      .select('revision_number')
      .eq('project_id', id)
      .order('revision_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextNumber = ((maxRow as { revision_number: number } | null)?.revision_number ?? 0) + 1

    const { data: inserted, error: insertErr } = await (service as any)
      .schema('gcr')
      .from('report_revisions')
      .insert({
        project_id: id,
        organisation_id: orgId,
        revision_number: nextNumber,
        storage_path: storagePath,
        file_name: `${slug}-generator-cost-recovery-rev${nextNumber}.pdf`,
        summary,
        created_by: user.id,
      })
      .select('*')
      .single()

    if (!insertErr) {
      revision = inserted as GcrReportRevisionRow
      break
    }
    lastInsertError = insertErr
    // 23505 = unique_violation (concurrent generate claimed this number) — retry.
    if ((insertErr as { code?: string }).code !== '23505') break
  }

  if (!revision) {
    console.error('[generator-report-save] insert error', lastInsertError)
    // Best-effort: don't leave an orphaned object behind the failed row.
    await (service as any).storage.from(REPORTS_BUCKET).remove([storagePath]).catch(() => {})
    return NextResponse.json({ error: 'Failed to save report revision' }, { status: 500 })
  }

  return NextResponse.json({ revision }, { status: 201 })
}
