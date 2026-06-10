/**
 * Per-user access gating for the MV protection module (paywall, Phase 7).
 *
 * Backed by `billing.user_mv_subscriptions` + the
 * `public.user_has_mv_access(user_id)` SQL function (migration 00127). Unlike
 * the per-org feature unlocks in lib/features.ts, MV access is a per-USER,
 * R2000/year recurring Paystack subscription, AND it requires the user to have
 * accepted the non-validation disclaimer. Both conditions are enforced in the
 * DB function — there is no app-side branch and no owner bypass.
 */

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

type AnyClient = SupabaseClient<any, any, any>

/**
 * Check whether a user has active, in-date MV access (subscription + accepted
 * disclaimer). Returns false on any error (fail-closed).
 */
export async function hasMvAccess(
  userId: string,
  supabase?: AnyClient,
): Promise<boolean> {
  const client = (supabase ?? (await createClient())) as AnyClient
  const { data, error } = await client.rpc('user_has_mv_access', {
    p_user_id: userId,
  })
  if (error) return false
  return data === true
}

/**
 * Guard for RSC pages / server actions under the MV module. Redirects to the
 * paywall when the user lacks access. Use server-side at every MV entry point.
 *
 * @param paywallPath  Where to send the user when locked — the revision-scoped
 *                     mv-unlock page.
 */
export async function requireMvAccess(
  supabase: AnyClient,
  userId: string,
  paywallPath: string,
): Promise<void> {
  const ok = await hasMvAccess(userId, supabase)
  if (!ok) redirect(paywallPath)
}
