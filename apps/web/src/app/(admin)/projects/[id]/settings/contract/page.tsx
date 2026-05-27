import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { projectService } from '@esite/shared'
import type { OrgRole } from '@esite/shared'

import { getProjectSettingsCached } from '@/lib/project-settings'
import { ContractForm } from './ContractForm'

const VIEW_ROLES: ReadonlyArray<OrgRole> = ['owner', 'admin']

interface Props {
  params: Promise<{ id: string }>
}

export default async function Page({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const project = await projectService.getById(supabase as any, id).catch(() => null)
  if (!project) redirect(`/projects/${id}`)

  const orgId = (project as any).organisation_id ?? (project as any).organisationId
  const guard = await requireRole(supabase, orgId, VIEW_ROLES)
  if (!guard.ok) redirect(`/projects/${id}/settings/general`)

  const settings = await getProjectSettingsCached(id)

  // projectService.getById returns snake_case rows — extract to camelCase explicitly.
  const projectClientProps = {
    contractValue: (project as any).contract_value ?? null,
    currency: (project as any).currency ?? null,
  }

  return (
    <ContractForm
      projectId={id}
      project={projectClientProps}
      settings={settings}
    />
  )
}
