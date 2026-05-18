/**
 * PDF revision pack — single document containing
 *   1. Cover page (project + revision metadata)
 *   2. Schedule grid (paginated, A4 landscape)
 *   3. Cost summary
 *   4. Tag schedule with QR codes (10 per A4 portrait page)
 *
 * pdf-lib is low-level — no flowable layout. We position by absolute
 * coordinates and paginate manually.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import QRCode from 'qrcode'
import type { EnrichedCable, ExportPayload } from './export-payload'
import { stampPdfDraft } from './export-watermark'

const A4_W = 595.28
const A4_H = 841.89
// Landscape swaps these
const LAND_W = A4_H
const LAND_H = A4_W

const MARGIN = 32

// Watson Mattheus amber accent
const AMBER = rgb(0.902, 0.584, 0)
const TEXT_DARK = rgb(0.05, 0.05, 0.05)
const TEXT_MID = rgb(0.4, 0.4, 0.4)
const TEXT_DIM = rgb(0.6, 0.6, 0.6)
const PANEL_BG = rgb(0.95, 0.95, 0.95)
const HEADER_BG = rgb(0.16, 0.16, 0.16)

export async function renderRevisionPdf(payload: ExportPayload): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${payload.project.name} — ${payload.revision.code} cable schedule`)
  pdf.setProducer('E-Site')
  pdf.setCreator('E-Site cable schedule module')
  pdf.setCreationDate(new Date())

  const helv = await pdf.embedFont(StandardFonts.Helvetica)
  const helvB = await pdf.embedFont(StandardFonts.HelveticaBold)
  const helvI = await pdf.embedFont(StandardFonts.HelveticaOblique)

  drawCoverPage(pdf, payload, helv, helvB, helvI)
  drawSchedulePages(pdf, payload, helv, helvB)
  drawCostPage(pdf, payload, helv, helvB)
  await drawTagPages(pdf, payload, helv, helvB)

  return pdf.save()
}

function drawCoverPage(
  pdf: PDFDocument,
  payload: ExportPayload,
  helv: PDFFont,
  helvB: PDFFont,
  helvI: PDFFont,
): void {
  const page = pdf.addPage([A4_W, A4_H])
  if (payload.revision.status === 'DRAFT') stampPdfDraft(page, helvB)

  // Header band — full-width dark
  page.drawRectangle({
    x: 0,
    y: A4_H - 70,
    width: A4_W,
    height: 70,
    color: HEADER_BG,
  })
  // Amber stripe under it
  page.drawRectangle({
    x: 0,
    y: A4_H - 73,
    width: A4_W,
    height: 3,
    color: AMBER,
  })

  page.drawText('WATSON MATTHEUS', {
    x: MARGIN,
    y: A4_H - 30,
    size: 9,
    font: helvB,
    color: AMBER,
  })
  page.drawText('Consulting Electrical Engineers', {
    x: MARGIN,
    y: A4_H - 45,
    size: 9,
    font: helv,
    color: rgb(0.85, 0.85, 0.85),
  })
  page.drawText('CABLE SCHEDULE', {
    x: A4_W - MARGIN - helvB.widthOfTextAtSize('CABLE SCHEDULE', 14),
    y: A4_H - 30,
    size: 14,
    font: helvB,
    color: rgb(1, 1, 1),
  })
  page.drawText(payload.revision.status, {
    x: A4_W - MARGIN - helv.widthOfTextAtSize(payload.revision.status, 9),
    y: A4_H - 50,
    size: 9,
    font: helv,
    color: AMBER,
  })

  // Big project name
  let y = A4_H - 140
  const projectName = payload.project.name.toUpperCase()
  page.drawText(projectName, {
    x: MARGIN,
    y,
    size: 24,
    font: helvB,
    color: TEXT_DARK,
  })

  y -= 30
  page.drawText(payload.revision.code, {
    x: MARGIN,
    y,
    size: 18,
    font: helvB,
    color: AMBER,
  })

  if (payload.revision.description) {
    y -= 22
    page.drawText(payload.revision.description, {
      x: MARGIN,
      y,
      size: 11,
      font: helvI,
      color: TEXT_MID,
    })
  }

  // Metadata panel — 2-col label/value grid
  y -= 50
  const metaRows: Array<[string, string]> = [
    [
      payload.revision.issued_at ? 'Issued' : 'Created',
      (payload.revision.issued_at ?? payload.revision.created_at).slice(0, 10),
    ],
    payload.revision.issued_by_name ? ['By', payload.revision.issued_by_name] : ['', ''],
    [
      'Fault level',
      payload.revision.fault_level_ka != null
        ? `${payload.revision.fault_level_ka} kA`
        : '—',
    ],
    ['Sources', String(payload.sources.length)],
    ['Boards', String(payload.boards.length)],
    ['Supplies (runs)', String(payload.supplies.length)],
    ['Cables (strands)', String(payload.cables.length)],
    ['Tags', String(payload.cableTags.length)],
  ].filter((r): r is [string, string] => r[0] !== '')

  // 2-column layout
  const colW = (A4_W - 2 * MARGIN) / 2
  const labelW = 110
  const rowH = 24
  for (let i = 0; i < metaRows.length; i++) {
    const [label, value] = metaRows[i]
    const col = i % 2
    const rowIdx = Math.floor(i / 2)
    const rx = MARGIN + col * colW
    const ry = y - rowIdx * rowH
    page.drawText(label.toUpperCase(), {
      x: rx,
      y: ry,
      size: 8,
      font: helvB,
      color: TEXT_DIM,
    })
    page.drawText(value, {
      x: rx + labelW,
      y: ry,
      size: 11,
      font: helv,
      color: TEXT_DARK,
    })
  }
  y -= Math.ceil(metaRows.length / 2) * rowH + 20

  // Change notes panel
  if (payload.revision.change_notes?.trim()) {
    y -= 10
    page.drawText('CHANGE NOTES', {
      x: MARGIN,
      y,
      size: 9,
      font: helvB,
      color: TEXT_DIM,
    })
    y -= 18
    const panelH = Math.min(200, A4_H * 0.3)
    page.drawRectangle({
      x: MARGIN,
      y: y - panelH,
      width: A4_W - 2 * MARGIN,
      height: panelH,
      color: PANEL_BG,
    })
    // Wrap text
    const lines = wrapText(
      payload.revision.change_notes,
      helv,
      10,
      A4_W - 2 * MARGIN - 20,
    )
    let lineY = y - 16
    const maxLines = Math.floor((panelH - 12) / 14)
    for (const line of lines.slice(0, maxLines)) {
      page.drawText(line, {
        x: MARGIN + 10,
        y: lineY,
        size: 10,
        font: helv,
        color: TEXT_DARK,
      })
      lineY -= 14
    }
    y -= panelH + 20
  }

  // Footer
  page.drawText(
    `Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} · E-Site`,
    {
      x: MARGIN,
      y: 28,
      size: 8,
      font: helv,
      color: TEXT_DIM,
    },
  )
}

interface ScheduleCol {
  key: string
  label: string
  width: number
  align: 'left' | 'right' | 'center'
  format: (run: ExportPayload['runs'][number]) => string
}

function drawSchedulePages(
  pdf: PDFDocument,
  payload: ExportPayload,
  helv: PDFFont,
  helvB: PDFFont,
): void {
  // 15 columns over LAND_W = 841.89, accounting for margins.
  // ONE ROW PER RUN (= supply) — parallel strands collapse under "×N".
  function runLabel(run: ExportPayload['runs'][number]): string {
    const head = run.cables[0]
    const tag = head?.tag_override?.trim() ?? ''
    return tag || `${run.from_label}-${run.to_label}`
  }
  function runLength(run: ExportPayload['runs'][number]): number | null {
    // Worst (longest) effective length across strands.
    let worst: number | null = null
    for (const c of run.cables) {
      const l = c.confirmed_length_m ?? c.measured_length_m
      if (l == null) continue
      if (worst == null || l > worst) worst = l
    }
    return worst
  }
  const cols: ScheduleCol[] = [
    { key: 'run_no', label: 'No', width: 26, align: 'right', format: () => '' /* set per-row */ },
    { key: 'tag', label: 'Cable Tag', width: 95, align: 'left', format: (run) => runLabel(run) },
    { key: 'from_label', label: 'From', width: 60, align: 'left', format: (run) => run.from_label },
    { key: 'to_label', label: 'To', width: 60, align: 'left', format: (run) => run.to_label },
    { key: 'voltage_v', label: 'V', width: 30, align: 'right', format: (run) => fmt(run.voltage_v) },
    { key: 'load_a', label: 'Load A', width: 38, align: 'right', format: (run) => fmt(run.load_a) },
    { key: 'size_mm2', label: 'Size', width: 32, align: 'right', format: (run) => fmt(run.size_mm2) },
    { key: 'cores', label: 'Cores', width: 32, align: 'center', format: (run) => String(run.cores) },
    { key: 'conductor', label: 'Mat', width: 26, align: 'center', format: (run) => run.conductor === 'CU' ? 'Cu' : 'Al' },
    { key: 'insulation', label: 'Ins', width: 28, align: 'center', format: (run) => run.insulation },
    { key: 'parallel_count', label: 'Par', width: 26, align: 'center', format: (run) => `×${run.parallel_count}` },
    { key: 'ohm_per_km', label: 'Ω/km', width: 38, align: 'right', format: (run) => fmt(run.ohm_per_km, 3) },
    { key: 'effective_length_m', label: 'Len m', width: 42, align: 'right', format: (run) => fmt(runLength(run)) },
    { key: 'vd_pct', label: 'VD %', width: 38, align: 'right', format: (run) => fmt(run.vd_pct, 2) },
    { key: 'cumulative_vd_pct', label: 'Cum %', width: 42, align: 'right', format: (run) => fmt(run.cumulative_vd_pct, 2) },
  ]
  const totalW = cols.reduce((a, b) => a + b.width, 0)
  const startX = (LAND_W - totalW) / 2

  // Group RUNS by (section, conductor) to insert section header rows.
  const groups: Array<{
    sectionLabel: string | null
    conductorLabel: string
    runs: ExportPayload['runs']
  }> = []
  const bucket = new Map<string, ExportPayload['runs']>()
  const keyOrder: string[] = []
  for (const r of payload.runs) {
    const sec = r.section ?? null
    const key = `${sec ?? '_'}|${r.conductor}`
    if (!bucket.has(key)) {
      bucket.set(key, [])
      keyOrder.push(key)
    }
    bucket.get(key)!.push(r)
  }
  keyOrder.sort((a, b) => {
    const [sa, ca] = a.split('|')
    const [sb, cb] = b.split('|')
    const rank = (s: string) =>
      s === 'NORMAL' ? 0 : s === 'EMERGENCY' ? 1 : 2
    if (rank(sa) !== rank(sb)) return rank(sa) - rank(sb)
    return ca === 'CU' ? -1 : 1
  })
  let lastSection: string | null | undefined = undefined
  for (const k of keyOrder) {
    const [sec, cond] = k.split('|')
    const sectionLabel = sec !== '_' && sec !== lastSection ? sec : null
    lastSection = sec
    groups.push({
      sectionLabel,
      conductorLabel: cond === 'CU' ? 'Copper' : 'Aluminium',
      runs: bucket.get(k)!,
    })
  }

  // Flatten: alternating section-header rows + run rows. Run number is
  // assigned at flatten time so it's stable across the visible order.
  type QueueItem =
    | { kind: 'section'; label: string }
    | { kind: 'conductor'; label: string }
    | { kind: 'run'; run: ExportPayload['runs'][number]; runNumber: number }
  const queue: QueueItem[] = []
  let runNumber = 1
  for (const g of groups) {
    if (g.sectionLabel) queue.push({ kind: 'section', label: g.sectionLabel })
    queue.push({ kind: 'conductor', label: g.conductorLabel })
    for (const r of g.runs) {
      queue.push({ kind: 'run', run: r, runNumber })
      runNumber++
    }
  }

  // Pagination — fit ~30 rows of body per landscape page (after header band).
  const ROW_H = 16
  const HEADER_BAND = 56
  const FOOTER_BAND = 36
  const usableH = LAND_H - HEADER_BAND - FOOTER_BAND
  const rowsPerPage = Math.floor(usableH / ROW_H)

  // Total pages
  const pages: QueueItem[][] = []
  for (let i = 0; i < queue.length; i += rowsPerPage) {
    pages.push(queue.slice(i, i + rowsPerPage))
  }
  if (pages.length === 0) pages.push([])

  pages.forEach((items, pageIdx) => {
    const page = pdf.addPage([LAND_W, LAND_H])
    if (payload.revision.status === 'DRAFT') stampPdfDraft(page, helvB)
    drawLandscapeHeader(page, payload, helv, helvB, pageIdx + 1, pages.length)
    drawScheduleColumnHeader(page, cols, startX, LAND_H - HEADER_BAND, helvB)
    let y = LAND_H - HEADER_BAND - ROW_H
    let rowZebra = false
    for (const item of items) {
      if (item.kind === 'section') {
        page.drawRectangle({
          x: startX,
          y: y + 2,
          width: totalW,
          height: ROW_H - 2,
          color: AMBER,
        })
        page.drawText(item.label, {
          x: startX + 6,
          y: y + 5,
          size: 9,
          font: helvB,
          color: rgb(1, 1, 1),
        })
      } else if (item.kind === 'conductor') {
        page.drawRectangle({
          x: startX,
          y: y + 2,
          width: totalW,
          height: ROW_H - 2,
          color: rgb(0.85, 0.85, 0.85),
        })
        page.drawText(item.label, {
          x: startX + 6,
          y: y + 5,
          size: 8,
          font: helvB,
          color: TEXT_DARK,
        })
      } else {
        // run row
        if (rowZebra) {
          page.drawRectangle({
            x: startX,
            y: y + 2,
            width: totalW,
            height: ROW_H - 2,
            color: rgb(0.97, 0.97, 0.97),
          })
        }
        let cx = startX
        for (const col of cols) {
          // Run-number column is computed at queue-assembly time so the
          // number is stable across visible-sorted rows.
          const raw = col.key === 'run_no' ? String(item.runNumber) : col.format(item.run)
          const text = clipText(raw, col.width - 4, helv, 8)
          const w = helv.widthOfTextAtSize(text, 8)
          let tx = cx + 4
          if (col.align === 'right') tx = cx + col.width - w - 4
          else if (col.align === 'center') tx = cx + (col.width - w) / 2
          page.drawText(text, {
            x: tx,
            y: y + 5,
            size: 8,
            font: helv,
            color: TEXT_DARK,
          })
          cx += col.width
        }
        rowZebra = !rowZebra
      }
      y -= ROW_H
    }
  })
}

function drawLandscapeHeader(
  page: PDFPage,
  payload: ExportPayload,
  helv: PDFFont,
  helvB: PDFFont,
  pageNum: number,
  pageTotal: number,
): void {
  page.drawRectangle({
    x: 0,
    y: LAND_H - 36,
    width: LAND_W,
    height: 36,
    color: HEADER_BG,
  })
  page.drawRectangle({
    x: 0,
    y: LAND_H - 39,
    width: LAND_W,
    height: 3,
    color: AMBER,
  })
  page.drawText('WATSON MATTHEUS · CABLE SCHEDULE', {
    x: MARGIN,
    y: LAND_H - 22,
    size: 9,
    font: helvB,
    color: rgb(1, 1, 1),
  })
  const right = `${payload.project.name} · ${payload.revision.code}`
  const rightW = helv.widthOfTextAtSize(right, 9)
  page.drawText(right, {
    x: LAND_W - MARGIN - rightW,
    y: LAND_H - 22,
    size: 9,
    font: helv,
    color: rgb(1, 1, 1),
  })
  const pageLabel = `Page ${pageNum} of ${pageTotal}`
  const plW = helv.widthOfTextAtSize(pageLabel, 8)
  page.drawText(pageLabel, {
    x: LAND_W - MARGIN - plW,
    y: 14,
    size: 8,
    font: helv,
    color: TEXT_DIM,
  })
}

function drawScheduleColumnHeader(
  page: PDFPage,
  cols: ScheduleCol[],
  startX: number,
  y: number,
  helvB: PDFFont,
): void {
  page.drawRectangle({
    x: startX,
    y,
    width: cols.reduce((a, b) => a + b.width, 0),
    height: 18,
    color: rgb(0.2, 0.2, 0.2),
  })
  let cx = startX
  for (const col of cols) {
    const w = helvB.widthOfTextAtSize(col.label, 8)
    let tx = cx + 4
    if (col.align === 'right') tx = cx + col.width - w - 4
    else if (col.align === 'center') tx = cx + (col.width - w) / 2
    page.drawText(col.label, {
      x: tx,
      y: y + 5,
      size: 8,
      font: helvB,
      color: rgb(1, 1, 1),
    })
    cx += col.width
  }
}

function drawCostPage(
  pdf: PDFDocument,
  payload: ExportPayload,
  helv: PDFFont,
  helvB: PDFFont,
): void {
  const page = pdf.addPage([A4_W, A4_H])
  if (payload.revision.status === 'DRAFT') stampPdfDraft(page, helvB)
  drawPortraitHeader(page, payload, helv, helvB, 'COST SUMMARY')

  // Body — Mat (Cu/Al) column added 2026-05-18: cost_lines split by
  // (size, conductor) since Al rates ~30% Cu at the same size.
  const cols = [
    { label: 'Size mm²', x: MARGIN, w: 60, align: 'right' as const },
    { label: 'Mat', x: MARGIN + 65, w: 30, align: 'center' as const },
    { label: 'Length m', x: MARGIN + 100, w: 65, align: 'right' as const },
    { label: 'Supply R/m', x: MARGIN + 170, w: 75, align: 'right' as const },
    { label: 'Install R/m', x: MARGIN + 250, w: 75, align: 'right' as const },
    { label: 'Terms', x: MARGIN + 330, w: 45, align: 'right' as const },
    { label: 'Term R', x: MARGIN + 380, w: 65, align: 'right' as const },
    { label: 'Line ZAR', x: MARGIN + 450, w: 95, align: 'right' as const },
  ]
  let y = A4_H - 110
  // Column header
  page.drawRectangle({
    x: MARGIN,
    y: y - 4,
    width: A4_W - 2 * MARGIN,
    height: 20,
    color: rgb(0.2, 0.2, 0.2),
  })
  for (const c of cols) {
    const w = helvB.widthOfTextAtSize(c.label, 9)
    let tx: number
    if (c.align === 'center') tx = c.x + (c.w - w) / 2
    else tx = c.x + c.w - w - 2
    page.drawText(c.label, {
      x: tx,
      y: y + 2,
      size: 9,
      font: helvB,
      color: rgb(1, 1, 1),
    })
  }
  y -= 22

  // Aggregate by (size, conductor) — Cu and Al at the same size have
  // distinct rates and must total separately.
  const totalsByKey = new Map<
    string,
    { size: number; conductor: 'CU' | 'AL'; totalLength: number; terms: number }
  >()
  for (const c of payload.cables) {
    const len = c.confirmed_length_m ?? c.measured_length_m ?? 0
    const key = `${c.size_mm2}|${c.conductor}`
    const agg = totalsByKey.get(key) ?? {
      size: c.size_mm2,
      conductor: c.conductor,
      totalLength: 0,
      terms: 0,
    }
    agg.totalLength += len
    agg.terms += 2
    totalsByKey.set(key, agg)
  }
  // Include cost-line keys with no matching cables so unused rates still show.
  for (const l of payload.costLines) {
    const key = `${l.size_mm2}|${l.conductor}`
    if (!totalsByKey.has(key)) {
      totalsByKey.set(key, {
        size: l.size_mm2,
        conductor: l.conductor,
        totalLength: 0,
        terms: 0,
      })
    }
  }
  const sortedKeys = [...totalsByKey.keys()].sort((a, b) => {
    const [sa, ca] = a.split('|')
    const [sb, cb] = b.split('|')
    const sn = Number(sa) - Number(sb)
    if (sn !== 0) return sn
    return ca.localeCompare(cb)
  })

  let materialsTotal = 0
  let zebra = false
  for (const key of sortedKeys) {
    if (y < 200) break // leave room for totals
    const agg = totalsByKey.get(key)!
    // Prefer exact (size, conductor) match; fall back to size-only for
    // pre-migration-00061 data where every cost_lines row defaulted to CU.
    const line =
      payload.costLines.find(
        (l) => l.size_mm2 === agg.size && l.conductor === agg.conductor,
      ) ?? payload.costLines.find((l) => l.size_mm2 === agg.size)
    const len = agg.totalLength
    const terms = agg.terms
    const supply = line?.supply_rate_per_m ?? 0
    const install = line?.install_rate_per_m ?? 0
    const termRate = line?.termination_rate_each ?? 0
    const lineTotal = len * (supply + install) + terms * termRate
    materialsTotal += lineTotal

    if (zebra) {
      page.drawRectangle({
        x: MARGIN,
        y: y - 2,
        width: A4_W - 2 * MARGIN,
        height: 18,
        color: rgb(0.97, 0.97, 0.97),
      })
    }
    zebra = !zebra

    const matLabel = agg.conductor === 'CU' ? 'Cu' : 'Al'
    const matColor = agg.conductor === 'AL' ? AMBER : TEXT_DARK
    const cells = [
      { text: String(agg.size), color: TEXT_DARK },
      { text: matLabel, color: matColor },
      { text: len.toFixed(2), color: TEXT_DARK },
      { text: supply.toFixed(2), color: TEXT_DARK },
      { text: install.toFixed(2), color: TEXT_DARK },
      { text: String(terms), color: TEXT_DARK },
      { text: termRate.toFixed(2), color: TEXT_DARK },
      { text: lineTotal.toFixed(2), color: TEXT_DARK },
    ]
    cells.forEach((cell, i) => {
      const c = cols[i]
      const w = helv.widthOfTextAtSize(cell.text, 9)
      let tx: number
      if (c.align === 'center') tx = c.x + (c.w - w) / 2
      else tx = c.x + c.w - w - 2
      page.drawText(cell.text, {
        x: tx,
        y: y + 2,
        size: 9,
        font: helv,
        color: cell.color,
      })
    })
    y -= 18
  }

  // Totals — contingency removed 2026-05-17 (net contracts, no contingency).
  // VAT applied directly to materials+install subtotal.
  // VAT % reads from revision.vat_pct (migration 00060) with 15 fallback.
  const vatPct = Number(payload.revision.vat_pct ?? 15) / 100
  const vat = materialsTotal * vatPct
  const grand = materialsTotal + vat

  y -= 20
  function totalLine(label: string, value: number, big = false): void {
    const valueText = value.toLocaleString('en-ZA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    const font = big ? helvB : helv
    const size = big ? 12 : 10
    const labelW = font.widthOfTextAtSize(label, size)
    page.drawText(label, {
      x: A4_W - MARGIN - 200 - labelW,
      y,
      size,
      font,
      color: big ? AMBER : TEXT_MID,
    })
    const valW = font.widthOfTextAtSize(valueText, size)
    page.drawText(valueText, {
      x: A4_W - MARGIN - valW,
      y,
      size,
      font,
      color: big ? AMBER : TEXT_DARK,
    })
    y -= big ? 22 : 16
  }
  totalLine('Materials + install', materialsTotal)
  totalLine(`+ ${(vatPct * 100).toFixed(0)}% VAT`, vat)
  totalLine('GRAND TOTAL', grand, true)
}

async function drawTagPages(
  pdf: PDFDocument,
  payload: ExportPayload,
  helv: PDFFont,
  helvB: PDFFont,
): Promise<void> {
  if (payload.cableTags.length === 0) return

  // 10 per page (2 cols × 5 rows), A4 portrait
  const cardW = (A4_W - 2 * MARGIN - 20) / 2
  const cardH = (A4_H - 110 - 50) / 5
  const PER_PAGE = 10
  const cableById = new Map(payload.cables.map((c) => [c.id, c] as const))

  for (let i = 0; i < payload.cableTags.length; i += PER_PAGE) {
    const slice = payload.cableTags.slice(i, i + PER_PAGE)
    const page = pdf.addPage([A4_W, A4_H])
    if (payload.revision.status === 'DRAFT') stampPdfDraft(page, helvB)
    drawPortraitHeader(page, payload, helv, helvB, 'TAG SCHEDULE')

    for (let j = 0; j < slice.length; j++) {
      const tag = slice[j]
      const col = j % 2
      const row = Math.floor(j / 2)
      const x = MARGIN + col * (cardW + 20)
      const y = A4_H - 110 - row * cardH - cardH + 10
      const cable = cableById.get(tag.cable_id)

      // Card outline
      page.drawRectangle({
        x,
        y,
        width: cardW,
        height: cardH - 10,
        borderColor: rgb(0.7, 0.7, 0.7),
        borderWidth: 0.5,
      })

      // Tag text
      const tagText = tag.tag_text
      const tagSize = 14
      page.drawText(tagText, {
        x: x + 12,
        y: y + cardH - 32,
        size: tagSize,
        font: helvB,
        color: TEXT_DARK,
      })

      // End label
      page.drawText(`END: ${tag.end_position}`, {
        x: x + 12,
        y: y + cardH - 52,
        size: 8,
        font: helv,
        color: TEXT_MID,
      })

      // Cable detail
      if (cable) {
        const detail = `${cable.size_mm2}mm² ${cable.conductor} ${cable.insulation} · ${cable.from_label} → ${cable.to_label}`
        page.drawText(clipText(detail, cardW - 90, helv, 8), {
          x: x + 12,
          y: y + 12,
          size: 8,
          font: helv,
          color: TEXT_DIM,
        })
      }

      // QR — generate PNG inline, embed
      const qrPayload = {
        v: 1,
        cable_id: tag.cable_id,
        tag_id: tag.id,
        end: tag.end_position,
        text: tag.tag_text,
      }
      try {
        const qrBuffer = await QRCode.toBuffer(JSON.stringify(qrPayload), {
          type: 'png',
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 200,
        })
        const png = await pdf.embedPng(qrBuffer)
        const qrSize = 70
        page.drawImage(png, {
          x: x + cardW - qrSize - 12,
          y: y + cardH - qrSize - 16,
          width: qrSize,
          height: qrSize,
        })
      } catch {
        // Skip QR on failure — text tag still visible
      }
    }
  }
}

function drawPortraitHeader(
  page: PDFPage,
  payload: ExportPayload,
  helv: PDFFont,
  helvB: PDFFont,
  title: string,
): void {
  page.drawRectangle({
    x: 0,
    y: A4_H - 56,
    width: A4_W,
    height: 56,
    color: HEADER_BG,
  })
  page.drawRectangle({
    x: 0,
    y: A4_H - 59,
    width: A4_W,
    height: 3,
    color: AMBER,
  })
  page.drawText('WATSON MATTHEUS', {
    x: MARGIN,
    y: A4_H - 24,
    size: 9,
    font: helvB,
    color: AMBER,
  })
  page.drawText(title, {
    x: MARGIN,
    y: A4_H - 42,
    size: 11,
    font: helvB,
    color: rgb(1, 1, 1),
  })
  const right = `${payload.project.name} · ${payload.revision.code}`
  const rightW = helv.widthOfTextAtSize(right, 9)
  page.drawText(right, {
    x: A4_W - MARGIN - rightW,
    y: A4_H - 32,
    size: 9,
    font: helv,
    color: rgb(1, 1, 1),
  })
}

function fmt(n: number | null | undefined, dp = 0): string {
  if (n == null || !Number.isFinite(n)) return ''
  return dp > 0 ? n.toFixed(dp) : Math.round(n).toString()
}

function clipText(text: string, maxWidth: number, font: PDFFont, size: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text
  let s = text
  while (s.length > 1 && font.widthOfTextAtSize(s + '…', size) > maxWidth) {
    s = s.slice(0, -1)
  }
  return s + '…'
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const paragraphs = text.split(/\r?\n/)
  const out: string[] = []
  for (const p of paragraphs) {
    const words = p.split(/\s+/)
    let line = ''
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        out.push(line)
        line = word
      } else {
        line = test
      }
    }
    if (line) out.push(line)
    if (paragraphs.length > 1) out.push('')
  }
  return out
}
