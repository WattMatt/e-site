/**
 * Solar access gates (Phase 1A). Thin wrappers over the SQL helpers in
 * migration 00207 so every page, action and API route asks the database the
 * same question the RLS policies ask. All fail CLOSED.
 *
 *   public.solar_access_level(project) → 'view' | 'edit' | 'edit_financials' | NULL
 *   public.org_has_solar(org)          → boolean (active, in-date org subscription)
 *
 * app/api/* routes sit outside (admin)/layout.tsx, so each must call
 * requireSolarLevel (or getSolarAccessLevel) itself.
 */
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isSolarAccessLevel, solarLevelAllows, type SolarAccessLevel } from '@esite/shared'

type AnyClient = SupabaseClient<any, any, any>

export async function getSolarAccessLevel(
  projectId: string,
  supabase?: AnyClient,
): Promise<SolarAccessLevel | null> {
  const client = (supabase ?? (await createClient())) as AnyClient
  const { data, error } = await client.rpc('solar_access_level', { p_project_id: projectId })
  if (error) return null
  return isSolarAccessLevel(data) ? data : null
}

/** For pages and server actions: returns the caller's level or redirects to the locked screen. */
export async function requireSolarLevel(
  projectId: string,
  need: SolarAccessLevel,
  supabase?: AnyClient,
): Promise<SolarAccessLevel> {
  const level = await getSolarAccessLevel(projectId, supabase)
  if (!solarLevelAllows(level, need)) redirect(`/projects/${projectId}/solar/locked`)
  return level as SolarAccessLevel
}

export async function orgHasSolar(organisationId: string, supabase?: AnyClient): Promise<boolean> {
  const client = (supabase ?? (await createClient())) as AnyClient
  const { data, error } = await client.rpc('org_has_solar', { p_org_id: organisationId })
  if (error) return false
  return data === true
}
