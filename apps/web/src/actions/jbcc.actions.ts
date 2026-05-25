'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireRoleAPI } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { requireFeature } from '@/lib/features'
import { createParty, updateParty, deleteParty, partyInputSchema } from '@esite/shared'

export type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Internal guard — resolves org from the project, checks role + feature unlock
// ---------------------------------------------------------------------------

async function getOrgIdForProject(projectId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  return (data as { organisation_id: string } | null)?.organisation_id ?? null
}

// ---------------------------------------------------------------------------
// createPartyAction
// ---------------------------------------------------------------------------

export async function createPartyAction(
  projectId: string,
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  const orgId = await getOrgIdForProject(projectId)
  if (!orgId) return { ok: false, error: 'Project not found' }

  const role = await requireRoleAPI(ORG_WRITE_ROLES, orgId)
  if (!role.ok) return { ok: false, error: 'forbidden' }
  await requireFeature(role.ctx.organisationId, 'jbcc', undefined, `/projects/${projectId}/jbcc/unlock`)

  const parsed = partyInputSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  try {
    const party = await createParty(supabase as any, {
      project_id:      projectId,
      organisation_id: orgId,
      created_by:      user.id,
      ...parsed.data,
    })
    revalidatePath(`/projects/${projectId}/jbcc/parties`)
    return { ok: true, data: { id: party.id } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Create failed' }
  }
}

// ---------------------------------------------------------------------------
// updatePartyAction
// ---------------------------------------------------------------------------

export async function updatePartyAction(
  projectId: string,
  partyId: string,
  raw: unknown,
): Promise<ActionResult> {
  const orgId = await getOrgIdForProject(projectId)
  if (!orgId) return { ok: false, error: 'Project not found' }

  const role = await requireRoleAPI(ORG_WRITE_ROLES, orgId)
  if (!role.ok) return { ok: false, error: 'forbidden' }
  await requireFeature(role.ctx.organisationId, 'jbcc', undefined, `/projects/${projectId}/jbcc/unlock`)

  const parsed = partyInputSchema.partial().safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  try {
    await updateParty(supabase as any, partyId, parsed.data)
    revalidatePath(`/projects/${projectId}/jbcc/parties`)
    return { ok: true, data: undefined }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Update failed' }
  }
}

// ---------------------------------------------------------------------------
// deletePartyAction
// ---------------------------------------------------------------------------

export async function deletePartyAction(
  projectId: string,
  partyId: string,
): Promise<ActionResult> {
  const orgId = await getOrgIdForProject(projectId)
  if (!orgId) return { ok: false, error: 'Project not found' }

  const role = await requireRoleAPI(ORG_WRITE_ROLES, orgId)
  if (!role.ok) return { ok: false, error: 'forbidden' }
  await requireFeature(role.ctx.organisationId, 'jbcc', undefined, `/projects/${projectId}/jbcc/unlock`)

  const supabase = await createClient()
  try {
    await deleteParty(supabase as any, partyId)
    revalidatePath(`/projects/${projectId}/jbcc/parties`)
    return { ok: true, data: undefined }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Delete failed' }
  }
}
