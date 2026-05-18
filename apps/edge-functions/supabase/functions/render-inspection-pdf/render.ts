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

  // Wrap the per-field render so we can recurse into repeating_group entries
  // with the same renderer. `xIndent` shifts the left edge for nested
  // sub-fields inside a repeating_group entry.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderField = async (field: any, xIndent: number, fieldIdOverride?: string) => {
    if (y < BOTTOM_MARGIN) newPage()
    const lookupId = fieldIdOverride ?? field.field_id
    const resp = p.responses.find(
      (r) => r.section_id === section.section_id && r.field_id === lookupId,
    )

    page.drawText(String(field.label ?? field.field_id ?? ''), {
      x: MARGIN_LEFT + xIndent,
      y,
      size: 10,
      font: fontReg,
      color: TEXT_DIM,
    })

    let valStr = '—'
    if (field.type === 'pass_fail') {
      valStr = resp?.value_bool === true ? '✓ PASS' : resp?.value_bool === false ? '✗ FAIL' : '—'
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
    page.drawText(valStr, { x: MARGIN_LEFT + xIndent, y: y - 14, size: 11, font: fontBold })
    y -= 32

    // Inline photos for this field id — 3-column × 3-row grid per page,
    // max 24 photos total. When called from a repeating_group entry,
    // `lookupId` is the synthetic `<group>[<i>].<sub>` so we automatically
    // scope photos to the entry.
    const MAX_PHOTOS_PER_FIELD = 24
    const PHOTOS_PER_ROW = 3
    const ROWS_PER_PAGE = 3
    const PHOTO_W = 160
    const PHOTO_H = 120
    const COL_GAP = 8
    const ROW_GAP = 8
    const CAPTION_BAND_H = 12 // pt reserved below each photo row for EXIF caption text

    const fieldPhotos = p.photos.filter(
      (ph) => ph.section_id === section.section_id && ph.field_id === lookupId,
    )
    const photosToRender = fieldPhotos.slice(0, MAX_PHOTOS_PER_FIELD)

    // Track the highest rendered row on the current page so y advances correctly.
    let renderedRows = 0
    let photosOnCurrentPage = 0

    for (let i = 0; i < photosToRender.length; i++) {
      const photo = photosToRender[i]
      const colIndex = i % PHOTOS_PER_ROW
      const rowIndexOnPage = Math.floor(photosOnCurrentPage / PHOTOS_PER_ROW) % ROWS_PER_PAGE

      // Start a new page after every full 3×3 block, or if insufficient vertical space.
      if (colIndex === 0) {
        if (rowIndexOnPage === 0 && photosOnCurrentPage > 0) {
          // Completed a full 3×3 block — new page
          renderedRows += ROWS_PER_PAGE
          newPage()
          photosOnCurrentPage = 0
        } else if (y < BOTTOM_MARGIN + PHOTO_H + CAPTION_BAND_H + ROW_GAP) {
          // Insufficient space for another row mid-block — new page
          renderedRows += rowIndexOnPage
          newPage()
          photosOnCurrentPage = 0
        }
      }

      if (!photo.signed_url) {
        photosOnCurrentPage++
        continue
      }

      const currentColIndex = photosOnCurrentPage % PHOTOS_PER_ROW
      const currentRowOnPage = Math.floor(photosOnCurrentPage / PHOTOS_PER_ROW) % ROWS_PER_PAGE
      const xPos = MARGIN_LEFT + xIndent + currentColIndex * (PHOTO_W + COL_GAP)
      const yPos = y - (currentRowOnPage + 1) * (PHOTO_H + ROW_GAP)

      try {
        const resp2 = await fetch(photo.signed_url)
        if (!resp2.ok) throw new Error(`HTTP ${resp2.status}`)
        const bytes = new Uint8Array(await resp2.arrayBuffer())
        let img
        try {
          img = await doc.embedJpg(bytes)
        } catch {
          img = await doc.embedPng(bytes)
        }
        const dims = img.scaleToFit(PHOTO_W, PHOTO_H)
        page.drawImage(img, {
          x: xPos,
          y: yPos + (PHOTO_H - dims.height), // align to top of cell
          width: dims.width,
          height: dims.height,
        })

        // EXIF caption band — renders directly below the photo cell.
        const captionParts: string[] = []
        if (photo.taken_at) {
          try {
            captionParts.push(new Date(photo.taken_at).toLocaleString('en-ZA'))
          } catch {
            captionParts.push(photo.taken_at)
          }
        }
        if (photo.gps_lat != null && photo.gps_lng != null) {
          captionParts.push(`${(photo.gps_lat as number).toFixed(5)}, ${(photo.gps_lng as number).toFixed(5)}`)
        }
        const capturedByName = p.capturedByLookup.get((photo.captured_by_profile_id as string | null | undefined) ?? '')
        if (capturedByName) captionParts.push(`by ${capturedByName}`)
        if (captionParts.length > 0) {
          const captionText = captionParts.join(' · ')
          // Truncate to avoid pdf-lib overflow (approx 3.5 chars per pt at size 6, PHOTO_W=160)
          const maxChars = Math.floor(PHOTO_W / 3.5)
          const displayCaption = captionText.length > maxChars
            ? captionText.slice(0, maxChars - 1) + '…'
            : captionText
          page.drawText(displayCaption, {
            x: xPos,
            y: yPos - 2, // 2pt gap below the bottom edge of the photo cell (yPos = bottom of cell)
            size: 6,
            font: fontReg,
            color: TEXT_DIM,
          })
        }
      } catch (e) {
        const tail = photo.signed_url.split('?')[0]?.split('/').pop() ?? photo.id
        page.drawText(`[image unavailable: ${tail}]`, {
          x: xPos,
          y: yPos + PHOTO_H - 12,
          size: 9,
          font: fontReg,
          color: TEXT_FADED,
        })
        console.warn('Photo embed failed:', (e as Error).message)
      }
      photosOnCurrentPage++
    }

    // Advance y past all rendered rows on the current (last) page.
    // Each row now occupies PHOTO_H + CAPTION_BAND_H + ROW_GAP.
    if (photosToRender.length > 0) {
      const rowsOnLastPage = Math.ceil(photosOnCurrentPage / PHOTOS_PER_ROW)
      y -= rowsOnLastPage * (PHOTO_H + CAPTION_BAND_H + ROW_GAP) + ROW_GAP
    }

    // Overflow notice when the field has more than MAX_PHOTOS_PER_FIELD photos.
    if (fieldPhotos.length > MAX_PHOTOS_PER_FIELD) {
      if (y < BOTTOM_MARGIN + 16) newPage()
      page.drawText(
        `(+${fieldPhotos.length - MAX_PHOTOS_PER_FIELD} additional photos omitted from PDF — view in app)`,
        { x: MARGIN_LEFT + xIndent, y, size: 8, font: fontReg, color: TEXT_FADED },
      )
      y -= 14
    }
  }

  for (const field of section.fields ?? []) {
    if (y < BOTTOM_MARGIN) newPage()

    // repeating_group: render group label as a sub-heading, then one block
    // per entry (entry number + each sub-field rendered with xIndent so the
    // hierarchy is visually obvious).
    if (field.type === 'repeating_group') {
      const subFields = (field.fields ?? []) as Array<{ field_id: string; label?: string; type?: string }>
      // Discover entry indices from the responses (synthetic `<group>[<i>].<sub>` shape).
      const indices = collectGroupEntryIndices(field.field_id, p.responses, section.section_id)

      // Sub-heading
      page.drawText(String(field.label ?? field.field_id ?? ''), {
        x: MARGIN_LEFT,
        y,
        size: 12,
        font: fontBold,
        color: TEXT_DIM,
      })
      y -= 18

      if (indices.length === 0) {
        page.drawText('(no entries)', {
          x: MARGIN_LEFT + 12,
          y,
          size: 10,
          font: fontReg,
          color: TEXT_FADED,
        })
        y -= 16
        continue
      }

      for (const i of indices) {
        if (y < BOTTOM_MARGIN + 40) newPage()
        page.drawText(`Entry ${i + 1}`, {
          x: MARGIN_LEFT + 8,
          y,
          size: 10,
          font: fontBold,
        })
        y -= 14
        for (const sub of subFields) {
          const syntheticId = `${field.field_id}[${i}].${sub.field_id}`
          await renderField(sub, 16, syntheticId)
        }
      }
      continue
    }

    await renderField(field, 0)
  }
}

// Collect distinct entry indices for a repeating_group from the response set
// scoped to one section. Synthetic field_id shape: `<group>[<i>].<sub>`.
function collectGroupEntryIndices(
  groupFieldId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  responses: any[],
  sectionId: string,
): number[] {
  const re = new RegExp(`^${groupFieldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[(\\d+)\\]\\.`)
  const set = new Set<number>()
  for (const r of responses) {
    if (r.section_id !== sectionId) continue
    const m = String(r.field_id ?? '').match(re)
    if (m) set.add(parseInt(m[1], 10))
  }
  return [...set].sort((a, b) => a - b)
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
      // For a repeating_group: scan each entry's sub-fields for fails.
      if (field.type === 'repeating_group') {
        const indices = collectGroupEntryIndices(field.field_id, p.responses, section.section_id)
        const subFields = (field.fields ?? []) as Array<{ field_id: string; label?: string; type?: string; sans_reference?: string }>
        for (const i of indices) {
          for (const sub of subFields) {
            const syntheticId = `${field.field_id}[${i}].${sub.field_id}`
            const resp = p.responses.find(
              (r) => r.section_id === section.section_id && r.field_id === syntheticId,
            )
            const isFail =
              (sub.type === 'pass_fail' && resp?.value_bool === false) ||
              (sub.type === 'number' && resp?.pass_state === 'fail')
            if (isFail) {
              failed.push({
                label: `${section.title} → ${field.label ?? field.field_id} [entry ${i + 1}] → ${sub.label ?? sub.field_id}`,
                sans: sub.sans_reference,
              })
            }
          }
        }
        continue
      }

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
