/**
 * Cable route sheets as part of a cable schedule report.
 *
 * A route sheet is the marked-up drawing exported from route mode
 * (`exportRouteSheetAction`): a versioned `projects.reports` row of kind
 * `cable_route_sheet` whose PDF holds the traced legs on an A3 page plus a
 * legend page computed from the route tables. Each sheet is exported in the
 * context of ONE revision — its legend lists that revision's runs — and the
 * row records that in `summary.revisionId`, with the PDF page in
 * `summary.page`.
 *
 * When a user generates the schedule's PDF revision pack or ZIP they may
 * choose to include "the applicable files": the CURRENT (status `issued`)
 * sheet of every (drawing, page) exported for this revision. This module is
 * the whole of that feature server-side:
 *
 *   listRouteSheetsForRevision  — what is available, and whether a sheet is
 *                                 older than the routes it shows (stale)
 *   loadRouteSheetAttachments   — the same, with the PDF bytes from the
 *                                 `reports` bucket, under a size cap
 *   appendRouteSheetsToPdf      — a divider page + every sheet's pages copied
 *                                 into the revision pack
 *
 * Reads go through the CALLER's session client (RLS + the OPEN read on this
 * report kind in lib/reports/report-kind-access.ts); only the bytes are
 * fetched with the service client, as every saved-report download does.
 */

import { PDFDocument, rgb, type PDFFont } from 'pdf-lib'
import type { SupabaseClient } from '@supabase/supabase-js'
import { winAnsiSafe } from './winansi'

export interface RouteSheetRef {
  reportId: string
  title: string
  version: number
  generatedAt: string
  storagePath: string
  sizeBytes: number | null
  floorPlanId: string
  pageIndex: number
  /** TRUE when a route drawn on this sheet was saved AFTER the sheet was exported. */
  stale: boolean
}

export interface RouteSheetAttachment extends RouteSheetRef {
  bytes: Uint8Array
}

/** Hard caps so one pack cannot become a 200 MB download. Both are generous for real jobs. */
export const MAX_ROUTE_SHEETS_PER_PACK = 20
export const MAX_ROUTE_SHEET_BYTES_PER_PACK = 40 * 1024 * 1024

interface ReportRow {
  id: string
  title: string
  version: number
  generated_at: string
  storage_path: string
  size_bytes: number | null
  source_id: string
  summary: Record<string, unknown> | null
}

/** `${floorPlanId}#${pageIndex}` — the identity of one sheet. */
export function sheetKey(floorPlanId: string, pageIndex: number): string {
  return `${floorPlanId}#${pageIndex}`
}

/**
 * Turn report rows into sheet refs. Pure, so it is testable without a
 * database: `routeTouchedAt` maps a sheet key to the latest `updated_at` of
 * any route with a leg on that sheet, which decides `stale`.
 *
 * A row whose summary carries no `page` is a sheet exported before the page
 * was recorded there; it is read as page 1 (the only page such a row could
 * have been, since multi-page scales arrived with the same change).
 */
export function refsFromReportRows(
  rows: readonly ReportRow[],
  routeTouchedAt: ReadonlyMap<string, string>,
): RouteSheetRef[] {
  return rows
    .map((r) => {
      const pageIndex = Math.max(1, Number(r.summary?.page ?? 1) || 1)
      const touched = routeTouchedAt.get(sheetKey(r.source_id, pageIndex))
      return {
        reportId: r.id,
        title: r.title,
        version: Number(r.version),
        generatedAt: r.generated_at,
        storagePath: r.storage_path,
        sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
        floorPlanId: r.source_id,
        pageIndex,
        stale: !!touched && new Date(touched).getTime() > new Date(r.generated_at).getTime(),
      }
    })
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }))
}

/**
 * The current sheet of every (drawing, page) exported for this revision, and
 * whether each is older than the routes it shows.
 */
export async function listRouteSheetsForRevision(
  supabase: SupabaseClient,
  projectId: string,
  revisionId: string,
): Promise<RouteSheetRef[]> {
  const db = supabase as unknown as { schema: (s: string) => { from: (t: string) => any } }
  const [{ data: reports }, { data: legs }] = await Promise.all([
    db
      .schema('projects')
      .from('reports')
      .select('id, title, version, generated_at, storage_path, size_bytes, source_id, summary')
      .eq('project_id', projectId)
      .eq('kind', 'cable_route_sheet')
      .eq('status', 'issued')
      .eq('summary->>revisionId', revisionId),
    // Every leg of every route in this revision, with the route's last save —
    // the freshness reference for the sheet it sits on.
    db
      .schema('cable_schedule')
      .from('route_segments')
      .select('floor_plan_id, page_index, supply_routes!inner(revision_id, updated_at)')
      .eq('supply_routes.revision_id', revisionId),
  ])
  const touched = new Map<string, string>()
  for (const l of (legs ?? []) as Array<{ floor_plan_id: string; page_index: number; supply_routes: { updated_at: string } | { updated_at: string }[] | null }>) {
    const route = Array.isArray(l.supply_routes) ? l.supply_routes[0] : l.supply_routes
    if (!route?.updated_at) continue
    const key = sheetKey(l.floor_plan_id, Number(l.page_index))
    const prev = touched.get(key)
    if (!prev || new Date(route.updated_at).getTime() > new Date(prev).getTime()) touched.set(key, route.updated_at)
  }
  return refsFromReportRows(((reports ?? []) as ReportRow[]), touched)
}

export interface RouteSheetLoadResult {
  sheets: RouteSheetAttachment[]
  /** Sheets that exist but were left out — the caps, or a file that could not be read. */
  omitted: Array<{ title: string; reason: string }>
}

/**
 * The applicable sheets WITH their PDF bytes, for a renderer. Applies the
 * caps in listing order and never throws for one unreadable file: the pack
 * still ships, and the README/divider says what was left out.
 */
export async function loadRouteSheetAttachments(
  supabase: SupabaseClient,
  storage: { from: (bucket: string) => { download: (path: string) => Promise<{ data: Blob | null; error: { message: string } | null }> } },
  projectId: string,
  revisionId: string,
): Promise<RouteSheetLoadResult> {
  const refs = await listRouteSheetsForRevision(supabase, projectId, revisionId)
  const sheets: RouteSheetAttachment[] = []
  const omitted: RouteSheetLoadResult['omitted'] = []
  let total = 0
  for (const ref of refs) {
    if (sheets.length >= MAX_ROUTE_SHEETS_PER_PACK) {
      omitted.push({ title: ref.title, reason: `more than ${MAX_ROUTE_SHEETS_PER_PACK} sheets — download the rest from Exported sheets` })
      continue
    }
    const { data, error } = await storage.from('reports').download(ref.storagePath)
    if (error || !data) {
      omitted.push({ title: ref.title, reason: `file could not be read (${error?.message ?? 'empty'})` })
      continue
    }
    const bytes = new Uint8Array(await data.arrayBuffer())
    if (total + bytes.byteLength > MAX_ROUTE_SHEET_BYTES_PER_PACK) {
      omitted.push({ title: ref.title, reason: 'pack size cap reached — download it from Exported sheets' })
      continue
    }
    total += bytes.byteLength
    sheets.push({ ...ref, bytes })
  }
  return { sheets, omitted }
}

/** A safe file name for one sheet inside a ZIP: `power-layout-a-page-2-v3.pdf`. */
export function routeSheetFileName(sheet: RouteSheetRef): string {
  const base = sheet.title
    .replace(/^cable routes\s*[—-]\s*/i, '')
    .replace(/\((page \d+)\)/i, '$1')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return `${base || sheet.floorPlanId}-v${sheet.version}.pdf`
}

const A4_W = 595.28
const A4_H = 841.89

/**
 * Appends an "Appendix — Cable route sheets" divider listing every sheet
 * (version, export date, freshness), then copies each sheet's pages in. A
 * sheet that fails to parse is listed as omitted rather than aborting the
 * pack. Returns how many sheets were actually copied.
 */
export async function appendRouteSheetsToPdf(
  pdf: PDFDocument,
  sheets: readonly RouteSheetAttachment[],
  omitted: readonly { title: string; reason: string }[],
  fonts: { regular: PDFFont; bold: PDFFont },
  accent: ReturnType<typeof rgb>,
): Promise<number> {
  if (sheets.length === 0 && omitted.length === 0) return 0
  const T = (s: string) => winAnsiSafe(s)
  const page = pdf.addPage([A4_W, A4_H])
  const margin = 40
  let y = A4_H - margin

  page.drawRectangle({ x: 0, y: A4_H - 6, width: A4_W, height: 6, color: accent })
  page.drawText(T('Appendix — Cable route sheets'), { x: margin, y: y - 22, size: 18, font: fonts.bold, color: rgb(0.05, 0.05, 0.05) })
  y -= 44
  page.drawText(
    T('The marked-up drawings the traced lengths in this schedule were measured on. Each sheet shows its routes with per-leg lengths and a legend; the schedule holds the issued figure (route + rise + drop).'),
    { x: margin, y, size: 9, font: fonts.regular, color: rgb(0.35, 0.35, 0.35), maxWidth: A4_W - margin * 2, lineHeight: 12 },
  )
  y -= 40

  const cols = [
    { title: '#', x: margin, w: 18 },
    { title: 'Sheet', x: margin + 22, w: 250 },
    { title: 'Version', x: margin + 280, w: 50 },
    { title: 'Exported', x: margin + 336, w: 80 },
    { title: 'Freshness', x: margin + 420, w: 130 },
  ]
  for (const c of cols) page.drawText(T(c.title), { x: c.x, y, size: 8.5, font: fonts.bold })
  y -= 6
  page.drawLine({ start: { x: margin, y }, end: { x: A4_W - margin, y }, thickness: 0.6, color: rgb(0.7, 0.7, 0.7) })
  y -= 14

  const rowH = 15
  sheets.forEach((s, i) => {
    const cells = [
      String(i + 1),
      s.title,
      `v${s.version}`,
      s.generatedAt.slice(0, 10),
      s.stale ? 'routes changed after export' : 'current',
    ]
    cells.forEach((cell, ci) => {
      const c = cols[ci]
      let txt = T(cell)
      while (txt.length > 2 && fonts.regular.widthOfTextAtSize(txt, 9) > c.w) txt = txt.slice(0, -2) + '…'
      page.drawText(T(txt), { x: c.x, y, size: 9, font: fonts.regular, color: ci === 4 && s.stale ? rgb(0.72, 0.28, 0.05) : rgb(0, 0, 0) })
    })
    y -= rowH
  })
  if (omitted.length > 0) {
    y -= 10
    page.drawText(T('Not included'), { x: margin, y, size: 8.5, font: fonts.bold })
    y -= 13
    for (const o of omitted) {
      page.drawText(T(`• ${o.title} — ${o.reason}`), { x: margin, y, size: 8.5, font: fonts.regular, color: rgb(0.35, 0.35, 0.35), maxWidth: A4_W - margin * 2 })
      y -= 12
    }
  }
  page.drawText(
    T('Sheets follow in the order listed. Their page sizes are their own (A3 drawing, A4 legend).'),
    { x: margin, y: 24, size: 7.5, font: fonts.regular, color: rgb(0.4, 0.4, 0.4) },
  )

  let copied = 0
  for (const s of sheets) {
    try {
      const src = await PDFDocument.load(s.bytes)
      const pages = await pdf.copyPages(src, src.getPageIndices())
      for (const p of pages) pdf.addPage(p)
      copied += 1
    } catch (e) {
      // Listed above as available; say on a page of its own that it did not copy.
      const err = pdf.addPage([A4_W, A4_H])
      err.drawText(T(`${s.title} (v${s.version}) could not be embedded: ${e instanceof Error ? e.message : String(e)}`), { x: margin, y: A4_H - 60, size: 10, font: fonts.regular, maxWidth: A4_W - margin * 2 })
      err.drawText(T('Download the sheet from Exported sheets on the cable-route worklist.'), { x: margin, y: A4_H - 80, size: 9, font: fonts.regular, color: rgb(0.35, 0.35, 0.35) })
    }
  }
  return copied
}
