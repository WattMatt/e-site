import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { listTemplatesAction } from '@/actions/inspections-template.actions'
import { listProjectNodesAction, listProjectMembersAction } from '@/actions/inspections.actions'
import AssignmentForm from './AssignmentForm'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'New Inspection' }

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ target_node_type?: string; target_node_id?: string }>
}

async function getOrgId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: org } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!org) redirect('/onboarding')
  return org.organisation_id as string
}

export default async function NewInspectionPage({ params, searchParams }: Props) {
  const { id: projectId } = await params
  const { target_node_type, target_node_id } = await searchParams

  const orgId = await getOrgId()
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
