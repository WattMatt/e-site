import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { loadTenantPlanPage } from '@/lib/status-plans/load-plan-page'
import { tenantScheduleHref } from '@/lib/status-plans/plan-urls'
import { StatusPlanWorkspace } from '../_plans/StatusPlanWorkspace'
import { TenantPlanEmpty } from '../_plans/TenantPlanEmpty'
import { ExportSheetButton } from '../_plans/ExportSheetButton'

export const dynamic = 'force-dynamic'
/** Registering a large PDF (download + page count) runs as a server action from this page. */
export const maxDuration = 60
export const metadata: Metadata = { title: 'Line diagram' }

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ sheet?: string; shape?: string }>
}

/**
 * The line diagram (300 schematic): upload it, detect and hatch the DB blocks
 * (spec 2026-10-12 §2). Same reads and gates as the floor plan. "Export sheet"
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Link href={tenantScheduleHref(projectId)} style={{ fontSize: 13, color: 'var(--c-text-dim)', textDecoration: 'none' }}>
          ← Tenant schedule
        </Link>
        {data.kind === 'plan' && (
          <span style={{ marginLeft: 'auto' }}>
            <ExportSheetButton projectId={projectId} planId={data.props.plan.id} sheetId={data.props.sheet.id} />
          </span>
        )}
      </div>
      <div style={{ marginTop: 8 }}>
        {data.kind === 'empty' ? <TenantPlanEmpty {...data.empty} /> : <StatusPlanWorkspace {...data.props} />}
      </div>
    </div>
  )
}
