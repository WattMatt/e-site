'use server'

/**
 * Contractor-company CRUD (migration 00108) + user assignment.
 *
 * Companies are org-scoped — every read/write resolves the caller's primary
 * org via getOrgContext and gates to ORG_WRITE_ROLES for writes.
 *
 * Companies are a grouping label only. Deactivating a company does NOT
 * remove its agents from projects; that's an explicit separate action.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import { requireRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES, type ContractorCompany } from '@esite/shared'

type ActionOk<T> = T extends Record<string, never> ? { ok: true } : { ok: true } & T
type ActionErr = { ok: false; error: string }

const nameSchema = z.string().trim().min(1, 'Name required.').max(120)
const uuidSchema = z.string().uuid()

function bust(): void {
  revalidatePath('/settings/users')
}

/** List active + inactive contractor companies for the caller's primary org. */
export async function listContractorCompanies(): Promise<
  ActionOk<{ companies: ContractorCompany[] }> | ActionErr
> {
  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const { data, error } = await (supabase as any)
    .schema('projects')
    .from('contractor_companies')
    .select('id, organisation_id, name, active, created_at, created_by')
    .eq('organisation_id', ctx.organisationId)
    .order('active', { ascending: false })
    .order('name')
  if (error) return { ok: false, error: error.message }
  return { ok: true, companies: (data ?? []) as ContractorCompany[] }
}

/** Create a new contractor company. Gated to ORG_WRITE_ROLES. */
export async function addContractorCompany(
  name: string,
): Promise<ActionOk<{ company: ContractorCompany }> | ActionErr> {
  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const guard = await requireRole(supabase, ctx.organisationId, ORG_WRITE_ROLES)
  if (!guard.ok) return { ok: false, error: guard.error }

  const parsed = nameSchema.safeParse(name)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid name.' }
  }

  const { data, error } = await (supabase as any)
    .schema('projects')
    .from('contractor_companies')
    .insert({
      organisation_id: ctx.organisationId,
      name: parsed.data,
      created_by: ctx.userId,
    })
    .select('id, organisation_id, name, active, created_at, created_by')
    .single()
  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'A contractor company with that name already exists.' }
    }
    return { ok: false, error: error.message }
  }

  bust()
  return { ok: true, company: data as ContractorCompany }
}

/** Rename a contractor company. */
export async function renameContractorCompany(
  id: string,
  name: string,
): Promise<ActionOk<{ company: ContractorCompany }> | ActionErr> {
  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const guard = await requireRole(supabase, ctx.organisationId, ORG_WRITE_ROLES)
  if (!guard.ok) return { ok: false, error: guard.error }

  if (!uuidSchema.safeParse(id).success) return { ok: false, error: 'Invalid id.' }
  const parsed = nameSchema.safeParse(name)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid name.' }
  }

  const { data, error } = await (supabase as any)
    .schema('projects')
    .from('contractor_companies')
    .update({ name: parsed.data })
    .eq('id', id)
    .eq('organisation_id', ctx.organisationId)
    .select('id, organisation_id, name, active, created_at, created_by')
    .single()
  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'A contractor company with that name already exists.' }
    }
    return { ok: false, error: error.message }
  }

  bust()
  return { ok: true, company: data as ContractorCompany }
}

/** Activate or deactivate a contractor company. */
export async function setContractorCompanyActive(
  id: string,
  active: boolean,
): Promise<ActionOk<{ company: ContractorCompany }> | ActionErr> {
  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const guard = await requireRole(supabase, ctx.organisationId, ORG_WRITE_ROLES)
  if (!guard.ok) return { ok: false, error: guard.error }

  if (!uuidSchema.safeParse(id).success) return { ok: false, error: 'Invalid id.' }

  const { data, error } = await (supabase as any)
    .schema('projects')
    .from('contractor_companies')
    .update({ active })
    .eq('id', id)
    .eq('organisation_id', ctx.organisationId)
    .select('id, organisation_id, name, active, created_at, created_by')
    .single()
  if (error) return { ok: false, error: error.message }

  bust()
  return { ok: true, company: data as ContractorCompany }
}

/**
 * Assign or clear the contractor_company_id on a user_organisations row.
 * Pass null to clear (user becomes Internal / unaffiliated).
 */
export async function setUserContractorCompany(
  userId: string,
  contractorCompanyId: string | null,
): Promise<ActionOk<Record<string, never>> | ActionErr> {
  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const guard = await requireRole(supabase, ctx.organisationId, ORG_WRITE_ROLES)
  if (!guard.ok) return { ok: false, error: guard.error }

  if (!uuidSchema.safeParse(userId).success) return { ok: false, error: 'Invalid user id.' }
  if (contractorCompanyId !== null && !uuidSchema.safeParse(contractorCompanyId).success) {
    return { ok: false, error: 'Invalid company id.' }
  }

  // Sanity: if a company id is provided, it must belong to the caller's org.
  if (contractorCompanyId) {
    const { data: company } = await (supabase as any)
      .schema('projects')
      .from('contractor_companies')
      .select('id, organisation_id')
      .eq('id', contractorCompanyId)
      .eq('organisation_id', ctx.organisationId)
      .maybeSingle()
    if (!company) return { ok: false, error: 'Contractor company not found in your organisation.' }
  }

  const { error } = await (supabase as any)
    .from('user_organisations')
    .update({ contractor_company_id: contractorCompanyId })
    .eq('user_id', userId)
    .eq('organisation_id', ctx.organisationId)
  if (error) return { ok: false, error: error.message }

  bust()
  return { ok: true }
}
