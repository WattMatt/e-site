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
import { pruneUnreachableObjects } from '@/lib/pdf/prune-unreachable'
import { drawStatusPlanPage, planTitle, StatusPlanSourceError, type PlanFonts, type StatusPlanRenderInput } from './render-plan-page'
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

export const DIVIDER_BOTTOM_MARGIN = 40
const DIVIDER_TOP_MARGIN = 40
const INCLUDED_ROW = 15
const OMISSION_ROW = 13
/** Gap + "Not included" heading, before the first omission line. */
const OMISSION_HEAD = 12 + 16
/** y of the first included row: top margin, title (44), blurb (44), header (6), rule gap (14). */
const FIRST_ROW_Y = A4_H - DIVIDER_TOP_MARGIN - 44 - 44 - 6 - 14

export interface DividerLayout {
  includedShown: number
  /** Plans left off the list because the page is full (they ARE in the report). */
  includedMore: number
  omissionsShown: number
  omissionsMore: number
  /** Lowest text baseline the layout uses; never below DIVIDER_BOTTOM_MARGIN. */
  lowestBaseline: number
}

/** How many divider lines fit on the page. Pure, so the overflow rule is testable without parsing a PDF. */
export function dividerLayout(includedCount: number, omittedCount: number): DividerLayout {
  const lines = (y: number, row: number) => Math.max(0, Math.floor((y - DIVIDER_BOTTOM_MARGIN) / row) + 1)
  // Keep room for the omission block (heading, one line, "and N more") when there is one.
  const reserve = omittedCount > 0 ? OMISSION_HEAD + OMISSION_ROW * 2 : 0
  const includedFit = lines(FIRST_ROW_Y - reserve, INCLUDED_ROW)
  let includedShown = includedCount
  let includedMore = 0
  if (includedCount > includedFit) { includedShown = Math.max(0, includedFit - 1); includedMore = includedCount - includedShown }
  const includedRows = Math.max(1, includedShown + (includedMore > 0 ? 1 : 0)) // "No plan could be included." takes a row
  let y = FIRST_ROW_Y - includedRows * INCLUDED_ROW
  let lowest = y + INCLUDED_ROW
  let omissionsShown = 0
  let omissionsMore = 0
  if (omittedCount > 0) {
    y -= OMISSION_HEAD
    const fit = Math.min(MAX_LISTED_OMISSIONS, lines(y, OMISSION_ROW))
    if (omittedCount > fit) { omissionsShown = Math.max(0, fit - 1); omissionsMore = omittedCount - omissionsShown } else omissionsShown = omittedCount
    const rows = omissionsShown + (omissionsMore > 0 ? 1 : 0)
    lowest = y - Math.max(0, rows - 1) * OMISSION_ROW
  }
  return { includedShown, includedMore, omissionsShown, omissionsMore, lowestBaseline: lowest }
}

function drawDivider(page: PDFPage, included: StatusPlanRenderInput[], notIncluded: PlanOmission[], fonts: PlanFonts, generatedOn: string): void {
  const margin = 40
  const layout = dividerLayout(included.length, notIncluded.length)
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
  included.slice(0, layout.includedShown).forEach((p, i) => {
    const cells = [String(i + 1), p.planName, PURPOSE_LABEL[p.purpose], p.drawingName, String(p.pageIndex)]
    cells.forEach((cell, j) => page.drawText(fit(cell, fonts.regular, 8.5, cols[j]!.w), { x: cols[j]!.x, y, size: 8.5, font: fonts.regular }))
    y -= INCLUDED_ROW
  })
  if (layout.includedMore > 0) {
    page.drawText(T(`…and ${layout.includedMore} more plans, on the pages that follow.`), { x: margin, y, size: 8.5, font: fonts.regular })
    y -= INCLUDED_ROW
  }
  if (included.length === 0) { page.drawText(T('No plan could be included.'), { x: margin, y, size: 9, font: fonts.regular }); y -= INCLUDED_ROW }

  if (notIncluded.length > 0) {
    y -= 12
    page.drawText(T('Not included'), { x: margin, y, size: 10, font: fonts.bold })
    y -= 16
    for (const o of notIncluded.slice(0, layout.omissionsShown)) {
      page.drawText(fit(`${o.title}: ${o.reason}`, fonts.regular, 8.5, A4_W - margin * 2), { x: margin, y, size: 8.5, font: fonts.regular, color: rgb(0.55, 0.3, 0.05) })
      y -= OMISSION_ROW
    }
    if (layout.omissionsMore > 0) {
      page.drawText(T(`…and ${layout.omissionsMore} more.`), { x: margin, y, size: 8.5, font: fonts.regular })
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
      notIncluded.push({ title: planTitle(input.planName, input.purpose, input.pageIndex), reason: e instanceof StatusPlanSourceError ? e.message : 'the plan could not be drawn' })
    }
  }
  drawDivider(pdf.insertPage(dividerAt, [A4_W, A4_H]), included, notIncluded, fonts, generatedOn)
  return { appended: included.length, notIncluded }
}

export interface AppendedReport { bytes: Uint8Array; appended: number; notIncluded: PlanOmission[] }

/** Append to an already-rendered report and say what actually made it in. Input bytes untouched when there is nothing to add. */
export async function appendStatusPlansToReportDetailed(reportPdf: Uint8Array, load: PlanRenderLoadResult, generatedOn: string): Promise<AppendedReport> {
  if (load.inputs.length === 0 && load.omitted.length === 0) return { bytes: reportPdf, appended: 0, notIncluded: [] }
  const pdf = await PDFDocument.load(reportPdf)
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) }
  const { appended, notIncluded } = await appendStatusPlansToPdf(pdf, load, fonts, generatedOn)
  await pruneUnreachableObjects(pdf)
  return { bytes: await pdf.save(), appended, notIncluded }
}

/** Append to an already-rendered report. Returns the input bytes untouched when there is nothing to add. */
export async function appendStatusPlansToReport(reportPdf: Uint8Array, load: PlanRenderLoadResult, generatedOn: string): Promise<Uint8Array> {
  return (await appendStatusPlansToReportDetailed(reportPdf, load, generatedOn)).bytes
}
