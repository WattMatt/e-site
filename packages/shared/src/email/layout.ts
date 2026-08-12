/**
 * Shared BRANDED transactional email layout — pure rendering, no I/O.
 *
 * Every existing transactional template (invite, rfi, qc, snag-visit, diary)
 * carries its own private copy of an unbranded `baseEmailTemplate`: no logo, no
 * per-project accent, just a text wordmark in the footer. Meanwhile
 * `projects.projects.client_logo_url` / `project_logo_url` / `report_accent_color`
 * and `organisations.report_accent_color` already reach the PDF renderer. This
 * module is the first layout that actually uses them.
 *
 * It deliberately keeps the existing dark-card palette (bg #0F172A, card
 * #1E293B, border #334155, text #E2E8F0, dim #94A3B8, footer #64748B) so a
 * branded mail sits alongside the current ones without looking foreign — only
 * the header rule, the eyebrow and any CTA are driven by the accent colour.
 *
 * Migrating the five existing copies onto this layout is intentionally out of
 * scope; they are untouched.
 *
 * CRITICAL — IMAGES MUST BE SIGNED URLs, NEVER `data:` URIs. Gmail and most
 * webmail clients strip `data:` in <img src>, so inlined bytes render as broken
 * images. (The inverse holds for PDFs, which must embed `data:` URIs.) This
 * module enforces the rule defensively: a `data:` logo is treated as absent.
 *
 * Runtime-agnostic — no Node or Deno globals — so it unit-tests in
 * packages/shared and can be called from web server actions or Edge Functions.
 */

/** Escape a caller-supplied string for interpolation into HTML text or an attribute. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Palette shared with the unbranded templates, so branded mail sits alongside them. */
export const EMAIL_PALETTE = {
  bg: '#0F172A',
  card: '#1E293B',
  border: '#334155',
  text: '#E2E8F0',
  dim: '#94A3B8',
  footer: '#64748B',
} as const

/** Fallback when neither the project nor the organisation defines an accent. */
export const DEFAULT_ACCENT_COLOR = '#E69500'

/**
 * Accent colours land inside `style="..."` attributes, so anything that is not
 * an obvious CSS colour literal is rejected rather than escaped — a malformed
 * value would silently break the layout in some clients even if it were inert.
 */
export function safeAccentColor(raw: string | null | undefined): string {
  const v = (raw ?? '').trim()
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v
  if (/^rgba?\(\s*[\d.\s,%]+\)$/.test(v)) return v
  if (/^[a-zA-Z]{3,20}$/.test(v)) return v
  return DEFAULT_ACCENT_COLOR
}

/**
 * A logo is only emitted when it is a real, fetchable URL. `data:` URIs are
 * dropped (see the header note) and so is anything blank.
 */
function safeLogoUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  if (/^data:/i.test(v)) return null
  return v
}

export interface BrandedEmailOptions {
  /** Already resolved by the caller: project → organisation → DEFAULT_ACCENT_COLOR. */
  accentColor: string
  /** SIGNED URL. Never a `data:` URI — one passed here is dropped, not emitted. */
  logoUrl: string | null
  projectName: string
  title: string
  /** Caller-built HTML for the body. The caller is responsible for escaping it. */
  contentHtml: string
  /** App origin, e.g. https://www.e-site.live (no trailing slash). */
  siteUrl: string
  /** Small print above the wordmark, e.g. a regulatory disclaimer. */
  footerNote?: string
}

/**
 * Render the branded dark-card shell: optional logo, project eyebrow, title,
 * accent rule, caller content, optional footer note, wordmark.
 *
 * Layout-critical rules are inline styles — many clients strip <style> blocks
 * entirely; the <style> block carries base typography and the `.btn` accent
 * only, and callers who need a guaranteed button should inline it themselves.
 */
export function renderBrandedEmail(o: BrandedEmailOptions): string {
  const accent = safeAccentColor(o.accentColor)
  const logo = safeLogoUrl(o.logoUrl)
  const p = EMAIL_PALETTE

  const logoHtml = logo
    ? `<div style="margin:0 0 18px"><img src="${escapeHtml(logo)}" alt="${escapeHtml(o.projectName)}" height="40" style="max-height:40px;max-width:220px;display:block;border:0" /></div>`
    : ''

  const footerNoteHtml = o.footerNote
    ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid ${p.border};font-size:11px;line-height:1.6;color:${p.dim}">${escapeHtml(o.footerNote)}</div>`
    : ''

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:${p.bg};color:${p.text};margin:0;padding:32px}
h1{margin:0;font-size:20px;line-height:1.3;font-weight:700}
p{margin:0 0 12px;font-size:14px;line-height:1.6}
a{color:${accent}}
.btn{display:inline-block;background:${accent};color:#0F172A;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:700;font-size:14px}</style></head>
<body style="background:${p.bg};color:${p.text};margin:0;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="background:${p.card};border:1px solid ${p.border};border-radius:12px;padding:28px;max-width:560px;margin:0 auto">
${logoHtml}<div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${p.dim};margin-bottom:6px">${escapeHtml(o.projectName)}</div>
<h1 style="margin:0;font-size:20px;line-height:1.3;font-weight:700;color:${p.text}">${escapeHtml(o.title)}</h1>
<div style="height:3px;width:56px;background:${accent};border-radius:2px;margin:14px 0 20px"></div>
<div style="font-size:14px;line-height:1.6;color:${p.text}">${o.contentHtml}</div>
${footerNoteHtml}
<div style="margin-top:24px;font-size:11px;color:${p.footer}">E-Site Construction Management · <a href="${escapeHtml(o.siteUrl)}" style="color:${accent}">e-site.live</a></div>
</div></body></html>`
}
