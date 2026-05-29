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

const createSchema = z.object({
  name:                nameSchema,
  address:             optionalText,
  phone:               optionalText,
  registration_number: optionalText,
  vat_number:          optionalText,
  signatory_name:      optionalText,
  signatory_title:     optionalText,
})

/** Create a new shadow sub-org under the caller's primary org. */
export async function createSubOrganisation(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ subOrganisation: SubOrganisation }>> {
  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const guard = await requireRole(supabase, ctx.organisationId, ORG_WRITE_ROLES)
  if (!guard.ok) return { ok: false, error: guard.error }

  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }

  const row = {
    name:                   parsed.data.name,
    parent_organisation_id: ctx.organisationId,
    is_shadow:              true,
    address:                parsed.data.address ?? null,
    phone:                  parsed.data.phone ?? null,
    registration_number:    parsed.data.registration_number ?? null,
    vat_number:             parsed.data.vat_number ?? null,
    signatory_name:         parsed.data.signatory_name ?? null,
    signatory_title:        parsed.data.signatory_title ?? null,
  }

  const { data, error } = await (supabase as any)
    .from('organisations')
    .insert(row)
    .select(
      'id, name, parent_organisation_id, is_shadow, address, phone, registration_number, vat_number, signatory_name, signatory_title, created_at',
    )
    .single()
  if (error) return { ok: false, error: error.message }

  bust()
  return { ok: true, subOrganisation: data as SubOrganisation }
}

const updateSchema = z.object({
  name:                nameSchema.optional(),
  address:             optionalText,
  phone:               optionalText,
  registration_number: optionalText,
  vat_number:          optionalText,
  signatory_name:      optionalText,
  signatory_title:     optionalText,
})

/** Update contact / name fields on a sub-org. Owner of the parent org only. */
export async function updateSubOrganisation(
  id: string,
  input: z.input<typeof updateSchema>,
): Promise<ActionResult<{ subOrganisation: SubOrganisation }>> {
  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const guard = await requireRole(supabase, ctx.organisationId, ORG_WRITE_ROLES)
  if (!guard.ok) return { ok: false, error: guard.error }

  if (!uuidSchema.safeParse(id).success) return { ok: false, error: 'Invalid id.' }
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }

  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) patch[key] = value
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'Nothing to update.' }
  }

  const { data, error } = await (supabase as any)
    .from('organisations')
    .update(patch)
    .eq('id', id)
    .eq('parent_organisation_id', ctx.organisationId)
    .select(
      'id, name, parent_organisation_id, is_shadow, address, phone, registration_number, vat_number, signatory_name, signatory_title, created_at',
    )
    .single()
  if (error) return { ok: false, error: error.message }

  bust()
  return { ok: true, subOrganisation: data as SubOrganisation }
}
