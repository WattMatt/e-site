/**
 * Edge Function: send-email
 *
 * Sends transactional notification emails via Resend, using the shared light
 * branded template (the dark baseTemplate was retired in Phase 1).
 *
 * Supported types:
 *   - rfi-assigned: notify assignee of new RFI
 *   - snag-assigned: notify assignee of new snag
 *   - data-subject-request: POPIA DSR notification (public form)
 *   - coc-status: notify org members when COC status changes
 *   - gcr-client-request: notify project managers a client submitted GCR change requests
 *   - gcr-request-actioned: notify a client their GCR change request was actioned
 *
 * NOTE: the `invite` type is GONE. Member invites are now sent by the
 * `auth-email-hook` Send Email hook via auth.admin.inviteUserByEmail.
 *
 * Request body:
 *   { type: EmailType, payload: Record<string, any> }
 *   Authorization: Bearer <service_role_key>
 */

import { brandedTemplate } from '../_shared/email-templates/branded.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM = 'E-Site <noreply@e-site.live>'
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://app.e-site.live'

interface EmailPayload {
  to: string | string[]
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

    if (type === 'rfi-assigned') {
      const { to, assigneeName, rfiSubject, projectName, rfiId, raisedByName, dueDate } = payload
      const link = `${SITE_URL}/rfis/${rfiId}`
      await sendEmail({
        to,
        subject: `RFI assigned: ${rfiSubject}`,
        html: brandedTemplate({
          org: null,
          heading: 'RFI assigned to you',
          bodyHtml: `<p>Hi ${assigneeName},</p>
            <p><strong>${raisedByName}</strong> assigned you an RFI on <strong>${projectName}</strong>.</p>
            <p><strong>Subject:</strong> ${rfiSubject}${dueDate ? `<br><strong>Due:</strong> ${dueDate}` : ''}</p>`,
          ctaLabel: 'View RFI',
          ctaHref: link,
          fallbackLink: link,
          siteUrl: SITE_URL,
        }),
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
        html: brandedTemplate({
          org: null,
          heading: 'Snag assigned to you',
          bodyHtml: `<p>Hi ${assigneeName},</p>
            <p><strong>${raisedByName}</strong> assigned you a snag on <strong>${projectName}</strong>.</p>
            <p><strong>Defect:</strong> ${snagTitle}<br>
            <strong>Priority:</strong> <span style="color:${color};font-weight:700">${priority}</span></p>`,
          ctaLabel: 'View snag',
          ctaHref: link,
          fallbackLink: link,
          siteUrl: SITE_URL,
        }),
      })
    }

    else if (type === 'data-subject-request') {
      const { to, subject, requester, requestTypeLabel, description, receivedAt } = payload
      await sendEmail({
        to,
        subject,
        html: brandedTemplate({
          org: null,
          heading: 'POPIA data subject request',
          bodyHtml: `<p><strong>Type:</strong> ${requestTypeLabel}</p>
            <p><strong>From:</strong> ${requester.name} &lt;${requester.email}&gt;</p>
            <p><strong>Received:</strong> ${receivedAt}</p>
            <p style="white-space:pre-wrap;border-left:3px solid #E2E5EA;padding-left:12px;font-style:italic">${String(description).replace(/</g, '&lt;')}</p>
            <p style="font-size:12px;color:#9AA2AF">POPIA §23 / §24 — respond within 30 days. Log this request per the Information Officer procedure.</p>`,
          ctaLabel: 'Open admin',
          ctaHref: SITE_URL,
          fallbackLink: SITE_URL,
          siteUrl: SITE_URL,
        }),
      })
    }

    else if (type === 'coc-status') {
      const { to, recipientName, siteName, subsectionName, newStatus, siteId } = payload
      const link = `${SITE_URL}/compliance/${siteId}`
      const statusLabels: Record<string, string> = { approved: 'Approved ✓', submitted: 'Submitted', under_review: 'Under Review', rejected: 'Rejected ✗' }
      await sendEmail({
        to,
        subject: `COC status update: ${siteName} — ${subsectionName}`,
        html: brandedTemplate({
          org: null,
          heading: 'COC status update',
          bodyHtml: `<p>Hi ${recipientName},</p>
            <p>The COC status for <strong>${subsectionName}</strong> on site <strong>${siteName}</strong> has changed to <strong>${statusLabels[newStatus] ?? newStatus}</strong>.</p>`,
          ctaLabel: 'View compliance',
          ctaHref: link,
          fallbackLink: link,
          siteUrl: SITE_URL,
        }),
      })
    }

    else if (type === 'gcr-client-request') {
      // Notify project managers that a client submitted GCR change requests.
      // `to` is resolved by the caller (the submitting client is not an org
      // member, so recipient emails are resolved server-side with service role).
      const { to, projectId, requestCount } = payload as {
        to: string | string[]; projectId: string; requestCount: number
      }
      const recipients = Array.isArray(to) ? to.filter(Boolean) : (to ? [to] : [])
      if (recipients.length === 0) {
        return new Response(JSON.stringify({ sent: false, reason: 'no recipients' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const link = `${SITE_URL}/projects/${projectId}/generator-cost-recovery`
      await sendEmail({
        to: recipients,
        subject: `New client cost-recovery requests (${requestCount})`,
        html: brandedTemplate({
          org: null,
          heading: 'Client cost-recovery requests',
          bodyHtml: `<p>A client submitted <strong>${requestCount}</strong> change request(s) on a generator cost-recovery review.</p>
            <p>Open the project's GCR module to review and action them.</p>`,
          ctaLabel: 'Open GCR module',
          ctaHref: link,
          fallbackLink: link,
          siteUrl: SITE_URL,
        }),
      })
    }

    else if (type === 'gcr-request-actioned') {
      // Notify a client that their GCR change request was actioned.
      const { to, projectId, status, field, reply } = payload as {
        to: string; projectId: string; status: string; field: string; reply: string | null
      }
      if (!to) {
        return new Response(JSON.stringify({ sent: false, reason: 'no recipient' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const link = `${SITE_URL}/portal/sites/${projectId}/gcr`
      const statusLabels: Record<string, string> = {
        accepted: 'Accepted ✓', declined: 'Declined ✗', open: 'Updated',
      }
      const label = statusLabels[status] ?? status
      await sendEmail({
        to,
        subject: `Your cost-recovery request was ${status}`,
        html: brandedTemplate({
          org: null,
          heading: 'Cost-recovery request update',
          bodyHtml: `<p>Your request to change <strong>${field}</strong> on the generator cost-recovery schedule was <strong>${label}</strong>.</p>
            ${reply ? `<p style="white-space:pre-wrap;border-left:3px solid #E2E5EA;padding-left:12px;font-style:italic">${String(reply).replace(/</g, '&lt;')}</p>` : ''}`,
          ctaLabel: 'View your review',
          ctaHref: link,
          fallbackLink: link,
          siteUrl: SITE_URL,
        }),
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
