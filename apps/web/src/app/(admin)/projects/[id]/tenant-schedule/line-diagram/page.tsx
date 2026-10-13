import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { loadTenantPlanPage } from '@/lib/status-plans/load-plan-page'
import { tenantScheduleHref } from '@/lib/status-plans/plan-urls'
import { StatusPlanWorkspace } from '../_plans/StatusPlanWorkspace'
import { TenantPlanEmpty } from '../_plans/TenantPlanEmpty'

export const dynamic = 'force-dynamic'
/** Registering a large PDF (download + page count) runs as a server action from this page. */
export const maxDuration = 60
export const metadata: Metadata = { title: 'Line diagram' }

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ sheet?: string; shape?: string }>
}

/**
 * The line diagram (300 schematic): upload it, and an empty sheet scans itself
 * for DB blocks on open for an editor (review above the drawing), then hatch
 * them (spec 2026-10-12 §2). Same reads and gates as the floor plan. "Export sheet" (in the workspace)
 * downloads the sheet on screen at its own size.
 */
export default async function LineDiagramPage({ params, searchParams }: Props) {
  const { id: projectId } = await params
  const { sheet, shape } = await searchParams
  const supabase = await createClient()
  const data = await loadTenantPlanPage(supabase, {
    projectId, purpose: 'distribution_schematic', requestedSheetId: sheet ?? null, requestedShapeId: shape ?? null,
  })
  if (!data) notFound()

  return (
    <div style={{ padding: '16px 20px' }}>
      <Link href={tenantScheduleHref(projectId)} style={{ fontSize: 13, color: 'var(--c-text-dim)', textDecoration: 'none' }}>
        ← Tenant schedule
      </Link>
      <div style={{ marginTop: 8 }}>
        {data.kind === 'empty' ? <TenantPlanEmpty {...data.empty} /> : <StatusPlanWorkspace {...data.props} />}
      </div>
    </div>
  )
}
