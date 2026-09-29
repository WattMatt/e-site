/**
 * Pure helpers for the org add-on subscription (Solar, billing.org_addon_subscriptions,
 * migration 00208). The DB-touching branches live in /api/paystack/webhook —
 * the ONLY writer of that table.
 */
import { FEATURE_PRICES } from '@esite/shared'

/** metadata.type set by /api/paystack/solar-subscribe and matched by the webhook + callback. */
export const ORG_ADDON_METADATA_TYPE = 'org_addon_subscription' as const

/**
 * billing.payment_events.event_type for a Solar charge that was APPLIED. The
 * table stores no references, so this row is the reference → org map a
 * refund or chargeback uses to find the subscription.
 */
export const ORG_ADDON_CHARGE_EVENT = 'charge.success.org_addon_subscription'

/**
 * A second first-charge while the subscription was live. Logged under its own
 * type so that refunding it — which the admins are told to do — can never
 * match the refund lookup and lock the org's live subscription.
 */
export const ORG_ADDON_DUPLICATE_EVENT = 'charge.success.org_addon_subscription.duplicate'

/** A Solar charge the webhook could not place (unknown org, unknown add-on, no matching row). */
export const ORG_ADDON_UNMATCHED_EVENT = 'charge.success.org_addon_subscription.unmatched'

/**
 * A refund or lost chargeback of a Solar charge that did NOT fund the current
 * period (an older year's charge). Owner default (Phase 1B): logged against
 * the org, but the current, separately paid year is not locked.
 */
export const ORG_ADDON_PRIOR_PERIOD_REFUND_EVENT = 'refund.org_addon_subscription.prior_period'

/** The Paystack plan code for the Solar annual plan, read at call time. */
export function solarPlanCode(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string | undefined {
  const value = env[FEATURE_PRICES.solar.planCodeEnv]?.trim()
  return value ? value : undefined
}

/** Plan code from a Paystack charge/subscription payload (object, plan_object, or bare string). */
export function planCodeOf(data: any): string | undefined {
  if (!data) return undefined
  if (typeof data.plan === 'string') return data.plan || undefined
  const code = data.plan?.plan_code ?? data.plan_object?.plan_code
  return typeof code === 'string' && code ? code : undefined
}

/** Subscription code from a Paystack charge payload (same fields the MV branch reads). */
export function subscriptionCodeOf(data: any): string | undefined {
  const code = data?.subscription?.subscription_code ?? data?.plan_object?.subscription_code
  return typeof code === 'string' && code ? code : undefined
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * The new `current_period_end` after a charge or a renewal notice.
 *
 * Candidate = Paystack's `next_payment_date` when the event carries one
 * (subscription.create, invoice.update), else paid_at + 1 year (charge.success
 * carries no next date — same fallback as the MV branch). The result is the
 * LATER of the candidate and the stored end: an out-of-order or re-delivered
 * event must never take paid time away.
 */
export function nextAddonPeriodEnd(
  existingEnd: string | null | undefined,
  paidAt: string | null | undefined,
  nextPaymentDate?: string | null,
): string {
  let candidate = parseDate(nextPaymentDate)
  if (!candidate) {
    const from = parseDate(paidAt) ?? new Date()
    candidate = new Date(from.getTime())
    candidate.setUTCFullYear(candidate.getUTCFullYear() + 1)
  }
  const existing = parseDate(existingEnd)
  return (existing && existing.getTime() > candidate.getTime() ? existing : candidate).toISOString()
}
