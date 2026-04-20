/**
 * Edge Function: onboarding-email-d0
 *
 * Fires the Day-0 welcome email immediately after a new signup. Event-triggered,
 * not cron-scheduled.
 *
 * Wiring: the web signup server action (apps/web/src/app/(auth)/signup/...)
 * POSTs to this function with `{ userId, email, firstName }` after the
 * supabase.auth.signUp succeeds and POPIA consent is recorded.
 *
 * Spec: spec-v2.md §18, build-action-plan.md Session 4.
 */

import {
  corsPreflight, jsonResponse, serviceRoleClient,
  sendSequenceEmail, getSiteUrl, unsubscribeUrlFor, requireServiceRole,
} from '../_shared/email-sequence.ts'
import { onboardingD0 } from '../_shared/email-templates/onboarding-d0.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsPreflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const unauth = requireServiceRole(req)
  if (unauth) return unauth

  const body = await req.json().catch(() => null) as {
    userId?: string
    email?: string
    firstName?: string
    organisationId?: string | null
  } | null

  if (!body?.userId || !body.email) {
    return jsonResponse({ error: 'userId and email are required' }, 400)
  }

  const supabase = serviceRoleClient()
  const { subject, html } = onboardingD0({
    firstName: body.firstName ?? '',
    siteUrl: getSiteUrl(),
    unsubscribeUrl: unsubscribeUrlFor(body.userId),
  })

  const result = await sendSequenceEmail(supabase, {
    userId:         body.userId,
    toEmail:        body.email,
    organisationId: body.organisationId ?? null,
    sequence:       'onboarding',
    step:           'd0',
    subject,
    html,
  })

  return jsonResponse(result, result.status === 'failed' ? 500 : 200)
})
