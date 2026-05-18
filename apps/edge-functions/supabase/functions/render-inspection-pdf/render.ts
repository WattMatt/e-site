/**
 * Renders an inspection PDF: cover, table of contents, per-section pages
 * (fields in template order with inline 3-up photos), summary, signatures,
 * appendix A placeholder, appendix B audit history.
 *
 * Watermarking: when opts.draft is true every page gets a diagonal
 * semi-transparent red "DRAFT — NOT FOR CONSTRUCTION" stamp at 45°.
 *
 * Image embed: photos fetched from signed URLs and embedded with
 * embedJpg/embedPng fallback. Network or decode failures degrade
 * gracefully to a text placeholder so the renderer never aborts.
 */

import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'
import type { InspectionPayload } from './payload-loader.ts'

const A4_WIDTH = 595
const A4_HEIGHT = 842
const MARGIN_LEFT = 40
const BOTTOM_MARGIN = 60

const DRAFT_RED = rgb(0.9, 0, 0)
const HEADER_NAVY = rgb(0.1, 0.2, 0.4)
const TEXT_DIM = rgb(0.4, 0.4, 0.4)
const TEXT_FADED = rgb(0.5, 0.5, 0.5)

interface RenderOpts {
  draft: boolean
}

// pdf-lib doesn't export the page type cleanly through the skypack ESM,
// so use a structural type for the font + page params.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfFont = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfPage = any

export async function renderInspectionPdf(
  p: InspectionPayload,
  opts: RenderOpts,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const fontReg = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)

  await drawCoverPage(doc, p, fontReg, fontBold)
  drawToc(doc, p, fontReg, fontBold)

  const sections = (p.template?.schema_json?.sections ?? []) as Array<{
    section_id: string
    title: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fields: any[]
  }>
  for (const section of sections) {
    await drawSectionPages(doc, p, section, fontReg, fontBold)
  }

  drawSummaryPage(doc, p, fontReg, fontBold)
  await drawSignaturesPage(doc, p, fontReg, fontBold)
  drawAppendixA(doc, fontReg, fontBold)
  drawAppendixB(doc, p, fontReg, fontBold)

  if (opts.draft) {
    for (const page of doc.getPages()) stampDraft(page, fontBold)
  }

  return await doc.save()
}

// ─── helpers ──────────────────────────────────────────────────────────

function stampDraft(page: PdfPage, font: PdfFont): void {
  const { width, height } = page.getSize()
  page.drawText('DRAFT — NOT FOR CONSTRUCTION', {
    x: width / 2 - 200,
    y: height / 2,
    size: 48,
    font,
    color: DRAFT_RED,
    opacity: 0.2,
    rotate: degrees(45),
  })
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-ZA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return iso ?? '—'
  }
}

// Parse a 6-char hex string like "#0a5f4e" into rgb. Returns null if invalid.
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.match(/^#([0-9a-fA-F]{6})$/)
  if (!m) return null
  const h = m[1]
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  }
}

async function drawCoverPage(
  doc: PDFDocument,
  p: InspectionPayload,
  fontReg: PdfFont,
  fontBold: PdfFont,
): Promise<void> {
  const page = doc.addPage([A4_WIDTH, A4_HEIGHT])

  // Branding (per-template) — accent_color + cover_page.{title, subtitle, company_name}.
  // Read from template.schema_json since `branding` lives in the JSON document, not
  // a separate column. Missing/invalid → renderer-default colours + labels (no throws).
  const branding = (p.template?.schema_json as { branding?: {
    accent_color?: string
    cover_page?: { title?: string; subtitle?: string; company_name?: string; logo_url?: string }
  } } | undefined)?.branding

  const accentRgb = branding?.accent_color ? hexToRgb(branding.accent_color) : null
  const headerColor = accentRgb ? rgb(accentRgb.r, accentRgb.g, accentRgb.b) : HEADER_NAVY

  const deliverable = p.template?.deliverable_type as string | undefined
  const deliverableLabel =
    deliverable === 'coc'
      ? 'CERTIFICATE OF COMPLIANCE'
      : deliverable === 'factory_test'
        ? 'FACTORY ACCEPTANCE TEST'
        : 'INSPECTION REPORT'
  const headerLabel = branding?.cover_page?.title ?? deliverableLabel

  // Top header band — accent_color override applied here.
  page.drawRectangle({
    x: 0,
    y: A4_HEIGHT - 42,
    width: A4_WIDTH,
    height: 42,
    color: headerColor,
  })
  page.drawText(headerLabel, {
    x: MARGIN_LEFT,
    y: A4_HEIGHT - 27,
    size: 16,
    font: fontBold,
    color: rgb(1, 1, 1),
  })

  let y = A4_HEIGHT - 72

  // Subtitle (optional) — sits above the data rows
  if (branding?.cover_page?.subtitle) {
    page.drawText(branding.cover_page.subtitle, {
      x: MARGIN_LEFT,
      y,
      size: 11,
      font: fontReg,
      color: TEXT_DIM,
    })
    y -= 22
  }
  const drawRow = (label: string, value: string) => {
    page.drawText(label, {
      x: MARGIN_LEFT,
      y,
      size: 9,
      font: fontReg,
      color: TEXT_DIM,
    })
    page.drawText(value || '—', {
      x: MARGIN_LEFT,
      y: y - 14,
      size: 12,
      font: fontBold,
    })
    y -= 36
  }

  drawRow('Document number', p.inspection?.coc_number ?? '— pending —')
  drawRow('Project', p.project?.name ?? '—')
  drawRow('Project code', p.project?.code ?? '—')
  drawRow('Target equipment', p.inspection?.target_label ?? '—')
  drawRow(
    'Template',
    p.template ? `${p.template.name ?? '—'} (v${p.template.version ?? '?'})` : '—',
  )
  drawRow(
    'Inspectors',
    p.contributors
      .map((c) => c.full_name || c.email || '—')
      .filter(Boolean)
      .join(', ') || '—',
  )
  drawRow('Verifier', p.verifier ? p.verifier.full_name || p.verifier.email || '—' : '—')
  drawRow('Started', fmtDate(p.inspection?.started_at))
  drawRow('Certified', fmtDate(p.inspection?.certified_at))
  drawRow('Overall result', (p.inspection?.overall_result as string | null) ?? '—')

  if (p.template?.sans_reference) {
    page.drawText(`Standard: ${p.template.sans_reference}`, {
      x: MARGIN_LEFT,
      y: 60,
      size: 10,
      font: fontReg,
    })
  }

  // Company name (optional) — bottom-right of cover page
  if (branding?.cover_page?.company_name) {
    const companyText = branding.cover_page.company_name
    const textWidth = fontBold.widthOfTextAtSize(companyText, 10)
    page.drawText(companyText, {
      x: A4_WIDTH - MARGIN_LEFT - textWidth,
      y: 30,
      size: 10,
      font: fontBold,
      color: TEXT_DIM,
    })
  }
}

function drawToc(
  doc: PDFDocument,
  p: InspectionPayload,
  fontReg: PdfFont,
  fontBold: PdfFont,
): void {
  const page = doc.addPage([A4_WIDTH, A4_HEIGHT])
  page.drawText('Contents', {
    x: MARGIN_LEFT,
    y: A4_HEIGHT - 42,
    size: 18,
    font: fontBold,
  })

  let y = A4_HEIGHT - 72
  const sections = (p.template?.schema_json?.sections ?? []) as Array<{ title: string }>
  for (const [i, s] of sections.entries()) {
    page.drawText(`${i + 1}. ${s.title ?? '(untitled section)'}`, {
      x: MARGIN_LEFT,
      y,
      size: 11,
      font: fontReg,
    })
    y -= 18
  }
  const tail = [
    'Summary',
    'Signatures',
    'Appendix A — Attachments',
    'Appendix B — Audit history',
  ]
  for (const label of tail) {
    y -= 18
    page.drawText(label, { x: MARGIN_LEFT, y, size: 11, font: fontReg })
  }
}

async function drawSectionPages(
  doc: PDFDocument,
  p: InspectionPayload,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  section: { section_id: string; title: string; fields: any[] },
  fontReg: PdfFont,
  fontBold: PdfFont,
): Promise<void> {
  let page = doc.addPage([A4_WIDTH, A4_HEIGHT])
  let y = A4_HEIGHT - 42
  page.drawText(section.title ?? '(untitled section)', {
    x: MARGIN_LEFT,
    y,
    size: 14,
    font: fontBold,
  })
  y -= 24

  const newPage = () => {
    page = doc.addPage([A4_WIDTH, A4_HEIGHT])
    y = A4_HEIGHT - 42
  }

  for (const field of section.fields ?? []) {
    if (y < BOTTOM_MARGIN) newPage()
    const resp = p.responses.find(
      (r) => r.section_id === section.section_id && r.field_id === field.field_id,
    )

    page.drawText(String(field.label ?? field.field_id ?? ''), {
      x: MARGIN_LEFT,
      y,
      size: 10,
      font: fontReg,
      color: TEXT_DIM,
    })

    let valStr = '—'
    if (field.type === 'pass_fail') {
      valStr =
        resp?.value_bool === true ? '✓ PASS' : resp?.value_bool === false ? '✗ FAIL' : '—'
    } else if (field.type === 'number') {
      if (resp?.value_number != null) {
        const unit = field.unit ? ` ${field.unit}` : ''
        const threshold = field.pass_when
          ? `  (threshold ${field.pass_when} · ${resp.pass_state ?? 'not_checked'})`
          : ''
        valStr = `${resp.value_number}${unit}${threshold}`
      }
    } else if (field.type === 'multi_select') {
      valStr = ((resp?.value_array ?? []) as string[]).join(', ') || '—'
    } else {
      valStr = (resp?.value_text as string | null) ?? '—'
    }
    page.drawText(valStr, { x: MARGIN_LEFT, y: y - 14, size: 11, font: fontBold })
    y -= 32

    // Inline photos for this field (3-up grid, max 3 thumbnails per row).
    const fieldPhotos = p.photos.filter(
      (ph) => ph.section_id === section.section_id && ph.field_id === field.field_id,
    )
    for (const photo of fieldPhotos.slice(0, 3)) {
      if (y < 200) newPage()
      if (!photo.signed_url) continue
      try {
        const resp = await fetch(photo.signed_url)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const bytes = new Uint8Array(await resp.arrayBuffer())
        let img
        try {
          img = await doc.embedJpg(bytes)
        } catch {
          img = await doc.embedPng(bytes)
        }
        const dims = img.scaleToFit(160, 120)
        page.drawImage(img, {
          x: MARGIN_LEFT,
          y: y - dims.height,
          width: dims.width,
          height: dims.height,
        })
        y -= dims.height + 8
      } catch (e) {
        const tail = photo.signed_url.split('?')[0]?.split('/').pop() ?? photo.id
        page.drawText(`[image unavailable: ${tail}]`, {
          x: MARGIN_LEFT,
          y,
          size: 9,
          font: fontReg,
          color: TEXT_FADED,
        })
        y -= 12
        console.warn('Photo embed failed:', (e as Error).message)
      }
    }
  }
}

function drawSummaryPage(
  doc: PDFDocument,
  p: InspectionPayload,
  fontReg: PdfFont,
  fontBold: PdfFont,
): void {
  const page = doc.addPage([A4_WIDTH, A4_HEIGHT])
  page.drawText('Summary', {
    x: MARGIN_LEFT,
    y: A4_HEIGHT - 42,
    size: 18,
    font: fontBold,
  })

  let y = A4_HEIGHT - 72
  page.drawText(`Overall result: ${(p.inspection?.overall_result as string | null) ?? '—'}`, {
    x: MARGIN_LEFT,
    y,
    size: 12,
    font: fontBold,
  })
  y -= 30

  // Failed field list: walk template fields, pick those where the response
  // failed (pass_fail=false OR pass_state='fail').
  const failed: Array<{ label: string; sans?: string }> = []
  const sections = (p.template?.schema_json?.sections ?? []) as Array<{
    section_id: string
    title: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fields: any[]
  }>
  for (const section of sections) {
    for (const field of section.fields ?? []) {
      const resp = p.responses.find(
        (r) => r.section_id === section.section_id && r.field_id === field.field_id,
      )
      const isFail =
        (field.type === 'pass_fail' && resp?.value_bool === false) ||
        (field.type === 'number' && resp?.pass_state === 'fail')
      if (isFail) {
        failed.push({
          label: `${section.title} → ${field.label ?? field.field_id}`,
          sans: field.sans_reference,
        })
      }
    }
  }

  if (failed.length === 0) {
    page.drawText('No failed fields recorded.', {
      x: MARGIN_LEFT,
      y,
      size: 10,
      font: fontReg,
      color: TEXT_FADED,
    })
    return
  }

  page.drawText('Failed fields:', { x: MARGIN_LEFT, y, size: 11, font: fontBold })
  y -= 18
  for (const f of failed.slice(0, 30)) {
    if (y < BOTTOM_MARGIN) break
    const line = f.sans ? `• ${f.label}  [${f.sans}]` : `• ${f.label}`
    page.drawText(line, { x: MARGIN_LEFT, y, size: 10, font: fontReg })
    y -= 14
  }
}

async function drawSignaturesPage(
  doc: PDFDocument,
  p: InspectionPayload,
  fontReg: PdfFont,
  fontBold: PdfFont,
): Promise<void> {
  const page = doc.addPage([A4_WIDTH, A4_HEIGHT])
  page.drawText('Signatures', {
    x: MARGIN_LEFT,
    y: A4_HEIGHT - 42,
    size: 18,
    font: fontBold,
  })

  let y = A4_HEIGHT - 82
  for (const s of p.signatures) {
    if (y < 180) break
    page.drawText(s.signatory_name ?? '—', {
      x: MARGIN_LEFT,
      y,
      size: 12,
      font: fontBold,
    })
    page.drawText(s.signatory_title ?? '', {
      x: MARGIN_LEFT,
      y: y - 14,
      size: 9,
      font: fontReg,
      color: TEXT_DIM,
    })
    page.drawText(`Reg #: ${s.registration_number ?? '—'}`, {
      x: MARGIN_LEFT,
      y: y - 26,
      size: 9,
      font: fontReg,
    })
    page.drawText(`Role: ${s.role} · ${fmtDate(s.signed_at)}`, {
      x: MARGIN_LEFT,
      y: y - 38,
      size: 9,
      font: fontReg,
    })
    if (s.signed_url) {
      try {
        const resp = await fetch(s.signed_url)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const bytes = new Uint8Array(await resp.arrayBuffer())
        const img = await doc.embedPng(bytes)
        const dims = img.scaleToFit(200, 80)
        page.drawImage(img, {
          x: 280,
          y: y - dims.height,
          width: dims.width,
          height: dims.height,
        })
      } catch (e) {
        console.warn('Signature embed failed:', (e as Error).message)
      }
    }
    y -= 110
  }
}

function drawAppendixA(doc: PDFDocument, fontReg: PdfFont, fontBold: PdfFont): void {
  const page = doc.addPage([A4_WIDTH, A4_HEIGHT])
  page.drawText('Appendix A — Attachments', {
    x: MARGIN_LEFT,
    y: A4_HEIGHT - 42,
    size: 18,
    font: fontBold,
  })
  page.drawText('Attachment list will appear here in future versions.', {
    x: MARGIN_LEFT,
    y: A4_HEIGHT - 72,
    size: 10,
    font: fontReg,
    color: TEXT_FADED,
  })
}

function drawAppendixB(
  doc: PDFDocument,
  p: InspectionPayload,
  fontReg: PdfFont,
  fontBold: PdfFont,
): void {
  const page = doc.addPage([A4_WIDTH, A4_HEIGHT])
  page.drawText('Appendix B — Audit history', {
    x: MARGIN_LEFT,
    y: A4_HEIGHT - 42,
    size: 18,
    font: fontBold,
  })

  let y = A4_HEIGHT - 72
  for (const h of p.responseHistory.slice(0, 60)) {
    if (y < BOTTOM_MARGIN) break
    const when = h.responded_at
      ? new Date(h.responded_at).toISOString().slice(0, 16).replace('T', ' ')
      : '????-??-?? ??:??'
    const by =
      typeof h.responded_by === 'string' ? h.responded_by.slice(0, 8) : '????????'
    const line = `${when}  ${h.section_id ?? '?'}.${h.field_id ?? '?'}  by ${by}`
    page.drawText(line, { x: MARGIN_LEFT, y, size: 8, font: fontReg })
    y -= 11
  }
}
