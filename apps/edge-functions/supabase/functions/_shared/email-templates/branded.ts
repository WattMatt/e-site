// Light, org-co-branded transactional template for auth + notification mail.
// Replaces the dark baseTemplate. Inline CSS only (email clients strip <style>).

import type { OrgBranding } from '../auth-email/types.ts'

export interface BrandedTemplateVars {
  heading: string
  bodyHtml: string            // inner HTML; keep inline. Caller pre-escapes user text.
  ctaLabel: string
  ctaHref: string
  /** e.g. "This link expires in 60 minutes." */
  expiryLabel?: string
  /** Paste-able fallback URL shown as visible text. */
  fallbackLink: string
  /** Org co-branding; null → platform-only (account-level mail). */
  org: OrgBranding | null
  siteUrl?: string
}

const PALETTE = {
  bg:       '#F4F5F7',
  card:     '#FFFFFF',
  border:   '#E2E5EA',
  text:     '#1A1F2B',
  textMid:  '#5B6472',
  textDim:  '#9AA2AF',
  ctaText:  '#FFFFFF',
}

export function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function brandedTemplate(v: BrandedTemplateVars): string {
  const siteUrl = v.siteUrl ?? 'https://app.e-site.live'
  const accent = v.org?.accent ?? '#E69500'

  // Header: org logo image OR org wordmark, with "via E-Site". Platform-only
  // when org is null.
  let header: string
  if (v.org) {
    const mark = v.org.logoSrc
      ? `<img src="${v.org.logoSrc}" alt="${escape(v.org.name)}" style="max-height:36px;max-width:180px;display:block">`
      : `<span style="font-size:18px;font-weight:700;color:${PALETTE.text}">${escape(v.org.name)}</span>`
    header = `${mark}<div style="margin-top:6px;font-size:11px;letter-spacing:0.08em;color:${PALETTE.textDim};text-transform:uppercase">via E-Site</div>`
  } else {
    header = `<span style="font-size:18px;font-weight:700;letter-spacing:0.04em;color:${accent}">E-Site</span>`
  }

  const expiry = v.expiryLabel
    ? `<p style="margin:20px 0 0;font-size:12px;color:${PALETTE.textDim}">${escape(v.expiryLabel)}</p>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(v.heading)}</title>
</head>
<body style="margin:0;padding:32px 16px;background:${PALETTE.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${PALETTE.text}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:480px;margin:0 auto">
  <tr><td style="padding:0 4px 20px">${header}</td></tr>
  <tr><td style="background:${PALETTE.card};border:1px solid ${PALETTE.border};border-radius:10px;padding:32px">
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:${PALETTE.text};line-height:1.3">${escape(v.heading)}</h1>
    <div style="font-size:14px;line-height:1.65;color:${PALETTE.textMid}">${v.bodyHtml}</div>
    <div style="margin-top:24px">
      <a href="${v.ctaHref}" style="display:inline-block;background:${accent};color:${PALETTE.ctaText};text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:700;font-size:14px">${escape(v.ctaLabel)}</a>
    </div>
    ${expiry}
    <p style="margin:20px 0 0;font-size:12px;color:${PALETTE.textDim};line-height:1.5">
      Button not working? Copy and paste this link into your browser:<br>
      <span style="color:${PALETTE.textMid};word-break:break-all">${escape(v.fallbackLink)}</span>
    </p>
  </td></tr>
  <tr><td style="padding:20px 4px 0;font-size:11px;color:${PALETTE.textDim};line-height:1.5">
    E-Site · Construction management for SA electrical contractors.<br>
    <a href="${siteUrl}" style="color:${PALETTE.textMid};text-decoration:underline">app.e-site.live</a>
  </td></tr>
</table>
</body>
</html>`
}
