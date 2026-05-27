/**
 * Settings shell layout — wraps all 12 sub-pages.
 *
 * Responsibilities:
 *   1. Resolve the project (notFound() if absent).
 *   2. Resolve the caller's role on that project's org. We DON'T do a
 *      `requireRolePage` here — every active member can VIEW the shell
 *      itself; sub-pages do their own narrower view-gates. The role is
 *      passed to <SettingsTabs> for visual marker logic.
 *   3. Render the page header (project name + breadcrumb), top tabs,
 *      and the wrapped children inside the UnsavedChangesGuard.
 */

import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import { requireRole } from '@/lib/auth/require-role'
import { projectService } from '@esite/shared'

import { SettingsTabs } from './_components/SettingsTabs'
import { UnsavedChangesGuard } from './_components/UnsavedChangesGuard'

interface Props {
  params: Promise<{ id: string }>
  children: React.ReactNode
}

export default async function SettingsLayout({ params, children }: Props) {
  const { id } = await params

  const supabase = await createClient()
  const project = await projectService.getById(supabase as any, id).catch(() => null)
  if (!project) notFound()

  // Resolve the caller's role on the project's organisation.
  // requireRole returns { ok: false, error } for non-members and
  // unauth'd users; we redirect those to /login or /dashboard.
  const guard = await requireRole(
    supabase,
    (project as any).organisation_id ?? (project as any).organisationId,
    ['owner', 'admin', 'project_manager', 'contractor', 'inspector', 'supplier', 'client_viewer'],
  )
  if (!guard.ok) {
    const ctx = await getOrgContext()
    redirect(ctx ? '/dashboard' : '/login')
  }

  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <h1 className="page-title">{(project as any).name ?? 'Project'} · Settings</h1>
        <p className="page-subtitle">Project-level configuration. Changes are audit-logged.</p>
      </div>

      <UnsavedChangesGuard>
        {/* dirtyTab wiring lives inside SettingsTabs via context — but layout
           is a server component, so we pass null here and let a future client
           wrapper plumb the live value if needed. For PR-1c (no real forms),
           dirtyTab stays null and the dot never appears. */}
        <SettingsTabs projectId={id} role={guard.role} dirtyTab={null} />
        {children}
      </UnsavedChangesGuard>
    </div>
  )
}
