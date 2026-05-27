'use server'

/**
 * Project-settings server actions: update / reset / restore.
 *
 * All three follow the same shape:
 *   1. Resolve project → organisation_id (so we gate against the *project's*
 *      org, not the caller's primary org — projects can belong to a
 *      non-primary org for multi-org users).
 *   2. requireRole(supabase, orgId, allowedRoles) — entity-scoped gate.
 *   3. Delegate to projectSettingsService (validates patch internally).
 *   4. revalidateTag + revalidatePath so the next render fetches fresh.
 *
 * Allowed roles default to ORG_WRITE_ROLES (owner/admin/project_manager).
 * Sub-pages narrower than that pass their own role list when calling.
 */

import { revalidatePath, revalidateTag } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import {
  projectSettingsService,
  ORG_WRITE_ROLES,
  type OrgRole,
  type ProjectSettings,
  type ProjectSettingsPatch,
} from '@esite/shared'

export type ProjectSettingsActionResult =
  | { settings: ProjectSettings }
  | { error: string }

async function resolveProjectOrg(
  supabase: any,
  projectId: string,
): Promise<{ organisationId: string } | null> {
  const { data } = await supabase
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!data) return null
  return { organisationId: data.organisation_id }
}

function bust(projectId: string): void {
  revalidateTag(`project-settings:${projectId}`)
  revalidatePath(`/projects/${projectId}/settings`, 'layout')
}

export async function updateProjectSettingsAction(
  projectId: string,
  patch: ProjectSettingsPatch,
  allowedRoles: readonly OrgRole[] = ORG_WRITE_ROLES,
): Promise<ProjectSettingsActionResult> {
  const supabase = await createClient()
  const proj = await resolveProjectOrg(supabase, projectId)
  if (!proj) return { error: 'Project not found' }

  const guard = await requireRole(supabase, proj.organisationId, allowedRoles)
  if (!guard.ok) return { error: guard.error }

  try {
    const settings = await projectSettingsService.update(supabase as any, projectId, patch)
    bust(projectId)
    return { settings }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Update failed' }
  }
}

export async function resetProjectSettingsAction(
  projectId: string,
  fields: ReadonlyArray<keyof ProjectSettingsPatch>,
  allowedRoles: readonly OrgRole[] = ORG_WRITE_ROLES,
): Promise<ProjectSettingsActionResult> {
  const supabase = await createClient()
  const proj = await resolveProjectOrg(supabase, projectId)
  if (!proj) return { error: 'Project not found' }

  const guard = await requireRole(supabase, proj.organisationId, allowedRoles)
  if (!guard.ok) return { error: guard.error }

  try {
    const settings = await projectSettingsService.reset(supabase as any, projectId, [...fields])
    bust(projectId)
    return { settings }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Reset failed' }
  }
}

export async function restoreProjectSettingsAction(
  projectId: string,
  historyRowId: string,
  allowedRoles: readonly OrgRole[] = ORG_WRITE_ROLES,
): Promise<ProjectSettingsActionResult> {
  const supabase = await createClient()
  const proj = await resolveProjectOrg(supabase, projectId)
  if (!proj) return { error: 'Project not found' }

  const guard = await requireRole(supabase, proj.organisationId, allowedRoles)
  if (!guard.ok) return { error: guard.error }

  try {
    const settings = await projectSettingsService.restore(supabase as any, projectId, historyRowId)
    bust(projectId)
    return { settings }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Restore failed' }
  }
}
