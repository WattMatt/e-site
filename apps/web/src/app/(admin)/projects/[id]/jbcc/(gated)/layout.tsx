import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireFeature } from '@/lib/features'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { JBCC_WRITE_ROLES } from '@esite/shared'

export const dynamic = 'force-dynamic'

/**
 * JBCC gate for the per-project JBCC subtree (`/projects/[id]/jbcc/**`).
 * Resolves the project's organisation, enforces an explicit project-access
 * gate (the caller must hold a JBCC write role on this project — mirrors the
 * migration 00170 RLS), then bounces to the paywall when the org has not
 * unlocked the module.
 *
 * The unlock page (`/projects/[id]/jbcc/unlock`) lives *outside* this route
 * group so it is never caught by this layout — there is no redirect loop.
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

  // Explicit project-access gate: the caller must hold a JBCC write role on
  // this project (mirrors migration 00170 RLS). Checked before the paywall so
  // a non-member never lands on the unlock page for a project they can't see.
  const roleGate = await requireEffectiveRole(supabase, projectId, JBCC_WRITE_ROLES)
  if (!roleGate.ok) redirect(`/projects/${projectId}`)

  await requireFeature(orgId, 'jbcc', supabase, `/projects/${projectId}/jbcc/unlock`)

  return (
    // Construction-drafting grid applied to the outer container of all JBCC pages.
    // Uses --c-border-soft (rgba 4% white) so it stays subtle and doesn't compete
    // with content. The grid is 32px — matching the mockup exactly.
    <div
      style={{
        backgroundImage:
          'linear-gradient(var(--c-border-soft) 1px, transparent 1px), ' +
          'linear-gradient(90deg, var(--c-border-soft) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
        backgroundPosition: '-1px -1px',
        minHeight: '100%',
      }}
    >
      {children}
    </div>
  )
}
