/**
 * Base HTML template for lifecycle emails.
 *
 * Mobile-optimised (single column, max 480px), warm-dark palette aligned with
 * the web app, single CTA button, POPIA-compliant unsubscribe link in footer.
 * Kept inline-CSS only — many email clients strip <style> blocks.
 *
 * All lifecycle sequence templates import this and return `{ subject, html }`.
 */

export interface BaseTemplateVars {
  preheader?: string          // hidden preview text shown in inbox previews
  heading: string
  bodyHtml: string            // inner HTML allowed; keep inline
  ctaLabel?: string
  ctaHref?: string
  siteUrl: string
  unsubscribeUrl: string      // MUST be a real URL — POPIA + anti-spam requirement
}

const PALETTE = {
  bg:          '#0D0B09',
  card:        '#161310',
  border:      '#2A2520',
  text:        '#EDE8DF',
  textMid:     '#9A8F80',
  textDim:     '#544D43',
  amber:       '#E8923A',
  amberOnDark: '#0D0B09',
}

export function baseTemplate(v: BaseTemplateVars): string {
  const preheader = v.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;color:transparent;opacity:0;font-size:1px;line-height:1px">${escape(v.preheader)}</div>`
    : ''

  const cta = v.ctaLabel && v.ctaHref
    ? `<a href="${v.ctaHref}" style="display:inline-block;background:${PALETTE.amber};color:${PALETTE.amberOnDark};text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:700;font-size:14px;letter-spacing:0.01em;margin-top:8px">${escape(v.ctaLabel)}</a>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(v.heading)}</title>
</head>
<body style="margin:0;padding:32px 16px;background:${PALETTE.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${PALETTE.text}">
${preheader}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:480px;margin:0 auto">
  <tr><td style="padding:0 0 24px">
    <span style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;letter-spacing:0.15em;color:${PALETTE.amber};text-transform:uppercase">E-Site</span>
  </td></tr>
  <tr><td style="background:${PALETTE.card};border:1px solid ${PALETTE.border};border-radius:8px;padding:28px">
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:${PALETTE.text};line-height:1.3">${escape(v.heading)}</h1>
    <div style="font-size:14px;line-height:1.65;color:${PALETTE.textMid}">${v.bodyHtml}</div>
    ${cta ? `<div style="margin-top:24px">${cta}</div>` : ''}
  </td></tr>
  <tr><td style="padding:20px 4px 0;font-size:11px;color:${PALETTE.textDim};line-height:1.5">
    E-Site · Construction management for SA electrical contractors.<br>
    <a href="${v.siteUrl}" style="color:${PALETTE.textMid};text-decoration:underline">app.e-site.co.za</a>
    · <a href="${v.unsubscribeUrl}" style="color:${PALETTE.textMid};text-decoration:underline">Unsubscribe</a>
  </td></tr>
</table>
</body>
</html>`
}

// Minimal HTML escaper for values substituted into templates. Not a full
// sanitiser — templates are static; only user-derived strings (names, org
// names) pass through here.
export function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
