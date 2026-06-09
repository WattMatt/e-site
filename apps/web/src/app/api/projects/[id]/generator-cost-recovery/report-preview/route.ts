import { type NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { hasFeatureSeat } from '@/lib/features'
import { gatherGeneratorReportData } from '@/lib/reports/generator-report-data'
import { resolveBranding, type BrandingInput } from '@/lib/reports/branding'
import { renderGeneratorReport } from '@/lib/reports/render-generator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // ── Auth: reject unauthenticated callers ──────────────────────────────────
  // The deeper role gate (requireEffectiveRole) is enforced INSIDE
  // gatherGeneratorReportData — do not duplicate it here.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // ── Seat gate: generator_cost_recovery (per-user, per-org) ────────────────
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

  // ── Gather data (I/O + RBAC gate) ─────────────────────────────────────────
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
    console.error('[generator-report-preview] gather error', err)
    return NextResponse.json({ error: 'Failed to load generator data' }, { status: 500 })
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
      name: data.projectName,
      clientLogoSrc: brandingInput.clientLogoDataUri ?? undefined,
      projectMarkSrc: brandingInput.projectMarkDataUri ?? undefined,
      accent: brandingInput.projectAccent,
      subtitle: brandingInput.projectSubtitle || undefined,
    },
    contractor: null,
    title: 'Generator Cost-Recovery Report',
    kicker: 'STANDBY GENERATOR · COST RECOVERY',
    date: today,
  }

  const branding = resolveBranding(input)

  // ── Render ─────────────────────────────────────────────────────────────────
  let pdf: Buffer
  try {
    pdf = await renderGeneratorReport(data, branding)
  } catch (err) {
    console.error('[generator-report-preview] render error', err)
    return NextResponse.json({ error: 'PDF render failed' }, { status: 500 })
  }

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="generator-cost-recovery.pdf"',
      'Cache-Control': 'no-store',
    },
  })
}
