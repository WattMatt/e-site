/**
 * DRAFT watermark helpers for cable-schedule exports.
 *
 * Applied ONLY when revision.status === 'DRAFT'. ISSUED and SUPERSEDED
 * revisions export clean. Purpose: prevent an in-progress draft from
 * being mistaken for an issued construction document if it leaves the
 * firm. Excel gets a red header cell + red tab; PDF gets a large
 * semi-transparent diagonal stamp across each page.
 */

import type ExcelJS from 'exceljs'
import type { PDFPage, PDFFont } from 'pdf-lib'
import { degrees, rgb } from 'pdf-lib'

// Tailwind red-600 in two notations so Excel + PDF stamps stay in sync.
const DRAFT_RED_ARGB = 'FFDC2626' as const
const DRAFT_RED_RGB = rgb(0.86, 0.15, 0.15)

/**
 * Add a DRAFT watermark to an Excel sheet. Places a red bold text cell
 * in row 1, plus tints the sheet's tab red so the unissued state is
 * visible at-a-glance in the workbook tab strip.
 *
 * Caller note: this OVERRIDES whatever is in A1 / A1:E1 on the sheet.
 * It unmerges any existing A1 range first so the watermark merge can
 * take effect. Sheets that have an existing A1 title should call this
 * BEFORE writing the title (and then either skip the title for DRAFT
 * exports, or write the title below the watermark) — the title
 * repetition is unnecessary on a DRAFT-stamped sheet anyway.
 */
export function stampExcelDraft(ws: ExcelJS.Worksheet): void {
  // Unmerge any existing range covering A1 so the new merge succeeds.
  try {
    ws.unMergeCells('A1')
  } catch {
    // No existing merge — fine.
  }
  ws.getCell('A1').value = '⚠ DRAFT — NOT FOR CONSTRUCTION'
  ws.getCell('A1').font = { bold: true, color: { argb: DRAFT_RED_ARGB }, size: 12 }
  ws.getCell('A1').alignment = { horizontal: 'left', vertical: 'middle' }
  ws.mergeCells('A1:E1')
  ws.properties.tabColor = { argb: DRAFT_RED_ARGB }
}

/**
 * Add a diagonal "DRAFT" watermark across a PDF page. Big,
 * semi-transparent red text rotated 45° across the centre.
 *
 * Caller note: this MUST be drawn first on a fresh page so subsequent
 * drawText / drawRectangle calls render on top of it. Calling after
 * other content would put the watermark over (obscuring) that content.
 */
export function stampPdfDraft(page: PDFPage, font: PDFFont): void {
  const { width, height } = page.getSize()
  page.drawText('DRAFT', {
    x: width / 2 - 200,
    y: height / 2 - 50,
    size: 160,
    font,
    color: DRAFT_RED_RGB,
    opacity: 0.18,
    rotate: degrees(45),
  })
}
