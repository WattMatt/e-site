/**
 * Edge Function: payment-recovery-check — daily cron.
 *
 * Runs the graduated payment-recovery timeline:
 *   Day 3  — retry-failed email
 *   Day 7  — final warning + status → grace_period
 *   Day 14 — pause projects + status → paused
 *   Day 30 — cancel subscription
 *
 * Pulls the decision logic from a pure mirror of
 * packages/shared/src/services/payment-recovery.service.ts — keep the two in
 * lockstep. Tests live in packages/shared/src/__tests__/payment-recovery/.
 *
 * Spec: spec-v2.md §18, strategic-analysis-51-churn-analysis-framework-v2.md §5.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendSequenceEmail, getSiteUrl, unsubscribeUrlFor, jsonResponse, corsPreflight, requireServiceRole } from '../_shared/email-sequence.ts'
import { paymentDay3RetryFailed }   from '../_shared/email-templates/payment-day3-retry-failed.ts'
import { paymentDay7FinalWarning }  from '../_shared/email-templates/payment-day7-final-warning.ts'
import { paymentDay14Paused }       from '../_shared/email-templates/payment-day14-paused.ts'
import { paymentDay30Cancelled }    from '../_shared/email-templates/payment-day30-cancelled.ts'

// ─── State machine (mirror of packages/shared/src/services/payment-recovery.service.ts)

type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'grace_period' | 'paused' | 'cancelled'
type RecoveryStep = 'none' | 'day3_retry_failed' | 'day7_final_warning' | 'day14_paused' | 'day30_cancelled'
type EmailStep = 'day3_retry_failed' | 'day7_final_warning' | 'day14_paused' | 'day30_cancelled'

interface RecoveryInput {
  failureCount: number
  lastFailureAt: Date | null
  currentStatus: SubscriptionStatus
  now: Date
}

interface RecoveryAction {
  step: RecoveryStep
  emailStep: EmailStep | null
  setSubscriptionStatus: SubscriptionStatus | null
  pauseProjects: boolean
  cancelSubscription: boolean
}

const DAY_MS = 86_400_000

function decide(input: RecoveryInput): RecoveryAction {
  if (input.currentStatus === 'cancelled') return noop()
  if (input.failureCount === 0 || !input.lastFailureAt) return noop()

  const elapsed = Math.floor((input.now.getTime() - input.lastFailureAt.getTime()) / DAY_MS)

  if (elapsed >= 30) {
    return {
      step: 'day30_cancelled',
      emailStep: 'day30_cancelled',
      setSubscriptionStatus: 'cancelled',
      pauseProjects: false,
      cancelSubscription: true,
    }
  }
  if (elapsed >= 14) {
    if (input.currentStatus === 'paused') return noop()
    return {
      step: 'day14_paused',
      emailStep: 'day14_paused',
      setSubscriptionStatus: 'paused',
      pauseProjects: true,
      cancelSubscription: false,
    }
  }
  if (elapsed >= 7) {
    return {
      step: 'day7_final_warning',
      emailStep: 'day7_final_warning',
      setSubscriptionStatus:
        input.currentStatus === 'grace_period' || input.currentStatus === 'paused'
          ? null
          : 'grace_period',
      pauseProjects: false,
      cancelSubscription: false,
    }
  }
  if (elapsed >= 3) {
    return {
      step: 'day3_retry_failed',
      emailStep: 'day3_retry_failed',
      setSubscriptionStatus: null,
      pauseProjects: false,
      cancelSubscription: false,
    }
  }
  return noop()
}

function noop(): RecoveryAction {
  return {
    step: 'none',
    emailStep: null,
    setSubscriptionStatus: null,
    pauseProjects: false,
    cancelSubscription: false,
  }
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

interface OpenFailure {
  id: string
  organisation_id: string
  payment_failure_count: number
  last_payment_failure_at: string
  status: SubscriptionStatus
  paused_at: string | null
  cancelled_at: string | null
}

async function fetchOpenFailures(supabase: SupabaseClient): Promise<OpenFailure[]> {
  const { data, error } = await (supabase as any)
    .schema('billing')
    .from('subscriptions')
    .select('id, organisation_id, payment_failure_count, last_payment_failure_at, status, paused_at, cancelled_at')
    .gt('payment_failure_count', 0)
    .neq('status', 'cancelled')
  if (error) throw new Error(`fetchOpenFailures: ${error.message}`)
  return (data ?? []) as OpenFailure[]
}

async function resolveOrgAdmin(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ id: string; email: string; firstName: string } | null> {
  const { data } = await (supabase as any)
    .from('user_organisations')
    .select('user_id, profile:profiles!user_id(id, full_name, email)')
    .eq('organisation_id', orgId)
    .eq('role', 'org_admin')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  const p = data?.profile as { id: string; full_name: string | null; email: string | null } | undefined
  if (!p?.id || !p.email) return null
  return { id: p.id, email: p.email, firstName: p.full_name?.split(' ')[0] ?? '' }
}

async function applySubscriptionMutation(
  supabase: SupabaseClient,
  subId: string,
  action: RecoveryAction,
  now: Date,
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (action.setSubscriptionStatus) patch.status = action.setSubscriptionStatus
  if (action.setSubscriptionStatus === 'paused') patch.paused_at = now.toISOString()
  if (action.cancelSubscription)    patch.cancelled_at = now.toISOString()
  if (Object.keys(patch).length === 0) return
  const { error } = await (supabase as any)
    .schema('billing')
    .from('subscriptions')
    .update(patch)
    .eq('id', subId)
  if (error) throw new Error(`subscription mutation: ${error.message}`)
}

async function pauseOrgProjects(supabase: SupabaseClient, orgId: string): Promise<number> {
  const { data, error } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .update({ status: 'payment_paused' })
    .eq('organisation_id', orgId)
    .eq('status', 'active')
    .select('id')
  if (error) throw new Error(`pauseOrgProjects: ${error.message}`)
  return (data ?? []).length
}

async function sendRecoveryEmail(
  supabase: SupabaseClient,
  step: EmailStep,
  owner: { id: string; email: string; firstName: string },
  orgId: string,
): Promise<void> {
  const base = {
    firstName: owner.firstName,
    siteUrl: getSiteUrl(),
    unsubscribeUrl: unsubscribeUrlFor(owner.id),
  }
  const tmpl =
    step === 'day3_retry_failed'  ? paymentDay3RetryFailed(base) :
    step === 'day7_final_warning' ? paymentDay7FinalWarning(base) :
    step === 'day14_paused'       ? paymentDay14Paused(base) :
                                    paymentDay30Cancelled(base)
  await sendSequenceEmail(supabase, {
    userId:         owner.id,
    toEmail:        owner.email,
    organisationId: orgId,
    sequence:       'payment_recovery',
    step,
    subject:        tmpl.subject,
    html:           tmpl.html,
  })
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsPreflight()
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }
  const unauth = requireServiceRole(req)
  if (unauth) return unauth

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const now = new Date()
  const report = {
    subscriptions_inspected: 0,
    actions: { day3_retry_failed: 0, day7_final_warning: 0, day14_paused: 0, day30_cancelled: 0 },
    projects_paused: 0,
    errors: [] as Array<{ subscriptionId: string; message: string }>,
  }

  try {
    const subs = await fetchOpenFailures(supabase)
    report.subscriptions_inspected = subs.length

    for (const sub of subs) {
      try {
        const action = decide({
          failureCount: sub.payment_failure_count,
          lastFailureAt: sub.last_payment_failure_at ? new Date(sub.last_payment_failure_at) : null,
          currentStatus: sub.status,
          now,
        })
        if (action.step === 'none') continue

        await applySubscriptionMutation(supabase, sub.id, action, now)

        if (action.pauseProjects) {
          report.projects_paused += await pauseOrgProjects(supabase, sub.organisation_id)
        }

        if (action.emailStep) {
          const owner = await resolveOrgAdmin(supabase, sub.organisation_id)
          if (owner) {
            await sendRecoveryEmail(supabase, action.emailStep, owner, sub.organisation_id)
          } else {
            console.warn(`sub=${sub.id}: no org admin to email`)
          }
        }

        report.actions[action.step] += 1
      } catch (err) {
        report.errors.push({
          subscriptionId: sub.id,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return jsonResponse({ ok: true, ran_at: now.toISOString(), ...report })
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ran_at: now.toISOString(),
    }, 500)
  }
})
