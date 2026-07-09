// packages/shared/src/lib/jbcc/docx-letterhead.ts
//
// Composite a per-organisation branded letterhead into an already-rendered
// JBCC `.docx` (post `fillTemplate`). The letterhead is injected at the top of
// the document body — a page-1 printed-letterhead block: optional logo image,
// the sender's company name in the brand accent colour, postal address,
// registration / VAT numbers, contact line, the controlled document reference,
// and an accent rule beneath.
//
// The result stays an editable .docx (no PDF flattening) so recipients and the
// issuer can keep working with it. Injection is pure OOXML manipulation via
// PizZip — no external converters.
//
// This module imports pizzip, so — like placeholder-fill — it is intentionally
// NOT re-exported from the package barrel. Import it via the sub-path entry:
//   import { injectLetterhead } from '@esite/shared/docx-letterhead'

import PizZip from 'pizzip'

export interface LetterheadLogo {
  /** Raw image bytes. */
  data: Uint8Array
  /** Only PNG and JPEG are supported (the two formats browsers export). */
  contentType: 'image/png' | 'image/jpeg'
}

export interface LetterheadBranding {
  companyName: string
  /** Postal address, one entry per line. */
  addressLines?: string[]
  registrationNo?: string | null
  vatNo?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  /** Brand accent as a 6-hex string WITHOUT the leading '#', e.g. 'E8923A'. */
  accentColorHex?: string | null
  /** The controlled document reference (e.g. 'JBCC-KINGSWALK-2026-0007'). */
  documentRef?: string | null
  /** Optional logo; omitted → text-only letterhead. */
  logo?: LetterheadLogo | null
}

const LOGO_REL_ID = 'rIdEsiteLetterheadLogo'
const NS = {
  wp:  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a:   'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  r:   'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
} as const

const EMU_PER_PX = 9525
const MAX_LOGO_WIDTH_EMU = Math.round(1.9 * 914400) // 1.9 inch

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function normaliseHex(hex?: string | null): string {
  const fallback = '1A1A1A'
  if (!hex) return fallback
  const h = hex.replace(/^#/, '').trim()
  return /^[0-9a-fA-F]{6}$/.test(h) ? h.toUpperCase() : fallback
}

/** Read pixel dimensions from a PNG or JPEG header. Returns null if unknown. */
export function readImageSize(
  bytes: Uint8Array,
  contentType: 'image/png' | 'image/jpeg',
): { width: number; height: number } | null {
  try {
    if (contentType === 'image/png') {
      // PNG: 8-byte signature, then IHDR chunk (length+type = 8 bytes) at 16.
      if (bytes.length < 24) return null
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const width = dv.getUint32(16)
      const height = dv.getUint32(20)
      if (width > 0 && height > 0) return { width, height }
      return null
    }
    // JPEG: walk the marker segments to the first Start-Of-Frame.
    let i = 2
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue }
      const marker = bytes[i + 1]
      // SOF0..SOF15 except DHT(0xc4)/JPG(0xc8)/DAC(0xcc) carry frame dims.
      if (
        marker >= 0xc0 && marker <= 0xcf &&
        marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      ) {
        const height = (bytes[i + 5] << 8) | bytes[i + 6]
        const width = (bytes[i + 7] << 8) | bytes[i + 8]
        if (width > 0 && height > 0) return { width, height }
        return null
      }
      const len = (bytes[i + 2] << 8) | bytes[i + 3]
      if (len <= 0) return null
      i += 2 + len
    }
    return null
  } catch {
    return null
  }
}

function logoExtentsEmu(logo: LetterheadLogo): { cx: number; cy: number } {
  const size = readImageSize(logo.data, logo.contentType)
  if (!size) return { cx: MAX_LOGO_WIDTH_EMU, cy: Math.round(MAX_LOGO_WIDTH_EMU * 0.4) }
  const wEmu = size.width * EMU_PER_PX
  const hEmu = size.height * EMU_PER_PX
  if (wEmu <= MAX_LOGO_WIDTH_EMU) return { cx: wEmu, cy: hEmu }
  const scale = MAX_LOGO_WIDTH_EMU / wEmu
  return { cx: MAX_LOGO_WIDTH_EMU, cy: Math.round(hEmu * scale) }
}

/** Ensure the root <w:document> tag declares every namespace the header uses. */
function ensureNamespaces(documentXml: string): string {
  const openMatch = documentXml.match(/<w:document\b[^>]*>/)
  if (!openMatch) return documentXml
  let openTag = openMatch[0]
  for (const [prefix, uri] of Object.entries(NS)) {
    if (!openTag.includes(`xmlns:${prefix}=`)) {
      openTag = openTag.replace(/>$/, ` xmlns:${prefix}="${uri}">`)
    }
  }
  return documentXml.replace(openMatch[0], openTag)
}

function ensureContentTypeDefault(contentTypesXml: string, ext: string, mime: string): string {
  if (new RegExp(`<Default Extension="${ext}"`, 'i').test(contentTypesXml)) {
    return contentTypesXml
  }
  return contentTypesXml.replace(
    /<\/Types>/,
    `<Default Extension="${ext}" ContentType="${mime}"/></Types>`,
  )
}

function addImageRelationship(relsXml: string, target: string): string {
  if (relsXml.includes(`Id="${LOGO_REL_ID}"`)) return relsXml
  const rel =
    `<Relationship Id="${LOGO_REL_ID}" ` +
    `Type="${NS.r.replace('relationships', 'relationships/image')}" ` +
    `Target="${target}"/>`
  return relsXml.replace(/<\/Relationships>/, `${rel}</Relationships>`)
}

function buildLogoDrawingXml(logo: LetterheadLogo): string {
  const { cx, cy } = logoExtentsEmu(logo)
  return (
    `<w:p><w:pPr><w:spacing w:after="60"/></w:pPr><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="9001" name="Letterhead logo"/>` +
    `<wp:cNvGraphicFramePr>` +
    `<a:graphicFrameLocks xmlns:a="${NS.a}" noChangeAspect="1"/>` +
    `</wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="${NS.a}"><a:graphicData ` +
    `uri="${NS.pic}"><pic:pic xmlns:pic="${NS.pic}">` +
    `<pic:nvPicPr><pic:cNvPr id="9001" name="Letterhead logo"/>` +
    `<pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${LOGO_REL_ID}"/>` +
    `<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/>` +
    `<a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  )
}

function textRun(text: string, opts: { bold?: boolean; sz?: number; color?: string; caps?: boolean } = {}): string {
  const rpr: string[] = []
  if (opts.bold) rpr.push('<w:b/>')
  if (opts.caps) rpr.push('<w:caps/>')
  if (opts.color) rpr.push(`<w:color w:val="${opts.color}"/>`)
  if (opts.sz) rpr.push(`<w:sz w:val="${opts.sz}"/>`)
  const rprXml = rpr.length ? `<w:rPr>${rpr.join('')}</w:rPr>` : ''
  return `<w:r>${rprXml}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
}

function line(runs: string, opts: { after?: number; border?: string } = {}): string {
  const ppr: string[] = []
  if (opts.after !== undefined) ppr.push(`<w:spacing w:after="${opts.after}"/>`)
  if (opts.border) {
    ppr.push(
      `<w:pBdr><w:bottom w:val="single" w:sz="18" w:space="4" w:color="${opts.border}"/></w:pBdr>`,
    )
  }
  const pprXml = ppr.length ? `<w:pPr>${ppr.join('')}</w:pPr>` : ''
  return `<w:p>${pprXml}${runs}</w:p>`
}

function buildLetterheadXml(b: LetterheadBranding, hasLogo: boolean): string {
  const accent = normaliseHex(b.accentColorHex)
  const muted = '6B6B6B'
  const parts: string[] = []

  if (hasLogo && b.logo) parts.push(buildLogoDrawingXml(b.logo))

  // Company name — accent, bold, ~13pt (sz is half-points → 26).
  parts.push(line(textRun(b.companyName, { bold: true, sz: 26, color: accent, caps: true }), { after: 20 }))

  const addr = (b.addressLines ?? []).filter(Boolean)
  if (addr.length) {
    parts.push(line(textRun(addr.join(', '), { sz: 16, color: muted }), { after: 10 }))
  }

  const regBits: string[] = []
  if (b.registrationNo) regBits.push(`Reg. No. ${b.registrationNo}`)
  if (b.vatNo) regBits.push(`VAT No. ${b.vatNo}`)
  if (regBits.length) {
    parts.push(line(textRun(regBits.join('   ·   '), { sz: 16, color: muted }), { after: 10 }))
  }

  const contact: string[] = []
  if (b.phone) contact.push(`Tel ${b.phone}`)
  if (b.email) contact.push(b.email)
  if (b.website) contact.push(b.website)
  if (contact.length) {
    // Accent bottom border sits under the contact line to rule off the letterhead.
    parts.push(line(textRun(contact.join('   ·   '), { sz: 16, color: muted }), { after: 40, border: accent }))
  } else {
    parts.push(line(textRun('', { sz: 8 }), { after: 40, border: accent }))
  }

  if (b.documentRef) {
    parts.push(line(textRun(`Our ref: ${b.documentRef}`, { bold: true, sz: 16, color: '1A1A1A' }), { after: 160 }))
  } else {
    parts.push(line('', { after: 120 }))
  }

  return parts.join('')
}

/**
 * Inject a branded letterhead into a rendered JBCC `.docx`.
 * Returns a new `.docx` Buffer; the input is not mutated.
 */
export function injectLetterhead(
  docxBytes: Buffer | Uint8Array,
  branding: LetterheadBranding,
): Buffer {
  const zip = new PizZip(docxBytes)

  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error('injectLetterhead: word/document.xml not found')
  let documentXml = docFile.asText()

  const bodyOpen = documentXml.match(/<w:body[^>]*>/)
  if (!bodyOpen) throw new Error('injectLetterhead: <w:body> not found')

  const hasLogo = Boolean(branding.logo && branding.logo.data && branding.logo.data.length > 0)

  if (hasLogo && branding.logo) {
    const ext = branding.logo.contentType === 'image/png' ? 'png' : 'jpeg'
    const mediaTarget = `media/esite_letterhead_logo.${ext}`
    zip.file(`word/${mediaTarget}`, branding.logo.data as Uint8Array)

    // [Content_Types].xml default for the image extension.
    const ctFile = zip.file('[Content_Types].xml')
    if (ctFile) {
      zip.file(
        '[Content_Types].xml',
        ensureContentTypeDefault(ctFile.asText(), ext, branding.logo.contentType),
      )
    }

    // word/_rels/document.xml.rels — create if the template somehow lacks it.
    const relsPath = 'word/_rels/document.xml.rels'
    const relsFile = zip.file(relsPath)
    const relsXml = relsFile
      ? relsFile.asText()
      : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
    zip.file(relsPath, addImageRelationship(relsXml, mediaTarget))

    documentXml = ensureNamespaces(documentXml)
  }

  const letterhead = buildLetterheadXml(branding, hasLogo)
  documentXml = documentXml.replace(bodyOpen[0], `${bodyOpen[0]}${letterhead}`)
  zip.file('word/document.xml', documentXml)

  return zip.generate({ type: 'nodebuffer' }) as Buffer
}
