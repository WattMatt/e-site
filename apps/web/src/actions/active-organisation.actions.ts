'use server'

/**
 * Set the user's currently-active org context. Used by the OrgSwitcher in the
 * top nav. Writes profiles.active_organisation_id (introduced 00111). On the
 * next page render, getOrgContext picks up the new value.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'

type Result = { ok: true } | { ok: false; error: string }

const inputSchema = z.string().uuid()

export async function setActiveOrganisation(organisationId: string): Promise<Result> {
  if (!inputSchema.safeParse(organisationId).success) {
    return { ok: false, error: 'Invalid organisation id.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }

  // Confirm the caller is actually an active member of the target org.
  const { data: membership } = await (supabase as any)
    .from('user_organisations')
    .select('id')
    .eq('user_id', user.id)
    .eq('organisation_id', organisationId)
    .eq('is_active', true)
    .maybeSingle()
  if (!membership) {
    return { ok: false, error: 'You are not a member of that organisation.' }
  }

  const { error } = await (supabase as any)
    .from('profiles')
    .update({ active_organisation_id: organisationId })
    .eq('id', user.id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/', 'layout')
  return { ok: true }
}

/**
 * List the caller's active org memberships (for the switcher dropdown).
 */
export async function listMyOrganisations(): Promise<
  { ok: true; memberships: Array<{ organisation_id: string; organisation_name: string; role: string; is_active_context: boolean }> }
  | { ok: false; error: string }
> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }

  const { data: profile } = await (supabase as any)
    .from('profiles')
    .select('active_organisation_id')
    .eq('id', user.id)
    .maybeSingle()
  const activeOrgId = (profile as { active_organisation_id?: string | null } | null)?.active_organisation_id ?? null

  const { data, error } = await (supabase as any)
    .from('user_organisations')
    .select('organisation_id, role, organisation:organisations!user_organisations_organisation_id_fkey(name)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('created_at')
  if (error) return { ok: false, error: error.message }

  const memberships = (data ?? []).map((r: any) => ({
    organisation_id: r.organisation_id as string,
    organisation_name: (r.organisation?.name ?? '') as string,
    role: r.role as string,
    is_active_context: activeOrgId === r.organisation_id,
  }))

  // If no active_organisation_id is set but memberships exist, the first one
  // (oldest) is the implicit active context — flag it.
  if (!activeOrgId && memberships.length > 0) {
    memberships[0].is_active_context = true
  }

  return { ok: true, memberships }
}
