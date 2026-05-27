import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { projectService, ORG_WRITE_ROLES } from '@esite/shared'
import type { OrgRole } from '@esite/shared'

import { listProjectContacts } from '@/actions/project-contacts.actions'
import { ContactsList } from './ContactsList'

const VIEW_ROLES: ReadonlyArray<OrgRole> = ['owner', 'admin', 'project_manager', 'contractor', 'inspector', 'supplier', 'client_viewer']

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

  const result = await listProjectContacts(id)
  const contacts = 'contacts' in result ? result.contacts : []

  return (
    <ContactsList
      projectId={id}
      initialContacts={contacts}
      canEdit={canEdit}
    />
  )
}
