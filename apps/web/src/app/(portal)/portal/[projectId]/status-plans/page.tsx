import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/** The portal tab is "Tenant plans" now (spec 2026-10-12 §2). 307 for old links. */
export default async function OldPortalStatusPlans({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  redirect(`/portal/${encodeURIComponent(projectId)}/tenant-plans`)
}
