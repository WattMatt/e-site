import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import {
  refsFromReportRows,
  routeSheetFileName,
  appendRouteSheetsToPdf,
  loadRouteSheetAttachments,
  listRouteSheetsForRevision,
  sheetKey,
  MAX_ROUTE_SHEETS_PER_PACK,
  MAX_ROUTE_SHEET_BYTES_PER_PACK,
  type RouteSheetAttachment,
} from './route-sheets'

const PLAN_A = '66666666-6666-6666-6666-666666666666'
const PLAN_B = '77777777-7777-7777-7777-777777777777'
const REV = '33333333-3333-3333-3333-333333333333'

function row(over: Partial<Parameters<typeof refsFromReportRows>[0][number]> = {}) {
  return {
    id: 'rep-1',
    title: 'Cable routes — POWER LAYOUT A',
    version: 2,
    generated_at: '2026-09-15T10:00:00.000Z',
    storage_path: 'org/proj/cable-route-sheets/plan-p1-v2.pdf',
    size_bytes: 1234,
    source_id: PLAN_A,
    summary: { runs: 3, legsHere: 4, onSheetM: 120.5, page: 1, revisionId: REV },
    ...over,
  }
}

/** A real little PDF with `pages` pages, each carrying its own text. */
async function sheetPdf(pages: number, label: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= pages; i += 1) {
    const p = doc.addPage(i === 1 ? [1190.55, 841.89] : [595.28, 841.89])
    p.drawText(`${label} page ${i}`, { x: 40, y: 800, size: 12, font })
  }
  return doc.save()
}

/** The drawn text of every content stream (pdf-lib writes standard-font text as hex strings). */
function pdfText(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes)
  let text = ''
  let cursor = 0
  for (;;) {
    const start = buf.indexOf('stream', cursor)
    if (start === -1) break
    const end = buf.indexOf('endstream', start)
    if (end === -1) break
    let dataStart = start + 6
    while (buf[dataStart] === 0x0d || buf[dataStart] === 0x0a) dataStart++
    const chunk = buf.subarray(dataStart, end)
    let decoded: string
    try { decoded = zlib.inflateSync(chunk).toString('latin1') } catch { decoded = chunk.toString('latin1') }
    for (const m of decoded.matchAll(/<([0-9a-fA-F]+)>/g)) text += Buffer.from(m[1], 'hex').toString('latin1')
    text += '\n'
    cursor = end + 9
  }
  return text
}

describe('refsFromReportRows — what the report pack can attach', () => {
  it('reads page and drawing from the row and marks a sheet stale when a route on it was saved later', () => {
    const touched = new Map([[sheetKey(PLAN_A, 1), '2026-09-15T11:00:00.000Z']])   // an hour AFTER the export
    const [ref] = refsFromReportRows([row()], touched)
    expect(ref).toMatchObject({ reportId: 'rep-1', floorPlanId: PLAN_A, pageIndex: 1, version: 2, stale: true })
  })

  it('is current when the last route save is older than the export, or when nothing is traced on it', () => {
    const older = new Map([[sheetKey(PLAN_A, 1), '2026-09-15T09:00:00.000Z']])
    expect(refsFromReportRows([row()], older)[0].stale).toBe(false)
    expect(refsFromReportRows([row()], new Map())[0].stale).toBe(false)
  })

  it('freshness is per PAGE: a save on page 2 does not stale the page-1 sheet', () => {
    const touched = new Map([[sheetKey(PLAN_A, 2), '2026-09-16T00:00:00.000Z']])
    expect(refsFromReportRows([row()], touched)[0].stale).toBe(false)
  })

  it('a row exported before the page was recorded reads as page 1, and the list sorts by title', () => {
    const refs = refsFromReportRows(
      [
        row({ id: 'b', title: 'Cable routes — PORTION B', source_id: PLAN_B, summary: { runs: 1 } }),
        row({ id: 'a', title: 'Cable routes — POWER LAYOUT A (page 2)', summary: { page: 2, revisionId: REV } }),
      ],
      new Map(),
    )
    // "PORTION B" sorts before "POWER LAYOUT A (page 2)"; the pre-page row reads as page 1.
    expect(refs.map((r) => [r.reportId, r.pageIndex])).toEqual([['b', 1], ['a', 2]])
  })
})

describe('routeSheetFileName', () => {
  it('names the file after the sheet, page and version — safe for a ZIP', () => {
    const ref = refsFromReportRows([row({ title: 'Cable routes — POWER LAYOUT A (page 2)', version: 3 })], new Map())[0]
    expect(routeSheetFileName(ref)).toBe('power-layout-a-page-2-v3.pdf')
  })

  it('drops the drawing\'s own file extension from the name (live: "…LAYOUT.pdf" became "…-pdf-v1.pdf")', () => {
    const one = refsFromReportRows([row({ title: 'Cable routes — 666-E-110 - OVERALL POWER LAYOUT.pdf', version: 1 })], new Map())[0]
    expect(routeSheetFileName(one)).toBe('666-e-110-overall-power-layout-v1.pdf')
    const two = refsFromReportRows([row({ title: 'Cable routes — 666-E-110 - OVERALL POWER LAYOUT.pdf (page 2)', version: 4 })], new Map())[0]
    expect(routeSheetFileName(two)).toBe('666-e-110-overall-power-layout-page-2-v4.pdf')
  })
})

describe('appendRouteSheetsToPdf — the appendix', () => {
  async function pack() {
    const pdf = await PDFDocument.create()
    pdf.addPage([595.28, 841.89])   // stands in for the cover + schedule
    const regular = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    return { pdf, fonts: { regular, bold } }
  }

  it('adds one divider page listing the sheets, then every page of every sheet', async () => {
    const { pdf, fonts } = await pack()
    const a = await sheetPdf(2, 'ALPHA')
    const b = await sheetPdf(3, 'BRAVO')
    const sheets: RouteSheetAttachment[] = [
      { ...refsFromReportRows([row({ title: 'Cable routes — ALPHA' })], new Map())[0], bytes: a },
      { ...refsFromReportRows([row({ id: 'rep-2', title: 'Cable routes — BRAVO (page 2)', version: 1 })], new Map([[sheetKey(PLAN_A, 2), '2026-09-16T00:00:00.000Z']]))[0], pageIndex: 2, stale: true, bytes: b },
    ]
    const copied = await appendRouteSheetsToPdf(pdf, sheets, [], fonts, rgb(0.9, 0.58, 0))
    expect(copied).toBe(2)
    expect(pdf.getPageCount()).toBe(1 + 1 + 2 + 3)
    const text = pdfText(await pdf.save())
    expect(text).toContain('Appendix')
    expect(text).toContain('Cable routes')
    expect(text).toContain('ALPHA')
    expect(text).toContain('routes changed after export')   // the stale sheet says so
    expect(text).toContain('ALPHA page 2')                   // the sheet's own pages came across
    expect(text).toContain('BRAVO page 3')
    // The A3 drawing page keeps its size inside the A4 pack.
    expect(pdf.getPage(2).getSize().width).toBeCloseTo(1190.55, 1)
  })

  it('lists what was left out and does not throw on a sheet that is not a PDF', async () => {
    const { pdf, fonts } = await pack()
    const bad: RouteSheetAttachment = { ...refsFromReportRows([row()], new Map())[0], bytes: new TextEncoder().encode('not a pdf') }
    const copied = await appendRouteSheetsToPdf(pdf, [bad], [{ title: 'Cable routes — PORTION B', reason: 'file could not be read (gone)' }], fonts, rgb(0, 0, 0))
    expect(copied).toBe(0)
    expect(pdf.getPageCount()).toBe(1 + 1 + 1)   // divider + the "could not be embedded" page
    const text = pdfText(await pdf.save())
    expect(text).toContain('Not included')
    expect(text).toContain('PORTION B')
    expect(text).toContain('could not be embedded')
  })

  it('adds nothing when there is nothing to add', async () => {
    const { pdf, fonts } = await pack()
    expect(await appendRouteSheetsToPdf(pdf, [], [], fonts, rgb(0, 0, 0))).toBe(0)
    expect(pdf.getPageCount()).toBe(1)
  })
})

/* ── a fake session client for the list/load paths ─────────────────────── */

function fakeSupabase(reports: unknown[], legs: unknown[]) {
  const table = (rows: unknown[]) => {
    const api: any = {
      select: () => api,
      eq: () => api,
      then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej),
    }
    return api
  }
  return {
    schema: (s: string) => ({
      from: (t: string) => (s === 'projects' && t === 'reports' ? table(reports) : table(legs)),
    }),
  } as any
}

function fakeStorage(files: Record<string, Uint8Array | null>) {
  return {
    from: () => ({
      download: async (path: string) => {
        const bytes = files[path]
        if (bytes === undefined) return { data: null, error: { message: 'Object not found' } }
        if (bytes === null) return { data: null, error: null }
        // jsdom's Blob has no arrayBuffer(); Node's (what supabase-js returns at runtime) does.
        return { data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as unknown as Blob, error: null }
      },
    }),
  }
}

describe('listRouteSheetsForRevision — freshness from the route tables', () => {
  it('derives stale from the latest route save on that (drawing, page)', async () => {
    const supabase = fakeSupabase(
      [row(), row({ id: 'rep-2', title: 'Cable routes — POWER LAYOUT A (page 2)', summary: { page: 2, revisionId: REV } })],
      [
        { floor_plan_id: PLAN_A, page_index: 1, supply_routes: { revision_id: REV, updated_at: '2026-09-15T09:00:00.000Z' } },
        { floor_plan_id: PLAN_A, page_index: 1, supply_routes: { revision_id: REV, updated_at: '2026-09-15T12:00:00.000Z' } },   // the LATEST wins
        { floor_plan_id: PLAN_A, page_index: 2, supply_routes: { revision_id: REV, updated_at: '2026-09-15T09:30:00.000Z' } },
      ],
    )
    const refs = await listRouteSheetsForRevision(supabase, 'proj', REV)
    expect(refs.map((r) => [r.pageIndex, r.stale])).toEqual([[1, true], [2, false]])
  })
})

describe('loadRouteSheetAttachments — bytes under the caps, never a throw', () => {
  it('loads every readable sheet and lists the unreadable one as omitted', async () => {
    const good = await sheetPdf(1, 'GOOD')
    const supabase = fakeSupabase(
      [row(), row({ id: 'rep-2', title: 'Cable routes — PORTION B', source_id: PLAN_B, storage_path: 'missing.pdf', summary: { page: 1, revisionId: REV } })],
      [],
    )
    const res = await loadRouteSheetAttachments(supabase, fakeStorage({ 'org/proj/cable-route-sheets/plan-p1-v2.pdf': good }), 'proj', REV)
    expect(res.sheets.map((s) => s.reportId)).toEqual(['rep-1'])
    expect(res.sheets[0].bytes.byteLength).toBe(good.byteLength)
    expect(res.omitted).toEqual([{ title: 'Cable routes — PORTION B', reason: expect.stringMatching(/could not be read/) }])
  })

  it('stops at the sheet-count cap and says which sheets were left out', async () => {
    const good = await sheetPdf(1, 'X')
    const rows = Array.from({ length: MAX_ROUTE_SHEETS_PER_PACK + 2 }, (_, i) =>
      row({ id: `rep-${i}`, title: `Cable routes — SHEET ${String(i).padStart(2, '0')}`, storage_path: `p${i}.pdf` }),
    )
    const files = Object.fromEntries(rows.map((r) => [r.storage_path, good]))
    const res = await loadRouteSheetAttachments(fakeSupabase(rows, []), fakeStorage(files), 'proj', REV)
    expect(res.sheets).toHaveLength(MAX_ROUTE_SHEETS_PER_PACK)
    expect(res.omitted).toHaveLength(2)
    expect(res.omitted[0].reason).toMatch(/more than/)
  })

  it('stops at the byte cap', async () => {
    const big = new Uint8Array(MAX_ROUTE_SHEET_BYTES_PER_PACK - 10)
    const small = await sheetPdf(1, 'S')
    const rows = [row({ id: 'a', title: 'Cable routes — A', storage_path: 'a.pdf' }), row({ id: 'b', title: 'Cable routes — B', storage_path: 'b.pdf' })]
    const res = await loadRouteSheetAttachments(fakeSupabase(rows, []), fakeStorage({ 'a.pdf': big, 'b.pdf': small }), 'proj', REV)
    expect(res.sheets.map((s) => s.reportId)).toEqual(['a'])
    expect(res.omitted).toEqual([{ title: 'Cable routes — B', reason: expect.stringMatching(/size cap/) }])
  })
})
