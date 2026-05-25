'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { billingService } from '@esite/shared'
import { getPaystackService } from '@esite/db'

/**
 * Cancel the caller's organisation subscription. Disables the recurring
 * subscription at Paystack so the customer is not charged again, then marks
 * billing.subscriptions cancelled. Owner/admin only.
 */
export async function cancelSubscriptionAction(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }

  const { data: mem } = await supabase
    .from('user_organisations')
    .select('organisation_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!mem) return { ok: false, error: 'No organisation found.' }
  if (!['owner', 'admin'].includes(mem.role)) {
    return { ok: false, error: 'Only an owner or admin can cancel the subscription.' }
  }

  const service = createServiceClient()
  const subscription = await billingService.getSubscription(service as any, mem.organisation_id)
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
    .eq('organisation_id', mem.organisation_id)
  if (error) {
    console.error('cancelSubscriptionAction: local update failed', error)
    return { ok: false, error: 'Cancelled at Paystack, but the local update failed — please refresh.' }
  }

  return { ok: true }
}
