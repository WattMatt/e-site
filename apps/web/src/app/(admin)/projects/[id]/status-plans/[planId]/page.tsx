import { redirect } from 'next/navigation'
import { tenantScheduleHref } from '@/lib/status-plans/plan-urls'

export const dynamic = 'force-dynamic'

/** A status plan link from before tenant plans: go to the tenant schedule (307). */
export default async function StatusPlanMoved({ params }: { params: Promise<{ id: string; planId: string }> }) {
  const { id } = await params
  redirect(tenantScheduleHref(id))
}
