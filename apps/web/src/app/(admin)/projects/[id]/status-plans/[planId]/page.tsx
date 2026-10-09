import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { loadStatusPlanPage } from '@/lib/status-plans/load-plan-page'
import { statusPlansHref } from '@/lib/status-plans/plan-urls'
import { StatusPlanWorkspace } from './StatusPlanWorkspace'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Status plan' }

interface Props {
  params: Promise<{ id: string; planId: string }>
  /** `?shape=` selects a shape — the tenant schedule's "On plan" link. */
  searchParams: Promise<{ shape?: string }>
}

/**
 * One status plan: the drawing page with its shapes coloured from live facts.
 * Every project role reads (RLS + site scope through the caller's session);
 * owner/admin/PM edit. The props are assembled in loadStatusPlanPage and are
 * JSON only — this page adds nothing to them (page-props.contract.test.ts).
 */
export default async function StatusPlanPage({ params, searchParams }: Props) {
  const { id: projectId, planId } = await params
  const { shape } = await searchParams
  const supabase = await createClient()
  const props = await loadStatusPlanPage(supabase, { projectId, planId, requestedShapeId: shape ?? null })
  if (!props) notFound()

  return (
    <div style={{ padding: '16px 20px' }}>
      <Link href={statusPlansHref(projectId)} style={{ fontSize: 13, color: 'var(--c-text-dim)', textDecoration: 'none' }}>
        ← Status plans
      </Link>
      <div style={{ marginTop: 8 }}>
        <StatusPlanWorkspace {...props} />
      </div>
    </div>
  )
}
