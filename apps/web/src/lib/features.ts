/**
 * Feature-unlock gating for paid add-ons (inspections module, JBCC notices, …).
 *
 * Backed by `billing.org_feature_unlocks` + the `public.has_feature(org_id, key)`
 * SQL function (migration 00097). The DB function unconditionally returns TRUE
 * for the WM-Consulting org id, so the platform owner bypasses every unlock
 * gate automatically — no app-side branch needed.
 */

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FeatureKey } from '@esite/shared'

export type { FeatureKey }

type AnyClient = SupabaseClient<any, any, any>

/**
 * Check whether an organisation has a feature unlocked.
 * Returns false on any error (fail-closed).
 */
export async function hasFeature(
  organisationId: string,
  featureKey: FeatureKey,
  supabase?: AnyClient,
): Promise<boolean> {
  const client = (supabase ?? (await createClient())) as AnyClient
  const { data, error } = await client.rpc('has_feature', {
    p_org_id:      organisationId,
    p_feature_key: featureKey,
  })
  if (error) return false
  return data === true
}

/**
 * Guard for server actions / RSC pages. Redirects to the paywall when the
 * org has not unlocked the feature. Use in every entry point under the
 * gated module (server actions and route segments alike).
 *
 * @param paywallPath  Where to send the user when locked. Defaults to the
 *                     inspections paywall — pass an alternative for other
 *                     paid features.
 */
export async function requireFeature(
  organisationId: string,
  featureKey: FeatureKey,
  supabase?: AnyClient,
  paywallPath: string = '/inspections/unlock',
): Promise<void> {
  const ok = await hasFeature(organisationId, featureKey, supabase)
  if (!ok) redirect(paywallPath)
}
