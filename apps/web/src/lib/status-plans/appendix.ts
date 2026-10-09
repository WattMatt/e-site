/**
 * "Appendix — Tenant status plans" for the tenant schedule report (spec §8), appended with pdf-lib
 * after react-pdf has rendered the report — the same shape as cable route sheets
 * (lib/cable-schedule/route-sheets.ts appendRouteSheetsToPdf).
 *
 * Plan pages are drawn first and the divider is INSERTED in front of them afterwards, so the divider
 * can list exactly what made it in and what did not (and why) — including a drawing that only failed
 * while embedding. One bad drawing never fails the report.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { PURPOSE_LABEL } from '@esite/shared/status-plans'
import { winAnsiSafe } from '@/lib/pdf/winansi'
import { drawStatusPlanPage, planTitle, type PlanFonts, type StatusPlanRenderInput } from './render-plan-page'
import type { PlanOmission, PlanRenderLoadResult } from './plan-render-data'

const A4_W = 595.28
const A4_H = 841.89
const MAX_LISTED_OMISSIONS = 30
const T = (s: string) => winAnsiSafe(s)

function fit(text: string, font: PDFFont, size: number, width: number): string {
  let t = T(text)
  if (font.widthOfTextAtSize(t, size) <= width) return t
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1)
  return `${t}...`
}

function drawDivider(page: PDFPage, included: StatusPlanRenderInput[], notIncluded: PlanOmission[], fonts: PlanFonts, generatedOn: string): void {
  const margin = 40
  let y = A4_H - margin
  page.drawRectangle({ x: 0, y: A4_H - 6, width: A4_W, height: 6, color: rgb(0.95, 0.6, 0.1) })
  page.drawText(T('Appendix — Tenant status plans'), { x: margin, y: y - 22, size: 18, font: fonts.bold, color: rgb(0.05, 0.05, 0.05) })
  y -= 44
  page.drawText(
    T(`Each plan is the project drawing with its shops and boards coloured from the tenant schedule as it stood on ${generatedOn}. Colours are computed when the report is generated, so this report is a snapshot of that day.`),
    { x: margin, y, size: 9, font: fonts.regular, color: rgb(0.35, 0.35, 0.35), maxWidth: A4_W - margin * 2, lineHeight: 12 },
  )
  y -= 44
  const cols = [
    { title: '#', x: margin, w: 18 },
    { title: 'Plan', x: margin + 22, w: 230 },
    { title: 'Kind', x: margin + 256, w: 110 },
    { title: 'Drawing', x: margin + 370, w: 120 },
    { title: 'Page', x: margin + 494, w: 30 },
  ]
  for (const c of cols) page.drawText(T(c.title), { x: c.x, y, size: 8.5, font: fonts.bold })
  y -= 6
  page.drawLine({ start: { x: margin, y }, end: { x: A4_W - margin, y }, thickness: 0.6, color: rgb(0.7, 0.7, 0.7) })
  y -= 14
  included.forEach((p, i) => {
    const cells = [String(i + 1), p.planName, PURPOSE_LABEL[p.purpose], p.drawingName, String(p.pageIndex)]
    cells.forEach((cell, j) => page.drawText(fit(cell, fonts.regular, 8.5, cols[j]!.w), { x: cols[j]!.x, y, size: 8.5, font: fonts.regular }))
    y -= 15
  })
  if (included.length === 0) { page.drawText(T('No plan could be included.'), { x: margin, y, size: 9, font: fonts.regular }); y -= 15 }

  if (notIncluded.length > 0) {
    y -= 12
    page.drawText(T('Not included'), { x: margin, y, size: 10, font: fonts.bold })
    y -= 16
    for (const o of notIncluded.slice(0, MAX_LISTED_OMISSIONS)) {
      page.drawText(fit(`${o.title}: ${o.reason}`, fonts.regular, 8.5, A4_W - margin * 2), { x: margin, y, size: 8.5, font: fonts.regular, color: rgb(0.55, 0.3, 0.05) })
      y -= 13
    }
    if (notIncluded.length > MAX_LISTED_OMISSIONS) {
      page.drawText(T(`…and ${notIncluded.length - MAX_LISTED_OMISSIONS} more.`), { x: margin, y, size: 8.5, font: fonts.regular })
    }
  }
}

export async function appendStatusPlansToPdf(
  pdf: PDFDocument, load: PlanRenderLoadResult, fonts: PlanFonts, generatedOn: string,
): Promise<{ appended: number; notIncluded: PlanOmission[] }> {
  if (load.inputs.length === 0 && load.omitted.length === 0) return { appended: 0, notIncluded: [] }
  const dividerAt = pdf.getPageCount()
  const included: StatusPlanRenderInput[] = []
  const notIncluded: PlanOmission[] = [...load.omitted]
  for (const input of load.inputs) {
    const before = pdf.getPageCount()
    try {
      await drawStatusPlanPage(pdf, input, 'a3', fonts)
      included.push(input)
    } catch (e) {
      while (pdf.getPageCount() > before) pdf.removePage(pdf.getPageCount() - 1)
      notIncluded.push({ title: planTitle(input.planName, input.purpose, input.pageIndex), reason: e instanceof Error ? e.message : String(e) })
    }
  }
  drawDivider(pdf.insertPage(dividerAt, [A4_W, A4_H]), included, notIncluded, fonts, generatedOn)
  return { appended: included.length, notIncluded }
}

/** Append to an already-rendered report. Returns the input bytes untouched when there is nothing to add. */
export async function appendStatusPlansToReport(reportPdf: Uint8Array, load: PlanRenderLoadResult, generatedOn: string): Promise<Uint8Array> {
  if (load.inputs.length === 0 && load.omitted.length === 0) return reportPdf
  const pdf = await PDFDocument.load(reportPdf)
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) }
  await appendStatusPlansToPdf(pdf, load, fonts, generatedOn)
  return pdf.save()
}
