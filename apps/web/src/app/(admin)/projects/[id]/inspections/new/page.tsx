import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { listTemplatesAction } from '@/actions/inspections-template.actions'
import { listProjectNodesAction, listProjectMembersAction } from '@/actions/inspections.actions'
import { orgRoleCanAssignInspection } from '@/lib/capture/capture-actions'
import type { OrgRole } from '@esite/shared'
import AssignmentForm from './AssignmentForm'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'New Inspection' }

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ target_node_type?: string; target_node_id?: string }>
}

/**
 * The project's organisation, and whether the caller may create an inspection in it: owner, admin
 * or project manager there, the rule inspections_insert enforces. Anyone else goes back to the list
 * rather than filling in a form that is then refused (walkthrough, 2026-10-13: a contractor did).
 */
async function getProjectOrgForCreator(projectId: string): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the projects schema is not in the generated types
  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) redirect('/projects')
  const orgId = (project as { organisation_id: string }).organisation_id

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('role')
    .eq('user_id', user.id)
    .eq('organisation_id', orgId)
    .eq('is_active', true)
    .maybeSingle()
  const role = ((membership as { role?: string } | null)?.role ?? null) as OrgRole | null
  if (!orgRoleCanAssignInspection(role)) redirect(`/projects/${projectId}/inspections`)
  return orgId
}

export default async function NewInspectionPage({ params, searchParams }: Props) {
  const { id: projectId } = await params
  const { target_node_type, target_node_id } = await searchParams

  const orgId = await getProjectOrgForCreator(projectId)
  const [templates, nodes, members] = await Promise.all([
    listTemplatesAction(orgId),
    listProjectNodesAction(projectId),
    listProjectMembersAction(projectId),
  ])

  return (
    <div className="animate-fadeup" style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/inspections`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Inspections
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">New Inspection</h1>
          <p className="page-subtitle">Pick a template, target a node, and assign a verifier.</p>
        </div>
      </div>

      <AssignmentForm
        organisationId={orgId}
        projectId={projectId}
        templates={templates.filter((t) => t.is_active)}
        nodes={nodes}
        members={members}
        prefillNodeType={target_node_type ?? null}
        prefillNodeId={target_node_id ?? null}
      />
    </div>
  )
}
