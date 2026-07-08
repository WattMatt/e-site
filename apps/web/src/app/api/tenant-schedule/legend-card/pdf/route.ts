/**
 * Legend-card PDF export — GET ?nodeId=<uuid>&size=A4|A5
 *
 * Read-only: cookie client under RLS. Any project-visible role (including
 * client_viewer) may print; the RLS-gated node read IS the visibility gate
 * (invisible or non-tenant node → 404). `size` overrides the tenant's
 * persisted legend_card_size (default A4).
 *
 * rbac-matrix.md row added in the same PR (docs commit).
 */

import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'
import {
  renderLegendCardPdf,
  type LegendCardCircuit,
  type LegendCardSize,
} from '@/lib/db-legend/render-legend-card'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const nodeId = req.nextUrl.searchParams.get('nodeId') ?? ''
  if (!z.string().uuid().safeParse(nodeId).success) {
    return NextResponse.json({ error: 'Invalid nodeId' }, { status: 400 })
  }

  // Node — RLS-gated read doubles as the access check.
  const { data: node } = await (supabase as any)
    .schema('structure')
    .from('nodes')
    .select(
      'id, project_id, code, kind, shop_number, shop_name, breaker_rating_a, pole_config, incomer_breaker_a, incomer_pole_config',
    )
    .eq('id', nodeId)
    .eq('kind', 'tenant_db')
    .maybeSingle()
  if (!node) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const project = await projectService.getById(supabase as never, node.project_id).catch(() => null)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Header fields — best-effort (pre-00169 the columns don't exist).
  let details: {
    db_location: string | null
    db_fed_from: string | null
    db_earth_leakage_ma: number | null
    legend_card_size: 'A4' | 'A5'
  } | null = null
  try {
    const { data } = await (supabase as any)
      .schema('structure')
      .from('tenant_details')
      .select('db_location, db_fed_from, db_earth_leakage_ma, legend_card_size')
      .eq('node_id', nodeId)
      .maybeSingle()
    details = data ?? null
  } catch (err) {
    // Non-fatal — header prints with em-dashes.
    console.error('[legend-card] tenant_details read failed (non-fatal):', err)
  }

  let circuits: LegendCardCircuit[] = []
  try {
    const { data } = await (supabase as any)
      .schema('structure')
      .from('node_circuits')
      .select('circuit_no, description, phase, breaker_rating_a, poles, curve, cable_size, is_spare, sort_order')
      .eq('node_id', nodeId)
      .order('sort_order', { ascending: true })
    circuits = (data ?? []) as LegendCardCircuit[]
  } catch (err) {
    // Non-fatal — card prints "No circuits captured yet."
    console.error('[legend-card] node_circuits read failed (non-fatal):', err)
  }

  const sizeParam = req.nextUrl.searchParams.get('size')
  const size: LegendCardSize =
    sizeParam === 'A4' || sizeParam === 'A5'
      ? sizeParam
      : details?.legend_card_size === 'A5'
        ? 'A5'
        : 'A4'

  const breakerA = node.breaker_rating_a ?? node.incomer_breaker_a
  const poles = node.pole_config ?? node.incomer_pole_config
  const mainBreaker = breakerA != null ? (poles ? `${breakerA} A ${poles}` : `${breakerA} A`) : null

  const bytes = await renderLegendCardPdf(
    {
      projectName: project.name as string,
      shopNumber: node.shop_number ?? null,
      shopName: node.shop_name ?? null,
      dbCode: node.code as string,
      mainBreaker,
      header: {
        location: details?.db_location ?? null,
        fedFrom: details?.db_fed_from ?? null,
        earthLeakageMa: details?.db_earth_leakage_ma ?? null,
      },
      circuits,
      generatedAt: new Date().toISOString().slice(0, 10),
    },
    size,
  )

  const rawStem = String(node.shop_number ?? node.code).replace(/[^A-Za-z0-9._-]+/g, '-')
  const stem = rawStem.replace(/^-+|-+$/g, '') || String(node.code).replace(/[^A-Za-z0-9._-]+/g, '-')
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="legend-card-${stem}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
