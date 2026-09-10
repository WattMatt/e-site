/**
 * Edge Function: send-email
 *
 * Sends transactional emails via Resend.
 *
 * Supported types:
 *   - rfi-created: new-RFI email (pre-rendered html forwarded from the web app)
 *   - snag-assigned: notify assignee of new snag
 *   - invite: send org invite email with token link
 *   - coc-status: notify org members when COC status changes
 *
 * Request body:
 *   { type: EmailType, payload: Record<string, any> }
 *   Authorization: Bearer <service_role_key>
 *
 * SECURITY — read before changing the gate.
 *
 * This function mails from `noreply@e-site.live`, the DKIM-signed identity
 * that also carries every invite and password reset. An open relay here does
 * not just send spam: abuse complaints land on the shared Resend sending
 * identity, and one suspension takes account recovery down for the product.
 *
 * The 2026-09-10 audit proved two live relay paths, both reproduced against
 * production:
 *
 *   (a) `data-subject-request` is in PUBLIC_TYPES, and it forwarded a
 *       CALLER-SUPPLIED `to`, a caller-supplied `subject` and unescaped
 *       caller HTML. Fixed below: the recipient is hardcoded, the subject and
 *       timestamp are built here, requestType is re-validated, and every
 *       caller-supplied string is HTML-escaped.
 *
 *   (b) The old `getJwtRole` only base64-DECODED the bearer token. Combined
 *       with the `--no-verify-jwt` deploy flag, a JWT signed with the literal
 *       string `notasignature` claiming `role:service_role` reached the
 *       `account-invite` / `rfi-created` passthroughs, which forward
 *       {to, subject, html} verbatim (rfi-created for an ARRAY of recipients,
 *       100 per Resend batch call). See docs/auth-pitfalls-playbook.md §18:
 *       "Decoding a JWT is not verifying it." That function is GONE. A caller
 *       is now trusted only if it PROVES it holds a service-role credential —
 *       either by presenting the exact injected key, or by the Supabase
 *       auth-admin API accepting it. No decoded claim authorises anything.
 *
 * Never reintroduce authorisation based on a decoded-but-unverified token,
 * and never let a caller of a PUBLIC type choose a recipient.
 */

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM = 'E-Site <noreply@e-site.live>'
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://www.e-site.live'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

/** Total emails handed to Resend by this instance — logged on every send so a
 *  relay burst is visible in the function logs rather than only on the Resend
 *  dashboard after the abuse report arrives. */
let totalSends = 0

interface EmailPayload {
  to: string
  subject: string
  html: string
}

async function sendEmail(payload: EmailPayload): Promise<void> {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not set')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, ...payload }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Resend error ${res.status}: ${body}`)
  }
  totalSends++
  console.log(`send-email: 1 message sent (instance total ${totalSends})`)
}

// Send many emails in one request via Resend's batch endpoint (up to 100 per
// call). Avoids the per-request rate limit that drops recipients when many
// individual sends fire concurrently. Each array entry is its own email
// (separate `to`), so recipients are not exposed to each other.
async function sendEmailBatch(messages: EmailPayload[]): Promise<{ sent: number; failed: number }> {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not set')
  if (messages.length === 0) return { sent: 0, failed: 0 }
  let sent = 0
  let failed = 0
  // Each 100-message chunk is independent: a failing chunk must NOT drop the
  // recipients in later chunks. Continue on error and report a tally so a
  // partial Resend outage can't silently lose most of a large roster.
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100).map((m) => ({ from: FROM, ...m }))
    try {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
      })
      if (res.ok) {
        sent += chunk.length
        totalSends += chunk.length
        console.log(`send-email: ${chunk.length} messages sent (instance total ${totalSends})`)
      } else {
        failed += chunk.length
        console.error(`Resend batch chunk ${i / 100} failed: ${res.status} ${await res.text()}`)
      }
    } catch (e) {
      failed += chunk.length
      console.error(`Resend batch chunk ${i / 100} threw: ${String(e)}`)
    }
  }
  return { sent, failed }
}

function baseTemplate(content: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0F172A;color:#E2E8F0;margin:0;padding:32px}
  .card{background:#1E293B;border:1px solid #334155;border-radius:12px;padding:28px;max-width:480px;margin:0 auto}
  h2{color:#fff;font-size:18px;margin:0 0 12px}p{font-size:14px;line-height:1.6;color:#94A3B8;margin:0 0 12px}
  .btn{display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px;margin-top:8px}
  .footer{margin-top:24px;font-size:11px;color:#475569;text-align:center}</style></head>
  <body><div class="card">${content}<div class="footer">E-Site Construction Management · <a href="${SITE_URL}" style="color:#3B82F6">www.e-site.live</a></div></div></body></html>`
}

/** Constant-time string compare — a plain `===` on a secret leaks its prefix
 *  through timing. Length is not secret here (both sides are fixed keys). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function sha256Hex(v: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Verified-credential cache, keyed by SHA-256 of the presented token so no
// credential (ours or an attacker's) is retained in memory. Positives are
// cached long enough to keep a burst of notifications to one round-trip;
// negatives briefly, so a probe flood can't be amplified into the auth API.
const VERDICT_CACHE = new Map<string, { ok: boolean; exp: number }>()
const POSITIVE_TTL_MS = 5 * 60_000
const NEGATIVE_TTL_MS = 30_000
const CACHE_MAX = 200

/**
 * Is this caller a service-role caller? PROVEN, not claimed.
 *
 * Two accepted proofs, in cost order:
 *   1. The token IS the service-role key injected into this function.
 *   2. The Supabase auth-admin API accepts the token. This second path exists
 *      because the edge runtime injects `sb_secret_…` while the web app may
 *      still hold the legacy JWT-shaped key (CLAUDE.md, 2026-07-23) — both are
 *      genuine credentials for this project, and a string compare against one
 *      of them would silently kill every notification email.
 *
 * Anything else — no token, the public anon key, or a forged JWT — is false.
 * A failed or unreachable check is false: this function fails CLOSED, because
 * every non-public type here is internal notification traffic and losing a
 * notification is cheaper than running a relay.
 */
async function isVerifiedServiceRoleCaller(authHeader: string | null): Promise<boolean> {
  if (!authHeader?.startsWith('Bearer ')) return false
  const token = authHeader.slice(7).trim()
  if (!token) return false

  // Explicit deny for the publishable/anon key BEFORE anything else. It ships
  // in the browser bundle, so it is public knowledge; this makes "the public
  // key can never pass" a property of this file rather than an assumption
  // about how the auth-admin route happens to treat it.
  if (ANON_KEY && timingSafeEqual(token, ANON_KEY)) return false

  if (SERVICE_ROLE_KEY && timingSafeEqual(token, SERVICE_ROLE_KEY)) return true
  if (!SUPABASE_URL) return false

  const key = await sha256Hex(token)
  const hit = VERDICT_CACHE.get(key)
  if (hit && hit.exp > Date.now()) return hit.ok

  let ok = false
  try {
    // Only a service-role credential is accepted by the auth-admin API; the
    // anon key and any unsigned/forged JWT get 401.
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: { Authorization: `Bearer ${token}`, apikey: token },
    })
    ok = res.status === 200
    // 401/403 is a rejected credential — expected, quiet. Anything else means
    // the verification path itself is broken, which fails every internal send
    // closed; say so loudly with the status so the post-deploy smoke test
    // diagnoses it in one log line instead of looking like "mail stopped".
    if (!ok && res.status !== 401 && res.status !== 403) {
      console.error(`send-email: service-role verification returned HTTP ${res.status} — internal sends will be refused`)
    }
  } catch (e) {
    console.error('send-email: service-role verification failed', String(e))
    ok = false
  }

  if (VERDICT_CACHE.size >= CACHE_MAX) VERDICT_CACHE.clear()
  VERDICT_CACHE.set(key, { ok, exp: Date.now() + (ok ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) })
  return ok
}

// Email types callable without a service-role credential. The POPIA data
// subject request form at /privacy/request is public by law, so this branch
// must be safe against an anonymous caller: it chooses NOTHING that reaches
// the wire — see the hardened handler below.
const PUBLIC_TYPES = new Set(['data-subject-request'])

const INFO_OFFICER_EMAIL = 'arno@watsonmattheus.com'

/** The five request types the public form offers. Mirrors the zod enum in
 *  apps/web/src/actions/data-request.actions.ts — a caller cannot invent one. */
const DSR_LABELS: Record<string, string> = {
  access: 'Access request (POPIA §23)',
  correction: 'Correction request (POPIA §24)',
  deletion: 'Deletion request (POPIA §24)',
  complaint: 'Complaint',
  other: 'Other',
}

/** Per-instance cap on the public branch. The Next server action rate-limits
 *  per IP, but a curl caller bypasses it entirely, so the ceiling has to live
 *  here too. */
const DSR_WINDOW_MS = 60 * 60_000
const DSR_MAX_PER_WINDOW = 20
let dsrWindowStart = 0
let dsrInWindow = 0

function consumeDsrBudget(): boolean {
  const now = Date.now()
  if (now - dsrWindowStart > DSR_WINDOW_MS) {
    dsrWindowStart = now
    dsrInWindow = 0
  }
  if (dsrInWindow >= DSR_MAX_PER_WINDOW) return false
  dsrInWindow++
  return true
}

/** Escape for HTML text content. The old code escaped only `<`, and only on
 *  `description` — `requestTypeLabel`, the requester name and the requester
 *  email went in raw, which is full body control on a public branch. */
function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Strip CR/LF (header injection) and clamp length before a value is used in a
 *  Subject line. */
function headerSafe(v: unknown, max: number): string {
  return String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  try {
    const { type, payload } = await req.json() as { type: string; payload: Record<string, any> }

    // Require a PROVEN service-role credential for every internal type. The
    // public POPIA branch is exempt from the credential check and is instead
    // hardened so that an anonymous caller controls nothing that ships.
    if (!PUBLIC_TYPES.has(type) && !(await isVerifiedServiceRoleCaller(req.headers.get('Authorization')))) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      })
    }

    if (type === 'account-invite') {
      // Passthrough: the web `sendInviteEmail` / `sendSiteAssignmentEmail`
      // helpers render the branded HTML (shared renderInviteEmail /
      // renderSiteAssignmentEmail — which name the inviter, company, role and
      // assigned site(s) so the message doesn't read as spam) and forward
      // { to, subject, html } here. Single recipient.
      //
      // NOTE: a NEW type name (not the old 'invite') on purpose — if the web
      // ships before this function is redeployed, the previously-deployed
      // function returns "unknown type" (400) and the web helper falls back to
      // the plain recovery email, rather than the old 'invite' handler silently
      // sending a broken message. Removes any deploy-ordering hazard.
      const { to, subject, html } = payload
      if (!to || !subject || !html) {
        return new Response(JSON.stringify({ error: 'account-invite requires to, subject, html' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        })
      }
      await sendEmail({ to, subject, html })
    }

    else if (type === 'rfi-created') {
      // The web `dispatchRfiEmail` helper renders the HTML (shared
      // renderRfiCreatedEmail) and forwards { to, subject, html } here. `to` may
      // be a single address or an array of all project members — sent as one
      // Resend batch so the per-request rate limit can't silently drop members.
      const { to, subject, html } = payload
      if (!to || !subject || !html) {
        return new Response(JSON.stringify({ error: 'rfi-created requires to, subject, html' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        })
      }
      const recipients: string[] = Array.isArray(to) ? to : [to]
      const result = await sendEmailBatch(recipients.map((addr) => ({ to: addr, subject, html })))
      // Total failure → 502 so the caller logs it. Partial failures are logged
      // per chunk above but still return 200, so delivered emails + the bell
      // aren't discarded.
      if (result.sent === 0 && result.failed > 0) {
        return new Response(JSON.stringify({ error: 'All email batches failed', ...result }), {
          status: 502, headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ sent: true, ...result }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    else if (type === 'snag-assigned') {
      const { to, assigneeName, snagTitle, projectName, snagId, raisedByName, priority } = payload
      const link = `${SITE_URL}/snags/${snagId}`
      const priorityColors: Record<string, string> = { critical: '#EF4444', high: '#F97316', medium: '#EAB308', low: '#6B7280' }
      const color = priorityColors[priority] ?? '#6B7280'
      await sendEmail({
        to,
        subject: `Snag assigned: ${snagTitle}`,
        html: baseTemplate(`
          <h2>Snag Assigned to You</h2>
          <p>Hi ${assigneeName},</p>
          <p><strong>${raisedByName}</strong> has assigned you a snag on project <strong>${projectName}</strong>.</p>
          <p><strong>Defect:</strong> ${snagTitle}<br>
          <strong>Priority:</strong> <span style="color:${color};font-weight:700">${priority}</span></p>
          <a class="btn" href="${link}">View Snag</a>
        `),
      })
    }

    else if (type === 'data-subject-request') {
      // PUBLIC BRANCH — assume the caller is hostile.
      //
      // The caller supplies only the CONTENT of the report: who they are and
      // what they are asking for. It does not choose the recipient (hardcoded
      // Information Officer), the subject (built here from a validated label),
      // the timestamp (server clock) or any markup (everything is escaped).
      // `payload.to` and `payload.subject` are deliberately ignored.
      if (!consumeDsrBudget()) {
        return new Response(JSON.stringify({ error: 'Too many requests' }), {
          status: 429, headers: { 'Content-Type': 'application/json' },
        })
      }

      const label = DSR_LABELS[String(payload?.requestType ?? '')]
      if (!label) {
        return new Response(JSON.stringify({ error: 'data-subject-request requires a known requestType' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        })
      }

      const requesterName = headerSafe(payload?.requester?.name, 120)
      const requesterEmail = headerSafe(payload?.requester?.email, 254)
      const description = String(payload?.description ?? '').slice(0, 5000)
      const receivedAt = new Date().toISOString()

      await sendEmail({
        to: INFO_OFFICER_EMAIL,
        subject: `[POPIA] ${label} from ${requesterName || 'unnamed requester'}`,
        html: baseTemplate(`
          <h2>POPIA data subject request</h2>
          <p><strong>Type:</strong> ${escapeHtml(label)}</p>
          <p><strong>From:</strong> ${escapeHtml(requesterName)} &lt;${escapeHtml(requesterEmail)}&gt;</p>
          <p><strong>Received:</strong> ${escapeHtml(receivedAt)}</p>
          <p style="white-space:pre-wrap;border-left:3px solid #334155;padding-left:12px;font-style:italic">${escapeHtml(description)}</p>
          <p style="font-size:12px;color:#64748B">POPIA §23 / §24 — respond within 30 days. Log this request per the Information Officer procedure.</p>
        `),
      })
    }

    else if (type === 'coc-status') {
      const { to, recipientName, siteName, subsectionName, newStatus, siteId } = payload
      const link = `${SITE_URL}/compliance/${siteId}`
      const statusLabels: Record<string, string> = { approved: 'Approved ✓', submitted: 'Submitted', under_review: 'Under Review', rejected: 'Rejected ✗' }
      await sendEmail({
        to,
        subject: `COC status update: ${siteName} — ${subsectionName}`,
        html: baseTemplate(`
          <h2>COC Status Update</h2>
          <p>Hi ${recipientName},</p>
          <p>The COC status for <strong>${subsectionName}</strong> on site <strong>${siteName}</strong> has changed to <strong>${statusLabels[newStatus] ?? newStatus}</strong>.</p>
          <a class="btn" href="${link}">View Compliance</a>
        `),
      })
    }

    else {
      return new Response(JSON.stringify({ error: `Unknown email type: ${type}` }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ sent: true }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err: any) {
    console.error('send-email error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
}

Deno.serve(handler)
