'use server'
/**
 * Save the active organisation's Solar defaults (spec §11). Re-checks
 * owner/admin of THAT org with requireRole (never the page gate; note it
 * returns an object — `.ok`). Writes through the caller's session, so
 * 00208's org_settings policies (owner/admin of the row's org) and bind
 * trigger (org immutable, updated_by bound) decide. Stale-guarded.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import { requireRole } from '@/lib/auth/require-role'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { GENERIC_ERROR, STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'
import {
  OWNER_ADMIN, SOLAR_ORG_SETTINGS_VERSION, validateSolarOrgSettings, type SolarOrgSettingForm,
} from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export type SaveSolarSettingsResult =
  | { ok: true; updatedAt: string }
  | { error: string }
  | { fieldErrors: Record<string, string> }

const NOT_ADMIN = 'Only an organisation owner or admin can change Solar defaults.'

export async function saveSolarOrgSettingsAction(input: {
  form: SolarOrgSettingForm
  expectedUpdatedAt: string | null
}): Promise<SaveSolarSettingsResult> {
  const ctx = await getOrgContext()
  if (!ctx) return { error: 'You are not signed in.' }
  const supabase = (await createClient()) as unknown as AnyClient
  const gate = await requireRole(supabase as never, ctx.organisationId, OWNER_ADMIN)
  if (!gate.ok) return { error: NOT_ADMIN }

  // Directly invocable: a non-object form would throw inside the validator.
  if (!input.form || typeof input.form !== 'object' || Array.isArray(input.form)) return { error: GENERIC_ERROR }
  const check = validateSolarOrgSettings(input.form)
  if (Object.keys(check.errors).length > 0) return { fieldErrors: check.errors }
  const settings = { version: SOLAR_ORG_SETTINGS_VERSION, values: check.values }

  const table = () => supabase.schema('solar').from('org_settings')
  let updatedAt: string | undefined
  if (input.expectedUpdatedAt === null) {
    const { data, error } = await table()
      .insert({ organisation_id: ctx.organisationId, version: SOLAR_ORG_SETTINGS_VERSION, settings })
      .select('updated_at')
    if (error) return { error: error.code === '23505' ? STALE_MESSAGE : humanSolarError(error) }
    updatedAt = Array.isArray(data) ? (data[0]?.updated_at as string | undefined) : undefined
  } else {
    const { data, error } = await table()
      .update({ version: SOLAR_ORG_SETTINGS_VERSION, settings })
      .eq('organisation_id', ctx.organisationId).eq('updated_at', input.expectedUpdatedAt)
      .select('updated_at')
    if (error) return { error: humanSolarError(error) }
    if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
    updatedAt = data[0]?.updated_at as string | undefined
  }

  await emitProductEvent({ actorId: ctx.userId, projectId: null, organisationId: ctx.organisationId, event: 'solar_settings_saved' })
  revalidatePath('/settings/solar')
  return { ok: true, updatedAt: updatedAt ?? '' }
}
