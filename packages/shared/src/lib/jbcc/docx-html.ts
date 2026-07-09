// packages/shared/src/lib/jbcc/docx-html.ts
//
// Server-only helpers for the live letter PREVIEW. `docxToHtml` converts a
// rendered .docx body to HTML via mammoth; `renderLetterheadHtml` renders the
// branded letterhead as HTML so the on-screen preview matches the letterhead
// baked into the downloadable .docx (docx-letterhead.ts).
//
// Imports mammoth (server-only) — NOT re-exported from the barrel. Import via
// the sub-path entry:  import { docxToHtml } from '@esite/shared/docx-preview'

import mammoth from 'mammoth'

/**
 * Convert a rendered .docx buffer to HTML for on-screen preview.
 * The docx's only variable content is plain, already-escaped text (field
 * values pass through docxtemplater as text runs), so mammoth's output is
 * safe to render. Returned HTML is body-level (<p>, <table>, …), no <html>.
 */
export async function docxToHtml(buffer: Buffer | Uint8Array): Promise<string> {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  const { value } = await mammoth.convertToHtml({ buffer: input })
  return value
}

export interface LetterheadHtmlBranding {
  companyName: string
  addressLines?: string[]
  registrationNo?: string | null
  vatNo?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  accentColorHex?: string | null
  documentRef?: string | null
  /** data: URI for the logo image (e.g. 'data:image/png;base64,…'). */
  logoDataUri?: string | null
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function accentHex(hex?: string | null): string {
  if (!hex) return '#1A1A1A'
  const h = hex.replace(/^#/, '').trim()
  return /^[0-9a-fA-F]{6}$/.test(h) ? `#${h.toUpperCase()}` : '#1A1A1A'
}

/**
 * Render the branded letterhead as a self-contained HTML block (inline styles
 * only, so it renders identically inside any preview container). Mirrors the
 * structure of docx-letterhead.ts.
 */
export function renderLetterheadHtml(b: LetterheadHtmlBranding): string {
  const accent = accentHex(b.accentColorHex)
  const muted = '#6B6B6B'
  const rows: string[] = []

  if (b.logoDataUri) {
    rows.push(
      `<img src="${esc(b.logoDataUri)}" alt="" style="max-height:56px;max-width:180px;object-fit:contain;display:block;margin-bottom:8px" />`,
    )
  }
  rows.push(
    `<div style="font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${accent};font-size:15px">${esc(b.companyName)}</div>`,
  )
  const addr = (b.addressLines ?? []).filter(Boolean)
  if (addr.length) {
    rows.push(`<div style="color:${muted};font-size:12px;margin-top:3px">${esc(addr.join(', '))}</div>`)
  }
  const reg: string[] = []
  if (b.registrationNo) reg.push(`Reg. No. ${b.registrationNo}`)
  if (b.vatNo) reg.push(`VAT No. ${b.vatNo}`)
  if (reg.length) {
    rows.push(`<div style="color:${muted};font-size:12px;margin-top:2px">${esc(reg.join('   ·   '))}</div>`)
  }
  const contact: string[] = []
  if (b.phone) contact.push(`Tel ${b.phone}`)
  if (b.email) contact.push(b.email)
  if (b.website) contact.push(b.website)
  if (contact.length) {
    rows.push(`<div style="color:${muted};font-size:12px;margin-top:2px">${esc(contact.join('   ·   '))}</div>`)
  }

  const ref = b.documentRef
    ? `<div style="font-weight:700;font-size:12px;margin-top:14px;color:#1A1A1A">Our ref: ${esc(b.documentRef)}</div>`
    : ''

  return (
    `<div style="border-bottom:2px solid ${accent};padding-bottom:10px;margin-bottom:6px">${rows.join('')}</div>${ref}`
  )
}
