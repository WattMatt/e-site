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
export const metadata: Metadata = { title: 'Tenant floor plan' }

interface Props {
  params: Promise<{ id: string }>
  /** ?sheet= picks the sheet; ?shape= selects a shape (the tenant schedule's "On plan" link). */
  searchParams: Promise<{ sheet?: string; shape?: string }>
}

/**
 * The tenant floor plan: upload it, mask the shops, link them (spec 2026-10-12 §2).
 * Every project role reads (RLS + site scope through the caller's session);
 * owner / admin / PM upload and edit. The props come from loadTenantPlanPage and
 * are JSON only — this page adds nothing to them (page-props.contract.test.ts).
 */
export default async function TenantFloorPlanPage({ params, searchParams }: Props) {
  const { id: projectId } = await params
  const { sheet, shape } = await searchParams
  const supabase = await createClient()
  const data = await loadTenantPlanPage(supabase, {
    projectId, purpose: 'tenant_layout', requestedSheetId: sheet ?? null, requestedShapeId: shape ?? null,
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
