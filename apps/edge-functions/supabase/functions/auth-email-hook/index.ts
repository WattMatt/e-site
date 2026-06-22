/**
 * Edge Function: auth-email-hook  (Supabase "Send Email" auth hook)
 *
 * Registered via config.toml [auth.hook.send_email]. Supabase POSTs a
 * standardwebhooks-signed payload for EVERY auth email. We verify the
 * signature, branch on email_action_type, render the branded template, and
 * send through Resend. Returning 2xx tells Supabase the mail was handled
 * (it then suppresses its own built-in email).
 *
 * Pure logic (verify / branch / link / template) lives in ../_shared/auth-email/*
 * and ../_shared/email-templates/branded.ts and is unit-tested with vitest.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyHookSignature } from '../_shared/auth-email/verify-signature.ts'
import { buildAuthEmail } from '../_shared/auth-email/build-email.ts'
import type { AuthHookPayload, OrgBranding } from '../_shared/auth-email/types.ts'
import { DEFAULT_ACCENT } from '../_shared/auth-email/types.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM = Deno.env.get('RESEND_FROM') ?? 'E-Site <noreply@e-site.live>'
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://app.e-site.live'
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? ''
const LOGO_BUCKET = 'report-logos'

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

/** Download an org logo storage path to a data: URI; null on any failure. */
async function logoDataUri(supabase: ReturnType<typeof serviceClient>, path: string | null): Promise<string | null> {
  if (!path) return null
  const { data, error } = await supabase.storage.from(LOGO_BUCKET).download(path)
  if (error || !data) return null
  const buf = new Uint8Array(await data.arrayBuffer())
  let bin = ''
  for (const b of buf) bin += String.fromCharCode(b)
  const mime = (data as Blob).type || 'image/png'
  return `data:${mime};base64,${btoa(bin)}`
}

/**
 * Resolve org branding for an invite. We get the org id from invite metadata
 * (`org_id`). Account-level mail (reset/signup) passes org=null → platform brand.
 */
async function resolveOrgBranding(
  supabase: ReturnType<typeof serviceClient>,
  payload: AuthHookPayload,
): Promise<OrgBranding | null> {
  if (payload.email_data.email_action_type !== 'invite') return null
  const orgId = payload.user.user_metadata?.org_id
  if (typeof orgId !== 'string' || !orgId) return null

  const { data } = await supabase
    .from('organisations')
    .select('name, logo_url, report_accent_color')
    .eq('id', orgId)
    .maybeSingle()
  if (!data) return null

  const logoSrc = await logoDataUri(supabase, (data as { logo_url: string | null }).logo_url)
  return {
    name: (data as { name: string | null }).name ?? 'Your organisation',
    logoSrc,
    accent: (data as { report_accent_color: string | null }).report_accent_color ?? DEFAULT_ACCENT,
  }
}

async function resendSend(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not set')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: { http_code: 405, message: 'Method not allowed' } }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Fail fast on misconfiguration: an empty hook secret would make
  // verifyHookSignature reject EVERY request (a silent 401 for all auth mail).
  // Surface it as a loud 500 so the operator fixes the env var, not the inbox.
  if (!HOOK_SECRET) {
    console.error('auth-email-hook: SEND_EMAIL_HOOK_SECRET is unset — refusing to process auth emails')
    return new Response(
      JSON.stringify({ error: { http_code: 500, message: 'Hook secret not configured' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Must read the RAW body for signature verification — re-stringifying changes bytes.
  const rawBody = await req.text()
  const headers = {
    'webhook-id': req.headers.get('webhook-id'),
    'webhook-timestamp': req.headers.get('webhook-timestamp'),
    'webhook-signature': req.headers.get('webhook-signature'),
  }

  const valid = await verifyHookSignature(rawBody, headers, HOOK_SECRET)
  if (!valid) {
    return new Response(JSON.stringify({ error: { http_code: 401, message: 'Invalid signature' } }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  let payload: AuthHookPayload
  try {
    payload = JSON.parse(rawBody) as AuthHookPayload
  } catch {
    return new Response(JSON.stringify({ error: { http_code: 400, message: 'Bad JSON' } }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabase = serviceClient()
    const org = await resolveOrgBranding(supabase, payload)
    const { to, subject, html } = buildAuthEmail(payload, { siteUrl: SITE_URL, org })
    await resendSend(to, subject, html)
    // Empty 2xx tells Supabase the email was delivered; it sends nothing itself.
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('auth-email-hook error:', err)
    return new Response(
      JSON.stringify({ error: { http_code: 500, message: err instanceof Error ? err.message : 'send failed' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})
