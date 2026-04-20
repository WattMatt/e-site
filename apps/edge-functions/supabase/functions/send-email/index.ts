/**
 * Edge Function: send-email
 *
 * Sends transactional emails via Resend.
 *
 * Supported types:
 *   - rfi-assigned: notify assignee of new RFI
 *   - snag-assigned: notify assignee of new snag
 *   - invite: send org invite email with token link
 *   - coc-status: notify org members when COC status changes
 *
 * Request body:
 *   { type: EmailType, payload: Record<string, any> }
 *   Authorization: Bearer <service_role_key>
 */

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM = 'E-Site <noreply@e-site.co.za>'
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://app.e-site.co.za'

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
}

function baseTemplate(content: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0F172A;color:#E2E8F0;margin:0;padding:32px}
  .card{background:#1E293B;border:1px solid #334155;border-radius:12px;padding:28px;max-width:480px;margin:0 auto}
  h2{color:#fff;font-size:18px;margin:0 0 12px}p{font-size:14px;line-height:1.6;color:#94A3B8;margin:0 0 12px}
  .btn{display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px;margin-top:8px}
  .footer{margin-top:24px;font-size:11px;color:#475569;text-align:center}</style></head>
  <body><div class="card">${content}<div class="footer">E-Site Construction Management · <a href="${SITE_URL}" style="color:#3B82F6">app.e-site.co.za</a></div></div></body></html>`
}

// Decode JWT role claim without re-verifying — Supabase gateway already verified the signature.
function getJwtRole(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  try {
    const payload = JSON.parse(atob(authHeader.slice(7).split('.')[1]))
    return typeof payload.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

// Email types that the public anon client is permitted to trigger (POPIA DSR form).
const PUBLIC_TYPES = new Set(['data-subject-request'])

Deno.serve(async (req) => {
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

    // Require service_role for internal notification types.
    // Public types (POPIA DSR) may be called from the server-side anon client.
    const role = getJwtRole(req.headers.get('Authorization'))
    if (!PUBLIC_TYPES.has(type) && role !== 'service_role') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      })
    }

    if (type === 'invite') {
      const { to, orgName, inviterName, role, token } = payload
      const link = `${SITE_URL}/onboarding/join?token=${token}`
      await sendEmail({
        to,
        subject: `You've been invited to join ${orgName} on E-Site`,
        html: baseTemplate(`
          <h2>You're invited!</h2>
          <p><strong>${inviterName}</strong> has invited you to join <strong>${orgName}</strong> on E-Site as a <strong>${role}</strong>.</p>
          <p>Click the button below to accept the invitation (expires in 7 days).</p>
          <a class="btn" href="${link}">Accept Invitation</a>
          <p style="margin-top:16px;font-size:12px">Or copy this link: ${link}</p>
        `),
      })
    }

    else if (type === 'rfi-assigned') {
      const { to, assigneeName, rfiSubject, projectName, rfiId, raisedByName, dueDate } = payload
      const link = `${SITE_URL}/rfis/${rfiId}`
      await sendEmail({
        to,
        subject: `RFI assigned: ${rfiSubject}`,
        html: baseTemplate(`
          <h2>RFI Assigned to You</h2>
          <p>Hi ${assigneeName},</p>
          <p><strong>${raisedByName}</strong> has assigned you an RFI on project <strong>${projectName}</strong>.</p>
          <p><strong>Subject:</strong> ${rfiSubject}${dueDate ? `<br><strong>Due:</strong> ${dueDate}` : ''}</p>
          <a class="btn" href="${link}">View RFI</a>
        `),
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
      const { to, subject, requester, requestTypeLabel, description, receivedAt } = payload
      await sendEmail({
        to,
        subject,
        html: baseTemplate(`
          <h2>POPIA data subject request</h2>
          <p><strong>Type:</strong> ${requestTypeLabel}</p>
          <p><strong>From:</strong> ${requester.name} &lt;${requester.email}&gt;</p>
          <p><strong>Received:</strong> ${receivedAt}</p>
          <p style="white-space:pre-wrap;border-left:3px solid #334155;padding-left:12px;font-style:italic">${String(description).replace(/</g, '&lt;')}</p>
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
})
