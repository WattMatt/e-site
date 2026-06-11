import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { projectService, COST_VIEW_ROLES } from '@esite/shared'

import { listBoqAction } from '@/actions/boq.actions'
import { getApprovedAdjustmentsAction } from '@/actions/variation.actions'
import { RatesTab } from './_components/RatesTab'

interface Props {
  params: Promise<{ id: string }>
}

export default async function Page({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const project = await projectService.getById(supabase as any, id).catch(() => null)
  if (!project) notFound()

  const guard = await requireEffectiveRole(supabase, id, COST_VIEW_ROLES)
  if (!guard.ok) redirect(`/projects/${id}`)

  const res = await listBoqAction(id)

  // Approved variation qty-deltas — drives the Contract|Revised columns. A
  // failure (or none) degrades to the plain contract view.
  const adjRes = await getApprovedAdjustmentsAction(id)
  const adjustments = 'data' in adjRes ? adjRes.data.adjustments : {}

  return (
    <RatesTab
      projectId={id}
      canEdit={true}
      initial={'data' in res ? res.data : null}
      adjustments={adjustments}
    />
  )
}
