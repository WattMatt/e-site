/**
 * Edge Function: notify-rfi-created
 *
 * Fans out the "new RFI" notifications to the whole project audience:
 *   - in-app bell + Expo push  → via the send-notification function
 *   - email (gated)            → via the send-email `rfi-created` function
 *
 * Invoked from `rfiService.create` (packages/shared) right after the RFI row is
 * inserted, so web, mobile, and any future caller notify uniformly from one
 * shared code path (no service-role key on the device).
 *
 * Audience is resolved LIVE via the canonical `project_notification_recipients`
 * SQL function (migration 00146) — active explicit project_members UNION
 * implicit org owners/admins/PMs — the exact same source web's notify path uses
 * (apps/web/src/lib/recipients.ts), so the two can never drift:
 *   - bell  → recipients excluding the raiser
 *   - email → whole roster (raiser included), gated on notify_rfi_email
 *
 * The email rendering below is a LOCKSTEP MIRROR of renderRfiCreatedEmail /
 * buildRfiEmailRecipients in packages/shared/src/email/rfi-email.ts. Edge
 * functions in this repo do not import @esite/shared (same convention as
 * calculate-health-scores / payment-recovery-check) — keep these in sync.
 *
 * Request body: { rfiId: string }
 * Auth (forgery-proof, independent of the gateway verify_jwt setting): the caller
 *   must present EITHER the service-role key (constant-time compare) OR a user JWT
 *   that validates via auth.getUser AND belongs to the RFI's raiser. Decoding an
 *   unverified JWT claim is deliberately avoided (that was a past auth-bypass).
 *   This stops an authed user from triggering a fan-out for an arbitrary rfiId.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://app.e-site.live'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

// Constant-time string compare — avoids leaking the service key via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// LOCKSTEP MIRROR of renderRfiCreatedEmail (packages/shared/src/email/rfi-email.ts).
function renderRfiCreatedEmail(v: {
  raisedByName: string
  assigneeName: string | null
  rfiSubject: string
  projectName: string
  priority: string
  dueDate: string | null
  rfiId: string
}): { subject: string; html: string } {
  const link = `${SITE_URL}/rfis/${v.rfiId}`
  const assignee = v.assigneeName ?? 'Unassigned'
  const subject = `New RFI: ${v.rfiSubject}`
  const content = `<h2>New RFI raised</h2>
    <p><strong>${escapeHtml(v.raisedByName)}</strong> raised an RFI on project <strong>${escapeHtml(v.projectName)}</strong>.</p>
    <p><strong>Subject:</strong> ${escapeHtml(v.rfiSubject)}<br>
    <strong>Assigned to:</strong> ${escapeHtml(assignee)}<br>
    <strong>Priority:</strong> ${escapeHtml(v.priority)}${v.dueDate ? `<br><strong>Due:</strong> ${escapeHtml(v.dueDate)}` : ''}</p>
    <a class="btn" href="${link}">View RFI</a>`
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0F172A;color:#E2E8F0;margin:0;padding:32px}
.card{background:#1E293B;border:1px solid #334155;border-radius:12px;padding:28px;max-width:480px;margin:0 auto}
h2{margin:0 0 16px;font-size:18px}
.btn{display:inline-block;margin-top:16px;background:#3B82F6;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px}
.footer{margin-top:24px;font-size:11px;color:#64748B}</style></head>
<body><div class="card">${content}<div class="footer">E-Site Construction Management · <a href="${SITE_URL}" style="color:#3B82F6">app.e-site.live</a></div></div></body></html>`
  return { subject, html }
}

// LOCKSTEP MIRROR of buildRfiEmailRecipients (packages/shared/src/email/rfi-email.ts).
// Dedupes by lowercased email; drops null/blank/non-email entries; preserves the
// original casing of the first occurrence.
function buildRfiEmailRecipients(emails: (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of emails) {
    if (!raw) continue
    const trimmed = raw.trim()
    const norm = trimmed.toLowerCase()
    if (!norm || !norm.includes('@')) continue
    if (seen.has(norm)) continue
    seen.add(norm)
    out.push(trimmed)
  }
  return out
}

interface RecipientRow {
  user_id: string
  email: string | null
  full_name: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  let rfiId: string | undefined
  try {
    ;({ rfiId } = await req.json())
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  if (!rfiId) return json({ error: 'rfiId is required' }, 400)

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  // Resolve the RFI (service role bypasses RLS).
  const { data: rfi, error: rfiErr } = await supabase
    .schema('projects')
    .from('rfis')
    .select('id, subject, priority, due_date, raised_by, assigned_to, project_id, organisation_id')
    .eq('id', rfiId)
    .maybeSingle()
  if (rfiErr) return json({ error: rfiErr.message }, 500)
  if (!rfi) return json({ error: 'RFI not found' }, 404)

  // Abuse guard — forgery-proof regardless of the gateway verify_jwt setting:
  //   • service-role caller: bearer IS the service key (constant-time compare), or
  //   • the raiser: their user JWT validates via auth.getUser and matches raised_by.
  let authorized = token !== '' && timingSafeEqual(token, SERVICE_KEY)
  if (!authorized && token) {
    const { data: { user } } = await supabase.auth.getUser(token)
    authorized = !!user && user.id === rfi.raised_by
  }
  if (!authorized) return json({ error: 'Forbidden' }, 403)

  const svcHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` }
  const results: Record<string, unknown> = {}

  // ── Bell + push: full live audience minus the raiser (RFIs are team-wide) ──
  const { data: bellRows, error: bellRpcErr } = await supabase.rpc('project_notification_recipients', {
    p_project_id: rfi.project_id,
    p_exclude_user: rfi.raised_by,
  })
  if (bellRpcErr) console.error('notify-rfi-created: bell recipients RPC failed', rfi.id, bellRpcErr.message)
  const bellIds = [
    ...new Set(((bellRows ?? []) as RecipientRow[]).map((r) => r.user_id).filter(Boolean)),
  ]
  if (bellIds.length) {
    const body = `"${rfi.subject}" — ${rfi.priority} priority${rfi.due_date ? ` · due ${rfi.due_date}` : ''}`
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
        method: 'POST',
        headers: svcHeaders,
        body: JSON.stringify({
          userIds: bellIds,
          title: 'New RFI raised',
          body,
          type: 'rfi_created',
          entityType: 'rfi',
          entityId: rfi.id,
          data: { route: `/rfis/${rfi.id}` },
        }),
      })
      if (!res.ok) console.error('notify-rfi-created: send-notification', rfi.id, res.status, await res.text().catch(() => ''))
      results.bell = { status: res.status, count: bellIds.length }
    } catch (e) {
      console.error('notify-rfi-created: send-notification threw', rfi.id, String(e))
      results.bell = { error: String(e) }
    }
  } else {
    results.bell = { skipped: 'no other recipients' }
  }

  // ── Email: gated on notify_rfi_email; whole roster (raiser included) ──
  const { data: settings } = await supabase
    .schema('projects')
    .from('project_settings')
    .select('notify_rfi_email')
    .eq('project_id', rfi.project_id)
    .maybeSingle()
  // Default true mirrors projectSettingsDefaults.notifyRfiEmail (the row is 1:1
  // via the ensure trigger, so the fallback is a safety net only).
  const rfiEmailOn = settings ? settings.notify_rfi_email !== false : true

  if (rfiEmailOn) {
    const { data: rosterRows, error: rosterRpcErr } = await supabase.rpc('project_notification_recipients', {
      p_project_id: rfi.project_id,
      p_exclude_user: null,
    })
    if (rosterRpcErr) console.error('notify-rfi-created: email roster RPC failed', rfi.id, rosterRpcErr.message)
    const recipients = buildRfiEmailRecipients(((rosterRows ?? []) as RecipientRow[]).map((r) => r.email))
    if (recipients.length) {
      // Names for the email body (raiser, assignee, project).
      const nameIds = [rfi.assigned_to, rfi.raised_by].filter(Boolean) as string[]
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', nameIds)
      const profiles: Record<string, { full_name: string | null }> =
        Object.fromEntries(((profileRows ?? []) as any[]).map((p) => [p.id, p]))
      const { data: project } = await supabase
        .schema('projects')
        .from('projects')
        .select('name')
        .eq('id', rfi.project_id)
        .maybeSingle()
      const { subject, html } = renderRfiCreatedEmail({
        raisedByName: profiles[rfi.raised_by]?.full_name ?? 'A team member',
        assigneeName: rfi.assigned_to ? (profiles[rfi.assigned_to]?.full_name ?? null) : null,
        rfiSubject: rfi.subject,
        projectName: (project as { name?: string } | null)?.name ?? 'your project',
        priority: rfi.priority,
        dueDate: rfi.due_date ?? null,
        rfiId: rfi.id,
      })
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
          method: 'POST',
          headers: svcHeaders,
          body: JSON.stringify({ type: 'rfi-created', payload: { to: recipients, subject, html } }),
        })
        if (!res.ok) console.error('notify-rfi-created: send-email', rfi.id, res.status, await res.text().catch(() => ''))
        results.email = { status: res.status, count: recipients.length }
      } catch (e) {
        console.error('notify-rfi-created: send-email threw', rfi.id, String(e))
        results.email = { error: String(e) }
      }
    } else {
      results.email = { skipped: 'no recipients' }
    }
  } else {
    results.email = { skipped: 'notify_rfi_email off' }
  }

  return json({ ok: true, rfiId: rfi.id, ...results })
})
