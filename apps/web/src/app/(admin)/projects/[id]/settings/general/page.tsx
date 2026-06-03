import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { projectService } from '@esite/shared'
import type { OrgRole } from '@esite/shared'

import { GeneralForm } from './GeneralForm'
import { BrandingFields } from './_BrandingFields'

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

  // Fetch org name for the branding ① issuer label (best-effort; falls back gracefully).
  const service = createServiceClient()
  const { data: org } = await (service as any)
    .from('organisations')
    .select('name')
    .eq('id', orgId)
    .maybeSingle()
  const orgName: string = (org as any)?.name ?? 'Organisation'

  const p = project as any

  return (
    <>
      <GeneralForm projectId={id} initial={p} />
      <BrandingFields
        projectId={id}
        clientLogoUrl={p.client_logo_url ?? null}
        projectMarkUrl={p.project_logo_url ?? null}
        reportAccentColor={p.report_accent_color ?? null}
        orgName={orgName}
      />
    </>
  )
}
