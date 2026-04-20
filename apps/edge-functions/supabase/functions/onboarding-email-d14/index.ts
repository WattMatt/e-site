/**
 * Edge Function: onboarding-email-d14 — daily cron.
 * Sends the Day-14 "how's E-Site working for you?" feedback email.
 */

import {
  corsPreflight, jsonResponse, serviceRoleClient,
  sendSequenceEmail, usersSignedUpDaysAgo, getSiteUrl, unsubscribeUrlFor, requireServiceRole,
} from '../_shared/email-sequence.ts'
import { onboardingD14 } from '../_shared/email-templates/onboarding-d14.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsPreflight()
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }
  const unauth = requireServiceRole(req)
  if (unauth) return unauth

  const supabase = serviceRoleClient()
  const targets = await usersSignedUpDaysAgo(supabase, 14)
  const report = { sent: 0, skipped_opt_out: 0, skipped_duplicate: 0, failed: 0, errors: [] as string[] }

  for (const t of targets) {
    const { subject, html } = onboardingD14({
      firstName: t.firstName ?? '',
      siteUrl: getSiteUrl(),
      unsubscribeUrl: unsubscribeUrlFor(t.userId),
    })
    const r = await sendSequenceEmail(supabase, {
      userId: t.userId, toEmail: t.email,
      sequence: 'onboarding', step: 'd14',
      subject, html,
    })
    if (r.status === 'sent') report.sent++
    else if (r.status === 'skipped_opt_out') report.skipped_opt_out++
    else if (r.status === 'skipped_duplicate') report.skipped_duplicate++
    else { report.failed++; if (r.reason) report.errors.push(`${t.userId}: ${r.reason}`) }
  }

  return jsonResponse({ ok: true, ran_at: new Date().toISOString(), targets: targets.length, ...report })
})
