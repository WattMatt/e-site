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

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') // base64, no "v1,whsec_" prefix
const APP_URL = 'https://www.e-site.live'
const FROM = 'E-Site <noreply@e-site.live>'

interface HookPayload {
  user: { email: string; email_change?: string; user_metadata?: { full_name?: string } }
  email_data: {
    token: string
    token_hash: string
    redirect_to: string
    email_action_type: string
    token_new?: string
    token_hash_new?: string
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function baseTemplate(content: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0F172A;color:#E2E8F0;margin:0;padding:32px}
  .card{background:#1E293B;border:1px solid #334155;border-radius:12px;padding:28px;max-width:480px;margin:0 auto}
  h2{color:#fff;font-size:18px;margin:0 0 12px}p{font-size:14px;line-height:1.6;color:#94A3B8;margin:0 0 12px}
  .btn{display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px;margin:8px 0 4px}
  .otp{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:26px;letter-spacing:0.35em;color:#F1F5F9;background:#0F172A;border:1px solid #334155;border-radius:8px;padding:12px 16px;text-align:center;margin:12px 0}
  .note{font-size:12px;color:#64748B;line-height:1.6}
  .footer{margin-top:24px;font-size:11px;color:#475569;text-align:center}</style></head>
  <body><div class="card">${content}<div class="footer">E-Site Construction Management · <a href="${APP_URL}" style="color:#3B82F6">www.e-site.live</a></div></div></body></html>`
}

/** token_hash link into the app's own callback (server-side verifyOtp). */
function appLink(tokenHash: string, otpType: string, next: string): string {
  return `${APP_URL}/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(otpType)}&next=${encodeURIComponent(next)}`
}

function codeBlock(token: string, label = 'Or enter this 6-digit code where prompted:'): string {
  return `<p class="note">${label}</p><div class="otp">${escapeHtml(token)}</div>`
}

/** Render subject + html for a GoTrue email action. */
function renderAuthEmail(p: HookPayload): { to: string; subject: string; html: string } {
  const { token, token_hash, email_action_type } = p.email_data
  const email = p.user.email
  const expiry = '24 hours'
  const expiryNote = `<p class="note">This code and link expire in about ${expiry} and can be used once.
    If they expire, request a fresh one from the same screen.</p>`

  switch (email_action_type) {
    case 'recovery':
      return {
        to: email,
        subject: 'Reset your E-Site password',
        html: baseTemplate(`
          <h2>Reset your password</h2>
          <p>A password reset was requested for <strong>${escapeHtml(email)}</strong>.
             If this wasn't you, you can safely ignore this email.</p>
          ${codeBlock(token, 'Enter this 6-digit code on the reset screen:')}
          <p>Or reset in one click:</p>
          <a class="btn" href="${appLink(token_hash, 'recovery', '/reset-password/confirm')}">Set a new password</a>
          ${expiryNote}`),
      }
    case 'magiclink':
      return {
        to: email,
        subject: 'Your E-Site sign-in code',
        html: baseTemplate(`
          <h2>Sign in to E-Site</h2>
          <p>Use this code to finish signing in as <strong>${escapeHtml(email)}</strong>:</p>
          ${codeBlock(token, '')}
          <p>Or sign in with one click:</p>
          <a class="btn" href="${appLink(token_hash, 'magiclink', '/dashboard')}">Sign in</a>
          ${expiryNote}`),
      }
    case 'signup':
      return {
        to: email,
        subject: 'Confirm your E-Site signup',
        html: baseTemplate(`
          <h2>Confirm your signup</h2>
          <p>Confirm <strong>${escapeHtml(email)}</strong> to activate your E-Site account.</p>
          ${codeBlock(token, 'Your confirmation code:')}
          <a class="btn" href="${appLink(token_hash, 'signup', '/dashboard')}">Confirm my email</a>
          ${expiryNote}`),
      }
    case 'invite':
      // Not used by the app (invites go through the branded sendInviteEmail
      // pipeline), but handled so a Studio-triggered invite still works.
      return {
        to: email,
        subject: 'You have been invited to E-Site',
        html: baseTemplate(`
          <h2>You've been invited to E-Site</h2>
          <p>Set a password for <strong>${escapeHtml(email)}</strong> to get started.</p>
          ${codeBlock(token, 'Your invite code:')}
          <a class="btn" href="${appLink(token_hash, 'invite', '/reset-password/confirm')}">Set your password</a>
          ${expiryNote}`),
      }
    case 'email_change_current': {
      // Secure email change, step 1: confirm from the CURRENT address.
      return {
        to: email,
        subject: 'Confirm your E-Site email change',
        html: baseTemplate(`
          <h2>Confirm your email change</h2>
          <p>You asked to change the email on your E-Site account. Enter this code to confirm from your current address:</p>
          ${codeBlock(token, '')}
          ${expiryNote}`),
      }
    }
    case 'email_change': {
      const to = p.user.email_change || email
      return {
        to,
        subject: 'Confirm your new E-Site email address',
        html: baseTemplate(`
          <h2>Confirm your new email</h2>
          <p>Enter this code in E-Site to confirm <strong>${escapeHtml(to)}</strong> as your new address:</p>
          ${codeBlock(token, '')}
          ${expiryNote}`),
      }
    }
    case 'reauthentication':
      return {
        to: email,
        subject: 'Your E-Site verification code',
        html: baseTemplate(`
          <h2>Verify it's you</h2>
          <p>Enter this code to confirm the action on your E-Site account:</p>
          ${codeBlock(token, '')}
          <p class="note">If you didn't request this, you can ignore it.</p>`),
      }
    default:
      // Unknown/new action type: deliver something usable rather than fail.
      return {
        to: email,
        subject: 'Your E-Site verification code',
        html: baseTemplate(`
          <h2>Your verification code</h2>
          ${codeBlock(token, '')}
          ${expiryNote}`),
      }
  }
}

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
