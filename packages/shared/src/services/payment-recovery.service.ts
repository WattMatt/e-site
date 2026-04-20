/**
 * Payment-recovery state machine (T-064 / build-action-plan Session 5).
 *
 * Given (payment_failure_count, days since last failure, current subscription
 * status), decide what the daily cron should do today:
 *   - which email step (if any) to send
 *   - whether to flip subscription.status
 *   - whether to pause projects
 *   - whether to cancel the subscription
 *
 * Pure logic — no DB calls, no network. The cron Edge Function
 * (payment-recovery-check) runs this and applies side effects.
 *
 * Timeline anchored on `last_payment_failure_at`:
 *
 *   Day 0  — charge.failed fires → counter increments → webhook sends d0 email.
 *            (No action from this service; the counter goes 0 → 1 here.)
 *   Day 3  — retry-failed email.
 *   Day 7  — final-warning email + subscription status → 'grace_period'.
 *   Day 14 — pause projects + status → 'paused'.
 *   Day 30 — cancel subscription.
 *
 * Idempotency: email sends are tracked in email_sequence_events with UNIQUE
 * (user_id, sequence, step). State mutations are guarded by checking current
 * status ≠ target status before applying. So a cron that fires twice on the
 * same day never double-acts.
 *
 * Spec: spec-v2.md §18, strategic-analysis-51-churn-analysis-framework-v2.md §5.
 */

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'grace_period' | 'paused' | 'cancelled'

export interface RecoveryInput {
  /** public.organisations.id */
  organisationId: string
  /** How many consecutive charge.failed events on this subscription. */
  failureCount: number
  /** Timestamp of the most recent charge.failed event. */
  lastFailureAt: Date | null
  /** Subscription status today. */
  currentStatus: SubscriptionStatus
  /** Evaluation time (defaults to now — injectable for deterministic tests). */
  now?: Date
}

export type RecoveryStep =
  | 'none'
  | 'day3_retry_failed'
  | 'day7_final_warning'
  | 'day14_paused'
  | 'day30_cancelled'

export interface RecoveryAction {
  step: RecoveryStep
  /** Step name for email_sequence_events. null = don't send an email this tick. */
  emailStep: StepName | null
  /** If non-null, flip billing.subscriptions.status to this value. */
  setSubscriptionStatus: SubscriptionStatus | null
  /** If true, set projects.projects.status = 'payment_paused' for this org. */
  pauseProjects: boolean
  /** If true, set subscriptions.cancelled_at = now. */
  cancelSubscription: boolean
  /** Human-readable reason — useful for logs. */
  reason: string
}

/** Step names used in email_sequence_events for the recovery sequence. */
export type StepName =
  | 'day0_failed'
  | 'day3_retry_failed'
  | 'day7_final_warning'
  | 'day14_paused'
  | 'day30_cancelled'

const DAY_MS = 86_400_000

export function daysSince(ts: Date, now: Date): number {
  return Math.floor((now.getTime() - ts.getTime()) / DAY_MS)
}

/**
 * Decide the single action (if any) to perform this tick for one subscription.
 * Returning `step: 'none'` means: nothing to do — either the account is
 * healthy, the timeline hasn't advanced to the next stage, or the account
 * has already been cancelled.
 */
export function decideRecoveryAction(input: RecoveryInput): RecoveryAction {
  const now = input.now ?? new Date()

  // Terminal state — don't re-touch.
  if (input.currentStatus === 'cancelled') {
    return noop('already cancelled')
  }

  // No failure on record → nothing to recover from.
  if (input.failureCount === 0 || !input.lastFailureAt) {
    return noop('no payment failure on record')
  }

  const elapsed = daysSince(input.lastFailureAt, now)

  // The cron advances stages monotonically: we check from the latest stage
  // downward so an org that crosses multiple thresholds in one tick (e.g. the
  // cron missed a day) lands on the most recent stage instead of the oldest.
  if (elapsed >= 30) {
    // Already-cancelled subs were filtered at the top of this function.
    return {
      step: 'day30_cancelled',
      emailStep: 'day30_cancelled',
      setSubscriptionStatus: 'cancelled',
      pauseProjects: false, // already paused by day14 step; cancel just flips sub status
      cancelSubscription: true,
      reason: `failure has persisted ${elapsed}d — cancelling subscription`,
    }
  }

  if (elapsed >= 14) {
    // Only re-act if we haven't already paused (idempotency at state level).
    if (input.currentStatus === 'paused') return noop('already paused')
    return {
      step: 'day14_paused',
      emailStep: 'day14_paused',
      setSubscriptionStatus: 'paused',
      pauseProjects: true,
      cancelSubscription: false,
      reason: `failure at ${elapsed}d — pausing projects`,
    }
  }

  if (elapsed >= 7) {
    if (input.currentStatus === 'grace_period' ||
        input.currentStatus === 'paused') {
      // Already in or past grace; email will be deduped by email_sequence_events.
      return {
        step: 'day7_final_warning',
        emailStep: 'day7_final_warning',
        setSubscriptionStatus: null,
        pauseProjects: false,
        cancelSubscription: false,
        reason: `failure at ${elapsed}d — sending final warning (status unchanged)`,
      }
    }
    return {
      step: 'day7_final_warning',
      emailStep: 'day7_final_warning',
      setSubscriptionStatus: 'grace_period',
      pauseProjects: false,
      cancelSubscription: false,
      reason: `failure at ${elapsed}d — entering grace period`,
    }
  }

  if (elapsed >= 3) {
    return {
      step: 'day3_retry_failed',
      emailStep: 'day3_retry_failed',
      setSubscriptionStatus: null,
      pauseProjects: false,
      cancelSubscription: false,
      reason: `failure at ${elapsed}d — retry-failed email`,
    }
  }

  return noop(`failure at ${elapsed}d — within Paystack auto-retry window`)
}

function noop(reason: string): RecoveryAction {
  return {
    step: 'none',
    emailStep: null,
    setSubscriptionStatus: null,
    pauseProjects: false,
    cancelSubscription: false,
    reason,
  }
}

export const paymentRecoveryService = {
  decideRecoveryAction,
  daysSince,
}
