import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { projectService, OWNER_ADMIN, ORG_WRITE_ROLES } from '@esite/shared'
import type { OrgRole } from '@esite/shared'

import { listProjectMembers, listAvailableOrgMembers } from '@/actions/project-members.actions'
import { listContractorCompanies } from '@/actions/contractor-companies.actions'
import { ProjectMembersList } from './ProjectMembersList'

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

  const canEdit = (ORG_WRITE_ROLES as readonly string[]).includes(guard.role ?? '')

  // Fetch project members, available org members, and contractor companies in parallel.
  const [membersResult, availableResult, companiesResult] = await Promise.all([
    listProjectMembers(id),
    canEdit ? listAvailableOrgMembers(id) : Promise.resolve({ members: [] }),
    listContractorCompanies(),
  ])

  const members = 'members' in membersResult ? membersResult.members : []
  const availableOrgMembers = 'members' in availableResult ? availableResult.members : []
  const companies =
    'companies' in companiesResult && companiesResult.ok ? companiesResult.companies : []

  // Find the org owner's user_id — used in the UI to prevent accidental self-lockout removal
  const { data: ownerRow } = await (supabase as any)
    .from('user_organisations')
    .select('user_id')
    .eq('organisation_id', orgId)
    .eq('role', 'owner')
    .eq('is_active', true)
    .maybeSingle()
  const orgOwnerId: string | null = (ownerRow as any)?.user_id ?? null

  return (
    <ProjectMembersList
      projectId={id}
      orgOwnerId={orgOwnerId}
      initialMembers={members}
      availableOrgMembers={availableOrgMembers}
      canEdit={canEdit}
      companies={companies}
    />
  )
}
