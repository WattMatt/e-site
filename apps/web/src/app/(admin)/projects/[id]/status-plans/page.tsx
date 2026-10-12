import { redirect } from 'next/navigation'
import { tenantScheduleHref } from '@/lib/status-plans/plan-urls'

export const dynamic = 'force-dynamic'

/**
 * Status plans moved under the tenant schedule (spec 2026-10-12 §2): the floor
 * plan and the line diagram are its two "Tenant plans" cards. redirect() in a
 * server component answers 307, so old bookmarks keep working.
 */
export default async function StatusPlansMoved({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(tenantScheduleHref(id))
}
