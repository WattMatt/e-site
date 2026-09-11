'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import { billingService, OWNER_ADMIN } from '@esite/shared'
import { getPaystackService } from '@esite/db'

/**
 * Cancel the caller's organisation subscription. Disables the recurring
 * subscription at Paystack so the customer is not charged again, then marks
 * billing.subscriptions cancelled. Owner/admin only.
 *
 * ⚠ The org MUST be resolved with getOrgContext(), the same resolver
 * /settings/billing uses via requireRolePage(OWNER_ADMIN). This action
 * previously read `.eq('is_active', true).limit(1).single()` with no
 * `.order()`, so PostgREST returned an ARBITRARY membership and the
 * OrgSwitcher's profiles.active_organisation_id was ignored — a multi-org
 * owner disabled a different organisation's recurring Paystack subscription
 * than the one whose Cancel button they pressed, and the write below runs on
 * the service client, so RLS would not have caught it. Adding `.order()` is
 * NOT the fix: it deterministically targets the OLDEST org, which is still the
 * wrong one whenever the user has switched context.
 */
export async function cancelSubscriptionAction(): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }
  if (!OWNER_ADMIN.includes(ctx.role)) {
    return { ok: false, error: 'Only an owner or admin can cancel the subscription.' }
  }

  const service = createServiceClient()
  const subscription = await billingService.getSubscription(service as any, ctx.organisationId)
  if (!subscription || subscription.tier === 'free') {
    return { ok: false, error: 'No paid subscription to cancel.' }
  }
  if (subscription.status === 'cancelled') {
    return { ok: false, error: 'This subscription is already cancelled.' }
  }

  // Stop billing at Paystack first. A recurring subscription carries a
  // paystack_subscription_code; a one-off charge does not — nothing to disable.
  const code = subscription.paystack_subscription_code
  if (code) {
    try {
      await getPaystackService().disableSubscription(code)
    } catch (err) {
      console.error('cancelSubscriptionAction: Paystack disable failed', err)
      return {
        ok: false,
        error: 'Could not cancel with the payment provider. Please try again or contact support.',
      }
    }
  }

  // Reflect locally. Paystack also emits subscription.disable, which the
  // billing webhook applies — this write is idempotent with it.
  const { error } = await (service as any)
    .schema('billing')
    .from('subscriptions')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('organisation_id', ctx.organisationId)
  if (error) {
    console.error('cancelSubscriptionAction: local update failed', error)
    return { ok: false, error: 'Cancelled at Paystack, but the local update failed — please refresh.' }
  }

  return { ok: true }
}
