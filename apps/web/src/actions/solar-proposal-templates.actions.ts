'use server'
/** Org proposal templates (spec §11 "Branding for Solar reports": disclaimer and terms). Owner/admin. */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { OWNER_ADMIN } from '@esite/shared'
import { createClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import { requireRole } from '@/lib/auth/require-role'
import { STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export async function saveSolarProposalTemplatesAction(input: {
  termsText: string; disclaimerText: string; validityDays: number; expectedUpdatedAt: string | null
}): Promise<{ ok: true; updatedAt: string } | { error: string } | { fieldErrors: Record<string, string> }> {
  const ctx = await getOrgContext()
  if (!ctx) return { error: 'You are not signed in.' }
  const supabase = (await createClient()) as unknown as AnyClient
  const g = await requireRole(supabase as never, ctx.organisationId, OWNER_ADMIN)
  if (!g.ok) return { error: 'Only an organisation owner or admin can change proposal templates.' }
  const errors: Record<string, string> = {}
  if (typeof input.termsText !== 'string' || input.termsText.length > 20000) errors.termsText = 'At most 20000 characters'
  if (typeof input.disclaimerText !== 'string' || input.disclaimerText.length > 5000) errors.disclaimerText = 'At most 5000 characters'
  if (!Number.isInteger(input.validityDays) || input.validityDays < 1 || input.validityDays > 365) errors.validityDays = 'Between 1 and 365 days'
  if (Object.keys(errors).length) return { fieldErrors: errors }
  const values = { terms_text: input.termsText, disclaimer_text: input.disclaimerText, validity_days: input.validityDays }
  const t = () => supabase.schema('solar').from('proposal_templates')
  const { data, error } = input.expectedUpdatedAt === null
    ? await t().insert({ organisation_id: ctx.organisationId, ...values }).select('updated_at')
    : await t().update(values).eq('organisation_id', ctx.organisationId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: error.code === '23505' ? STALE_MESSAGE : humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  revalidatePath('/settings/solar')
  return { ok: true, updatedAt: String((data[0] as { updated_at: string }).updated_at) }
}
