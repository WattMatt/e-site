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

// ── Contract: atomic-ish save across projects + project_settings ──────────────

export type UpdateContractResult = { ok: true } | { error: string }

export interface UpdateContractInput {
  contractValue: number | null
  currency: string | null
  contractType: 'jbcc_pba' | 'jbcc_mwa' | 'nec3' | 'nec4' | 'fidic_red' | 'custom' | 'none'
  contractSignedDate: string | null
  practicalCompletionDate: string | null
  retentionPct: number
}

/**
 * Save the Contract tab in ONE action across two tables. The previous form did
 * two parallel non-transactional writes, so a partial failure split the figures.
 * Here the writes are sequenced and the projects-table write is reverted if the
 * project_settings write fails — best-effort, but the values never end up split.
 * (A future Postgres RPC could make this a true transaction.)
 */
export async function updateContractAction(
  projectId: string,
  input: UpdateContractInput,
  allowedRoles: readonly OrgRole[] = ORG_WRITE_ROLES,
): Promise<UpdateContractResult> {
  const supabase = await createClient()
  const proj = await resolveProjectOrg(supabase, projectId)
  if (!proj) return { error: 'Project not found' }

  const guard = await requireRole(supabase, proj.organisationId, allowedRoles)
  if (!guard.ok) return { error: guard.error }

  // Snapshot the projects-table fields so we can revert if step 2 fails.
  const { data: prior } = await (supabase as any)
    .schema('projects').from('projects')
    .select('contract_value, currency')
    .eq('id', projectId)
    .maybeSingle()

  // 1) projects.projects
  const { error: projErr } = await (supabase as any)
    .schema('projects').from('projects')
    .update({ contract_value: input.contractValue, currency: input.currency })
    .eq('id', projectId)
  if (projErr) return { error: projErr.message }

  // 2) project_settings — revert (1) on failure so the figures never split.
  try {
    await projectSettingsService.update(supabase as any, projectId, {
      contractType: input.contractType,
      contractSignedDate: input.contractSignedDate,
      practicalCompletionDate: input.practicalCompletionDate,
      retentionPct: input.retentionPct,
    })
  } catch (err) {
    await (supabase as any).schema('projects').from('projects')
      .update({ contract_value: (prior as any)?.contract_value ?? null, currency: (prior as any)?.currency ?? null })
      .eq('id', projectId)
    return { error: err instanceof Error ? err.message : 'Contract update failed' }
  }

  bust(projectId)
  revalidatePath(`/projects/${projectId}`, 'layout')
  return { ok: true }
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
