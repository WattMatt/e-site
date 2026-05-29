'use server'

/**
 * Sub-organisation CRUD (migration 00109). Sub-orgs are
 * public.organisations rows marked as shadows (is_shadow=TRUE,
 * parent_organisation_id=parent's id). The parent org's owner/admin/PM
 * manages them until the sub-org's owner claims it.
 *
 * See docs/superpowers/specs/2026-05-29-membership-system-design.md.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import { requireRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES, type SubOrganisation } from '@esite/shared'

type ActionResult<T = Record<string, never>> =
  | (T extends Record<string, never> ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string }

const nameSchema = z.string().trim().min(1, 'Name required.').max(200)
const optionalText = z.string().trim().max(500).nullable().optional()
const uuidSchema = z.string().uuid()

function bust(): void {
  revalidatePath('/settings/sub-organizations')
}

/** List sub-orgs (shadow children) of the caller's primary org. */
export async function listSubOrganisations(): Promise<
  ActionResult<{ subOrganisations: SubOrganisation[] }>
> {
  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const { data, error } = await (supabase as any)
    .from('organisations')
    .select(
      'id, name, parent_organisation_id, is_shadow, address, phone, registration_number, vat_number, signatory_name, signatory_title, created_at',
    )
    .eq('parent_organisation_id', ctx.organisationId)
    .order('is_shadow', { ascending: false })
    .order('name')
  if (error) return { ok: false, error: error.message }
  return { ok: true, subOrganisations: (data ?? []) as SubOrganisation[] }
}
