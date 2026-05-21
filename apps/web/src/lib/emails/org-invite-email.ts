/**
 * Transactional email helper for the org-invite flow.
 *
 * Sends a "you've been invited to join [org]" nudge to an existing E-Site
 * user. There is NO accept-link in this email — the recipient logs in and
 * accepts the invitation in-app.
 *
 * Never throws: all errors are returned as { ok: false, error }.
 */

export interface SendOrgInviteEmailParams {
  to: string
  orgName: string
  inviterName: string
}

export async function sendOrgInviteEmail(
  params: SendOrgInviteEmailParams,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const apiKey = process.env.RESEND_API_KEY
    const from = process.env.RESEND_FROM
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL

    if (!apiKey || !from || !siteUrl) {
      return { ok: false, error: 'Missing email environment variables' }
    }

    const { to, orgName, inviterName } = params

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr>
      <td>
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:40px 36px;">
          <tr>
            <td style="padding-bottom:24px;">
              <span style="font-size:22px;font-weight:700;color:#1a1a1a;letter-spacing:-0.5px;">E-Site</span>
            </td>
          </tr>
          <tr>
            <td style="font-size:16px;color:#1a1a1a;line-height:1.6;padding-bottom:16px;">
              <strong>${escapeHtml(inviterName)}</strong> has invited you to join <strong>${escapeHtml(orgName)}</strong> on E-Site.
            </td>
          </tr>
          <tr>
            <td style="font-size:15px;color:#444444;line-height:1.6;padding-bottom:32px;">
              Log in to accept the invitation:
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:32px;">
              <a href="${siteUrl}/login"
                 style="display:inline-block;background:#d97706;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;">
                Log in to E-Site
              </a>
            </td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#888888;line-height:1.5;border-top:1px solid #eeeeee;padding-top:24px;">
              If you weren't expecting this invitation, you can safely ignore this email.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject: `You've been invited to join ${orgName} on E-Site`,
        html,
      }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText)
      return { ok: false, error: `Resend API error ${response.status}: ${text}` }
    }

    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
