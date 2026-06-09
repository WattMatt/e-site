import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { projectService, COST_VIEW_ROLES } from '@esite/shared'

import { listBoqAction } from '@/actions/boq.actions'
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

  return (
    <RatesTab
      projectId={id}
      canEdit={true}
      initial={'data' in res ? res.data : null}
    />
  )
}
