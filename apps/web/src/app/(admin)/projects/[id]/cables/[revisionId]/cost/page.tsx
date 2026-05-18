import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'
import {
  activeLengthM,
  type CableForCalc,
  type LengthMode,
} from '@esite/shared'
import { CostSummaryTable, type CostRow, type CostHeader } from './CostSummaryTable'
import { LengthModeToggle } from '../LengthModeToggle'
import { ensureCostLinesAction } from '@/actions/cable-cost.actions'

export const metadata: Metadata = { title: 'Cable cost summary' }

// Per-request render (no static caching). Required so ensureCostLinesAction
// fires on every visit — without this, the action runs once (on the first
// render that produced the cache) and never again. Subsequent visits served
// the cached HTML, no cost_lines rows ever got created, rate cells stayed
// disabled (the bug we chased for three iterations). Same pattern as the
// auth routes in Session 19 commit 0f99054.
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string; revisionId: string }>
  searchParams: Promise<{ view?: string }>
}

interface CableRow {
  id: string
  size_mm2: number
  measured_length_m: number | null
  confirmed_length_m: number | null
  length_status: CableForCalc['length_status']
  supply_id: string
  ohm_per_km: number | null
  derate_depth: number | null
  derate_thermal: number | null
  derate_grouping: number | null
  derate_temp: number | null
}

interface CostLine {
  id: string
  size_mm2: number
  supply_rate_per_m: number
  install_rate_per_m: number
  termination_rate_each: number
  contingency_pct: number | null
  vat_pct: number | null
}

export default async function CostSummaryPage({ params, searchParams }: Props) {
  const { id: projectId, revisionId } = await params
  const sp = await searchParams
  const lengthMode: LengthMode =
    sp.view === 'design' ? 'design'
    : sp.view === 'worst' ? 'worst'
    : 'as-built'
  const supabase = await createClient()

  const project = await projectService
    .getById(supabase as never, projectId)
    .catch(() => null)
  if (!project) notFound()

  // vat_pct landed on revisions in migration 00060. SELECT is tolerant —
  // if the column isn't applied yet, PostgREST 400s and we fall back to
  // the legacy cost_lines sentinel read (which currently null-defaults
  // to 15 in the calc below).
  let revisionRow: { id: string; code: string; status: string; project_id: string; vat_pct: number | null } | null = null
  const revQuery = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, code, status, project_id, vat_pct')
    .eq('id', revisionId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (revQuery.error) {
    // Probably "column 'vat_pct' does not exist" — migration not applied yet.
    // Fall back to the pre-00060 columns.
    const fallback = await (supabase as any)
      .schema('cable_schedule')
      .from('revisions')
      .select('id, code, status, project_id')
      .eq('id', revisionId)
      .eq('project_id', projectId)
      .maybeSingle()
    revisionRow = fallback.data ? { ...fallback.data, vat_pct: null } : null
  } else {
    revisionRow = revQuery.data
  }
  if (!revisionRow) notFound()
  const revision = revisionRow as { id: string; code: string; status: string; project_id: string; vat_pct: number | null }

  // Auto-pre-create cost_lines for every size present in the schedule but
  // missing from cost_lines. Without this, rate cells render disabled (the
  // CostSummaryTable gates EditableCell on `!r.id`) — the user sees rows
  // but can't type in them. Idempotent; only writes on DRAFT revisions.
  // Failure is non-fatal — the page still renders; user just sees disabled
  // cells and can retry by refreshing.
  if (revision.status === 'DRAFT') {
    await ensureCostLinesAction(revisionId).catch(() => {})
  }

  const [cablesRes, costRes] = await Promise.all([
    (supabase as any)
      .schema('cable_schedule')
      .from('cables')
      .select(
        'id, size_mm2, measured_length_m, confirmed_length_m, length_status, supply_id, ohm_per_km, ' +
        'derate_depth, derate_thermal, derate_grouping, derate_temp',
      )
      .eq('revision_id', revisionId),
    (supabase as any)
      .schema('cable_schedule')
      .from('cost_lines')
      .select('id, size_mm2, supply_rate_per_m, install_rate_per_m, termination_rate_each, contingency_pct, vat_pct')
      .eq('revision_id', revisionId)
      .order('size_mm2'),
  ])
  const cables = (cablesRes?.data ?? []) as unknown as CableRow[]
  const costLines = (costRes?.data ?? []) as unknown as CostLine[]

  const hasConfirmedLengths = cables.some((c) => c.confirmed_length_m != null)

  // Aggregate cable totals per size
  const totalsBySize = new Map<number, { totalLength: number; count: number }>()
  for (const c of cables) {
    const len = activeLengthM(c as unknown as CableForCalc, lengthMode) ?? 0
    const agg = totalsBySize.get(Number(c.size_mm2)) ?? { totalLength: 0, count: 0 }
    agg.totalLength += len
    agg.count += 1
    totalsBySize.set(Number(c.size_mm2), agg)
  }

  // Find rates header row (size = 0) and per-size lines
  const header = costLines.find((c) => Number(c.size_mm2) === 0) ?? null
  const sizeLines = costLines.filter((c) => Number(c.size_mm2) > 0)

  // Build merged display rows: for every size present in cables OR cost_lines.
  const allSizes = new Set<number>([
    ...sizeLines.map((c) => Number(c.size_mm2)),
    ...Array.from(totalsBySize.keys()),
  ])
  const rows: CostRow[] = [...allSizes].sort((a, b) => a - b).map((size) => {
    const cl = sizeLines.find((c) => Number(c.size_mm2) === size)
    const agg = totalsBySize.get(size)
    const totalLength = agg?.totalLength ?? 0
    const cablesOfSize = agg?.count ?? 0
    const supplyRate = cl ? Number(cl.supply_rate_per_m) : 0
    const installRate = cl ? Number(cl.install_rate_per_m) : 0
    const termRate = cl ? Number(cl.termination_rate_each) : 0
    return {
      id: cl?.id ?? null,
      size_mm2: size,
      total_length_m: totalLength,
      supply_rate_per_m: supplyRate,
      install_rate_per_m: installRate,
      termination_rate_each: termRate,
      cable_total: (supplyRate + installRate) * totalLength,
      termination_qty: cablesOfSize * 2,
      termination_total: cablesOfSize * 2 * termRate,
    }
  })

  const subtotalCables       = rows.reduce((s, r) => s + r.cable_total, 0)
  const subtotalTerminations = rows.reduce((s, r) => s + r.termination_total, 0)
  const beforeAdj            = subtotalCables + subtotalTerminations
  // Contingency removed 2026-05-17 (contracts are net). VAT is applied
  // directly to the materials+terminations subtotal.
  // VAT source priority (post-migration 00060):
  //   1. revision.vat_pct (the new canonical column on revisions table)
  //   2. legacy header?.vat_pct (cost_lines sentinel, pre-migration data)
  //   3. 15% default (the historical app default)
  const vatPct               = revision.vat_pct ?? header?.vat_pct ?? 15
  const vatAmt               = (beforeAdj * Number(vatPct)) / 100
  const grandTotal           = beforeAdj + vatAmt

  const headerRow: CostHeader = {
    id: header?.id ?? null,
    revision_id: revision.id,
    contingency_pct: 0,
    vat_pct: vatPct == null ? 15 : Number(vatPct),
    subtotalCables, subtotalTerminations, beforeAdj,
    contingencyAmt: 0, vatAmt, grandTotal,
  }

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/cables/${revisionId}`}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em',
          }}
        >
          ← {revision.code} · {project.name}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Cost summary</h1>
          <p className="page-subtitle">
            {revision.code} · {rows.length} size{rows.length !== 1 ? 's' : ''} ·
            {' '}{cables.length} cable{cables.length !== 1 ? 's' : ''} ·
            {' '}grand total <strong>{fmtZAR(grandTotal)}</strong>
          </p>
        </div>
        <LengthModeToggle
          basePath={`/projects/${projectId}/cables/${revisionId}/cost`}
          current={lengthMode}
          hasConfirmedLengths={hasConfirmedLengths}
        />
      </div>

      {rows.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px', textAlign: 'center' }}>
            💰 No cost lines yet. Open the schedule, add a cable, then return here.
          </div>
        </div>
      ) : (
        <CostSummaryTable
          rows={rows}
          header={headerRow}
          revisionId={revisionId}
          locked={revision.status !== 'DRAFT'}
        />
      )}
    </div>
  )
}

function fmtZAR(n: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency', currency: 'ZAR', maximumFractionDigits: 2,
  }).format(n)
}
