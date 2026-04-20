/**
 * Email Sequence Service — pure (Node-safe) logic extracted from the Deno
 * edge functions so it can be unit-tested with Vitest without any Deno APIs.
 *
 * Spec: spec-v2.md §18, strategic-analysis-50-customer-communication-automation-v2.md.
 * Build-action-plan.md Session 4.
 *
 * What lives here (pure, no I/O):
 *   - computeSignupWindow   — 24-hour window used by the cron onboarding steps
 *   - isInSignupWindow      — predicate version of the above
 *   - reengagementStep      — maps days-since-login → sequence step (or null)
 *   - shouldSkipSend        — aggregates the two skip reasons (opt-out / duplicate)
 *   - interpretSendResult   — maps DB/Resend outcomes to a SendResult discriminant
 *
 * The Deno-side helpers (Resend HTTP call, Supabase insert, env lookups) stay in
 * apps/edge-functions/supabase/functions/_shared/email-sequence.ts.
 */

const DAY_MS = 86_400_000

// ─── Types (re-exported for consumer convenience) ─────────────────────────────

export type SequenceName = 'onboarding' | 'reengagement' | 'conversion' | 'payment_recovery'

export type OnboardingStep = 'd0' | 'd1' | 'd3' | 'd7' | 'd14'

export type ReengagementStep = 'inactive_7d' | 'inactive_14d' | 'inactive_30d'

export type ConversionStep = 'second_project'

export type PaymentRecoveryStep =
  | 'day0_failed'
  | 'day3_retry_failed'
  | 'day7_final_warning'
  | 'day14_paused'
  | 'day30_cancelled'

export type StepName =
  | OnboardingStep
  | ReengagementStep
  | ConversionStep
  | PaymentRecoveryStep

export type SkipReason = 'opted_out' | 'duplicate'

export type SendStatus = 'sent' | 'skipped_opt_out' | 'skipped_duplicate' | 'failed'

export interface SendResult {
  status: SendStatus
  reason?: string
  messageId?: string
}

// ─── Signup-window calculation ────────────────────────────────────────────────

/**
 * The 24-hour window a user must have signed up within in order to receive the
 * onboarding email for `dayOffset`. The cron for d1 fires each morning and
 * selects users in the [d-1, d) window; d3 selects [d-3, d-2); etc.
 *
 * Example:
 *   dayOffset=1, now=2026-05-02T01:00:00Z
 *   → start=2026-05-01T01:00:00Z, end=2026-05-02T01:00:00Z
 *   → any user who signed up on 2026-05-01 between 01:00 and the cron time
 *     is included.
 */
export function computeSignupWindow(
  dayOffset: number,
  now: Date = new Date(),
): { start: Date; end: Date } {
  const start = new Date(now.getTime() - dayOffset * DAY_MS)
  const end   = new Date(start.getTime() + DAY_MS)
  return { start, end }
}

/**
 * Returns true if `signupAt` falls inside the signup window for `dayOffset`.
 */
export function isInSignupWindow(
  signupAt: Date,
  dayOffset: number,
  now: Date = new Date(),
): boolean {
  const { start, end } = computeSignupWindow(dayOffset, now)
  const t = signupAt.getTime()
  return t >= start.getTime() && t < end.getTime()
}

// ─── Reengagement bucketing ───────────────────────────────────────────────────

/**
 * Maps the number of whole days since the user last logged in to the
 * reengagement sequence step that should be sent, or null if the user is
 * still considered active (< 7 days).
 *
 * Monotonically ascending thresholds — a 30-day-inactive user also qualifies
 * for the 14d and 7d steps, but the UNIQUE constraint on email_sequence_events
 * ensures each step is sent at most once regardless of when this is evaluated.
 */
export function reengagementStep(daysSinceLogin: number): ReengagementStep | null {
  if (daysSinceLogin >= 30) return 'inactive_30d'
  if (daysSinceLogin >= 14) return 'inactive_14d'
  if (daysSinceLogin >= 7)  return 'inactive_7d'
  return null
}

/**
 * Returns how many whole days have elapsed between `then` and `now`.
 * Floors the result (consistent with payment-recovery.service.ts daysSince).
 */
export function daysSince(then: Date, now: Date = new Date()): number {
  return Math.floor((now.getTime() - then.getTime()) / DAY_MS)
}

// ─── Skip-decision logic ──────────────────────────────────────────────────────

/**
 * Aggregates the two reasons we skip a send:
 *   1. The user opted out of marketing emails (POPIA consent withdrawal)
 *   2. The (user_id, sequence, step) row already exists (DB UNIQUE guard)
 *
 * The Deno code checks these sequentially; this pure function lets tests
 * verify the decision rules without any I/O.
 */
export function shouldSkipSend(opts: {
  optedOut: boolean
  alreadySent: boolean
}): SkipReason | null {
  if (opts.optedOut)    return 'opted_out'
  if (opts.alreadySent) return 'duplicate'
  return null
}

/**
 * Maps a (DB-insert outcome, Resend outcome) pair to a `SendResult`.
 *
 * Rules:
 *   - DB UNIQUE violation (pg code 23505) → skipped_duplicate
 *   - DB insert OK + Resend OK           → sent (with messageId)
 *   - DB insert OK + Resend fail         → failed (row stays in DB as error record)
 *   - opted_out checked before reaching here → skipped_opt_out
 */
export function interpretSendOutcome(opts: {
  dbErrorCode: string | null
  resendMessageId: string | null
  resendError: string | null
}): SendResult {
  if (opts.dbErrorCode === '23505') {
    return { status: 'skipped_duplicate' }
  }
  if (opts.dbErrorCode) {
    return { status: 'failed', reason: `db_error:${opts.dbErrorCode}` }
  }
  if (opts.resendError) {
    return { status: 'failed', reason: opts.resendError }
  }
  return { status: 'sent', messageId: opts.resendMessageId ?? undefined }
}
