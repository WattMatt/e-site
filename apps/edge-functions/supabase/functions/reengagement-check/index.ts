/**
 * Edge Function: reengagement-check — daily cron.
 *
 * Buckets users by last-login age and sends the appropriate re-engagement
 * email. Three buckets: 7–13 days, 14–29 days, 30+ days.
 *
 * Idempotency via email_sequence_events.UNIQUE (user_id, 'reengagement', step):
 *   - A user who crosses 7d gets `inactive_7d` once, ever.
 *   - If they stay inactive into 14d they also get `inactive_14d` once.
 *   - Same at 30d.
 * Once a user logs back in and later churns again, they won't re-receive the
 * earlier emails — Phase 1 accepts that tradeoff over spamming returners.
 *
 * Spec: spec-v2.md §18, build-action-plan.md Session 4.
 */

import {
  corsPreflight, jsonResponse, serviceRoleClient,
  sendSequenceEmail, getSiteUrl, unsubscribeUrlFor,
  type StepName, requireServiceRole,
} from '../_shared/email-sequence.ts'
import { reengagement7d }  from '../_shared/email-templates/reengagement-7d.ts'
import { reengagement14d } from '../_shared/email-templates/reengagement-14d.ts'
import { reengagement30d } from '../_shared/email-templates/reengagement-30d.ts'

const DAY_MS = 86_400_000

interface Target {
  userId: string
  email: string
  firstName: string | null
  daysSinceLogin: number
  step: StepName
}

function bucket(daysSinceLogin: number): StepName | null {
  if (daysSinceLogin >= 30) return 'inactive_30d'
  if (daysSinceLogin >= 14) return 'inactive_14d'
  if (daysSinceLogin >= 7)  return 'inactive_7d'
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsPreflight()
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }
  const unauth = requireServiceRole(req)
  if (unauth) return unauth

  const supabase = serviceRoleClient()
  const now = new Date()

  // Full auth-users scan. Early-stage volumes fit in one page. Widen paging
  // when the base grows past ~1k users.
  const { data, error } = await (supabase as any).auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) return jsonResponse({ ok: false, error: error.message }, 500)

  const users = (data?.users ?? []) as Array<{
    id: string
    email: string | null
    last_sign_in_at: string | null
    created_at: string
    user_metadata?: { full_name?: string }
  }>

  const targets: Target[] = []
  for (const u of users) {
    if (!u.email) continue
    // Never-logged-in users are handled by the onboarding sequence, not here.
    const lastLogin = u.last_sign_in_at ?? u.created_at
    const daysSinceLogin = Math.floor((now.getTime() - new Date(lastLogin).getTime()) / DAY_MS)
    const step = bucket(daysSinceLogin)
    if (!step) continue
    targets.push({
      userId: u.id,
      email: u.email,
      firstName: u.user_metadata?.full_name?.split(' ')[0] ?? null,
      daysSinceLogin,
      step,
    })
  }

  const report = { sent: 0, skipped_opt_out: 0, skipped_duplicate: 0, failed: 0, errors: [] as string[] }

  for (const t of targets) {
    const baseVars = {
      firstName: t.firstName ?? '',
      siteUrl: getSiteUrl(),
      unsubscribeUrl: unsubscribeUrlFor(t.userId),
    }

    const tmpl = t.step === 'inactive_30d' ? reengagement30d(baseVars)
               : t.step === 'inactive_14d' ? reengagement14d(baseVars)
               :                              reengagement7d(baseVars)

    const r = await sendSequenceEmail(supabase, {
      userId:   t.userId,
      toEmail:  t.email,
      sequence: 'reengagement',
      step:     t.step,
      subject:  tmpl.subject,
      html:     tmpl.html,
      metadata: { days_since_login: t.daysSinceLogin },
    })

    if      (r.status === 'sent')              report.sent++
    else if (r.status === 'skipped_opt_out')   report.skipped_opt_out++
    else if (r.status === 'skipped_duplicate') report.skipped_duplicate++
    else { report.failed++; if (r.reason) report.errors.push(`${t.userId}: ${r.reason}`) }
  }

  return jsonResponse({ ok: true, ran_at: now.toISOString(), targets: targets.length, ...report })
})
