'use server'
/**
 * Save Site & Supply (spec §3.2). Re-checks Edit level itself
 * (requireSolarLevel redirects a lower level to /solar/locked), validates with
 * the same rules as the form, and writes through the caller's session so
 * 00208's studies_*_authz RESTRICTIVE policies and studies_bind (org binding,
 * PoC node must belong to this project, attribution) decide. First save
 * inserts; later saves are conditioned on the updated_at the user loaded.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { EMPTY_SITE_SUPPLY_FORM, validateSiteSupply, type SiteSupplyField, type SiteSupplyForm } from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export type SaveSiteResult =
  | { ok: true; updatedAt: string }
  | { error: string }
  | { fieldErrors: Partial<Record<SiteSupplyField, string>> }

export async function saveSolarSiteAction(input: {
  projectId: string
  form: SiteSupplyForm
  expectedUpdatedAt: string | null
}): Promise<SaveSiteResult> {
  const { projectId, expectedUpdatedAt } = input
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  // Server actions are directly invocable: coerce every field to a string so a
  // malformed body gets validation sentences, never a TypeError / raw 500.
  const raw = (input.form && typeof input.form === 'object' ? input.form : {}) as Record<string, unknown>
  const form = Object.fromEntries(
    (Object.keys(EMPTY_SITE_SUPPLY_FORM) as SiteSupplyField[]).map((k) => [k, raw[k] == null ? '' : String(raw[k])]),
  ) as unknown as SiteSupplyForm
  const check = validateSiteSupply(form)
  if (Object.keys(check.errors).length > 0) return { fieldErrors: check.errors }

  const studies = () => supabase.schema('solar').from('studies')
  let updatedAt: string | undefined
  if (expectedUpdatedAt === null) {
    const { data, error } = await studies().insert({ project_id: projectId, ...check.values }).select('updated_at')
    if (error) return { error: error.code === '23505' ? STALE_MESSAGE : humanSolarError(error) }
    updatedAt = Array.isArray(data) ? (data[0]?.updated_at as string | undefined) : undefined
  } else {
    const { data, error } = await studies().update(check.values)
      .eq('project_id', projectId).eq('updated_at', expectedUpdatedAt)
      .select('updated_at')
    if (error) return { error: humanSolarError(error) }
    if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
    updatedAt = data[0]?.updated_at as string | undefined
  }

  await recordSolarAudit({ projectId, actorId: user.id, verb: 'site_saved' })
  await emitProductEvent({ actorId: user.id, projectId, event: 'solar_site_saved' })
  revalidatePath(`/projects/${projectId}/solar`, 'layout')
  return { ok: true, updatedAt: updatedAt ?? '' }
}
