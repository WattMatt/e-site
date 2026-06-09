/**
 * Feature-unlock gating for paid add-ons (inspections module, JBCC notices, …).
 *
 * Per-org unlocks: backed by `billing.org_feature_unlocks` + `public.has_feature`
 * (migration 00097).
 *
 * Per-seat unlocks: backed by `billing.org_feature_seats` + `public.has_feature_seat`
 * (migration 00125). A seat is an org-owned paid slot assigned to a specific user.
 *
 * Both DB functions unconditionally return TRUE for the WM-Consulting org id
 * (dddddddd-0000-0000-0000-000000000001), so the platform owner bypasses every
 * unlock gate automatically — no app-side branch needed.
 */

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FeatureKey } from '@esite/shared'

export type { FeatureKey }

type AnyClient = SupabaseClient<any, any, any>

/**
 * Check whether an organisation has a feature unlocked (per-org model).
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

/**
 * Check whether a specific user within an organisation holds a per-seat feature
 * unlock (seat model, migration 00125).
 *
 * Returns false on any error (fail-closed). The WM-Consulting org always passes.
 */
export async function hasFeatureSeat(
  organisationId: string,
  userId: string,
  featureKey: FeatureKey,
  supabase?: AnyClient,
): Promise<boolean> {
  const client = (supabase ?? (await createClient())) as AnyClient
  const { data, error } = await client.rpc('has_feature_seat', {
    p_org_id:      organisationId,
    p_user_id:     userId,
    p_feature_key: featureKey,
  })
  if (error) return false
  return data === true
}

/**
 * Guard for server actions / RSC pages (per-seat model). Redirects to the
 * paywall when the user does not hold a seat for the feature in the org.
 *
 * @param paywallPath  Where to send the user when locked. Defaults to the
 *                     generator cost-recovery paywall.
 */
export async function requireFeatureSeat(
  organisationId: string,
  userId: string,
  featureKey: FeatureKey,
  supabase?: AnyClient,
  paywallPath: string = '/generator-cost-recovery/unlock',
): Promise<void> {
  const ok = await hasFeatureSeat(organisationId, userId, featureKey, supabase)
  if (!ok) redirect(paywallPath)
}
