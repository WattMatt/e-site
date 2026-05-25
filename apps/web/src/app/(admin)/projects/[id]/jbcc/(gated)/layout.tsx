import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireFeature } from '@/lib/features'

export const dynamic = 'force-dynamic'

/**
 * JBCC-feature gate for the per-project JBCC subtree
 * (`/projects/[id]/jbcc/**`). Resolves the project's organisation
 * and bounces to the paywall when that org has not unlocked the module.
 *
 * The unlock page (`/projects/[id]/jbcc/unlock`) lives *outside* this route
 * group so it is never caught by this layout — there is no redirect loop.
 *
 * The role gate (project-member access) is enforced at the page level
 * and via RLS — this layout only handles the feature-unlock check.
 */
export default async function JbccGatedLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id: projectId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: project } = await supabase
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .single()
  const orgId = (project as { organisation_id: string } | null)?.organisation_id
  if (!orgId) redirect('/dashboard')

  await requireFeature(orgId, 'jbcc', supabase, `/projects/${projectId}/jbcc/unlock`)

  return <>{children}</>
}
