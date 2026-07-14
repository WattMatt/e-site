/**
 * QC report "issued" email — pure rendering.
 *
 * Runtime-agnostic (no Deno / Node globals) so it can be unit-tested in the
 * shared package and called from the web `notifyQcIssued` helper. The web
 * helper renders here, resolves recipients via `buildRfiEmailRecipients`
 * (rfi-email.ts) and forwards { to, subject, html } to the `send-email`
 * Edge Function's `rfi-created` passthrough branch.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Dark-card transactional wrapper matching the other send-email templates. */
function baseEmailTemplate(content: string, siteUrl: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0F172A;color:#E2E8F0;margin:0;padding:32px}
.card{background:#1E293B;border:1px solid #334155;border-radius:12px;padding:28px;max-width:480px;margin:0 auto}
h2{margin:0 0 16px;font-size:18px}
.btn{display:inline-block;margin-top:16px;background:#3B82F6;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px}
.footer{margin-top:24px;font-size:11px;color:#64748B}</style></head>
<body><div class="card">${content}<div class="footer">E-Site Construction Management · <a href="${siteUrl}" style="color:#3B82F6">app.e-site.live</a></div></div></body></html>`
}

export interface QcIssuedEmailVars {
  projectName: string
  reportTitle: string
  reportNo: number
  issuerName: string
  entryCount: number
  photoCount: number
  /** Full URL to the report page, e.g. {siteUrl}/projects/{id}/quality-control/{reportId}. */
  deepLink: string
  /** 7-day signed URL for the saved PDF; null when signing failed (link omitted). */
  pdfUrl: string | null
}

/** Render the recipient-neutral "QC report issued" email (summary + deep link + PDF link). */
export function renderQcIssuedEmail(v: QcIssuedEmailVars): { subject: string; html: string } {
  // Footer origin derived from the deep link so the two never disagree.
  let siteUrl: string
  try {
    siteUrl = new URL(v.deepLink).origin
  } catch {
    siteUrl = 'https://www.e-site.live'
  }
  const subject = `QC Report issued: ${v.reportTitle}`
  const pdfLine = v.pdfUrl
    ? `<a class="btn" href="${escapeHtml(v.pdfUrl)}">Download PDF</a>
    <p style="font-size:12px;color:#94A3B8;margin-top:8px">The PDF link is valid for 7 days.</p>`
    : ''
  const html = baseEmailTemplate(
    `<h2>QC report issued</h2>
    <p><strong>${escapeHtml(v.issuerName)}</strong> issued QC report <strong>#${v.reportNo}</strong> on project <strong>${escapeHtml(v.projectName)}</strong>.</p>
    <p><strong>Title:</strong> ${escapeHtml(v.reportTitle)}<br>
    <strong>Entries:</strong> ${v.entryCount} &nbsp;·&nbsp; <strong>Photos:</strong> ${v.photoCount}</p>
    <a class="btn" href="${escapeHtml(v.deepLink)}">View QC report</a>
    ${pdfLine}`,
    siteUrl,
  )
  return { subject, html }
}
