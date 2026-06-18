'use server'

/**
 * Stamp invite acceptance.
 *
 * Invites create the user_organisations row with accepted_at = NULL (access is
 * gated on is_active, NOT accepted_at — so the row is fully usable immediately;
 * accepted_at is audit/display metadata only). This action records the moment
 * the invitee actually accepts: it sets accepted_at = now() on the calling
 * user's own rows that are still NULL.
 *
 * Called from the invite-accept flow (the set-password confirm page, invite
 * branch) right after the session is established. Best-effort + idempotent:
 * only NULL rows are touched, so re-runs and reset flows are no-ops.
 *
 * The acceptor is resolved from the session (never trusted from input); the
 * service client performs the scoped UPDATE.
 */

import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function markInviteAccepted(): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }

  const service = createServiceClient()
  const { error } = await service
    .from('user_organisations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('accepted_at', null)

  if (error) {
    console.error('markInviteAccepted: could not stamp accepted_at (non-fatal)', { userId: user.id, error })
    return { ok: false }
  }
  return { ok: true }
}
