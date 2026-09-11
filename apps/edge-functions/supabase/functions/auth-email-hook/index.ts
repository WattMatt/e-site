/**
 * Edge Function: auth-email-hook — GoTrue Send-Email hook.
 *
 * Replaces BOTH the Supabase built-in mailer (shared-IP bounce reputation,
 * 2/h cap — see the 2026-07-08 "sending privileges at risk" warning) and
 * custom SMTP (the project's Resend key is REST-valid but rejected by
 * Resend's SMTP relay with 535). GoTrue POSTs a standardwebhooks-signed
 * payload here for every auth email; we render the branded message and
 * deliver via the Resend REST API.
 *
 * Links are token_hash form into the app's own /auth/callback (server-side
 * verifyOtp) — never GoTrue's /verify, whose GET redirect burns tokens and
 * strands PKCE clients (the 2026-07-07 invite incident). The 6-digit code is
 * always included as the manual fallback.
 *
 * Config lives in auth config: hook_send_email_uri → this function,
 * hook_send_email_secrets = "v1,whsec_<base64>" and the same base64 value in
 * the SEND_EMAIL_HOOK_SECRET edge secret. Deploy with --no-verify-jwt: GoTrue
 * calls without a JWT; authenticity is the webhook signature.
 */

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'

// The renderer lives in ./render.ts so it can be imported and executed by a
// test outside Deno (apps/web/src/lib/email/auth-email-hook-render.test.ts).
// This file keeps only the transport: signature verification + Resend.
import { renderAuthEmail, type HookPayload } from './render.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') // base64, no "v1,whsec_" prefix
const FROM = 'E-Site <noreply@e-site.live>'

Deno.serve(async (req) => {
  try {
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not set')
    if (!HOOK_SECRET) throw new Error('SEND_EMAIL_HOOK_SECRET not set')

    const rawBody = await req.text()
    const wh = new Webhook(HOOK_SECRET)
    let payload: HookPayload
    try {
      payload = wh.verify(rawBody, {
        'webhook-id': req.headers.get('webhook-id') ?? '',
        'webhook-timestamp': req.headers.get('webhook-timestamp') ?? '',
        'webhook-signature': req.headers.get('webhook-signature') ?? '',
      }) as HookPayload
    } catch {
      return new Response(JSON.stringify({ error: 'invalid signature' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      })
    }

    const { to, subject, html } = renderAuthEmail(payload)
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Resend error ${res.status}: ${body.slice(0, 200)}`)
    }

    // GoTrue treats any 2xx JSON response as success.
    return new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('auth-email-hook error:', err)
    // Non-2xx tells GoTrue the send failed (surfaces as a 500 to the caller,
    // which is honest — better than claiming an email was sent when it wasn't).
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
