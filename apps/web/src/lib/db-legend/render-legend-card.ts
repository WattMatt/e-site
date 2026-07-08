/**
 * Distribution-board legend-card PDF (the circuit chart fixed inside the DB
 * door). One parameterised layout for both paper sizes — A4 and A5 portrait —
 * following the cable-schedule pdf-lib exemplars (absolute coordinates,
 * embedded Helvetica). Overflow paginates with a repeated table header.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

export type LegendCardSize = 'A4' | 'A5'

export interface LegendCardCircuit {
  circuit_no: string
  description: string | null
  phase: 'L1' | 'L2' | 'L3' | '3P' | null
  breaker_rating_a: number | null
  poles: 1 | 2 | 3 | 4 | null
  curve: 'B' | 'C' | 'D' | null
  cable_size: string | null
  is_spare: boolean
}

export interface LegendCardPayload {
  projectName: string
  shopNumber: string | null
  shopName: string | null
  dbCode: string
  /** Pre-formatted, e.g. "63 A TP" — from the node's breaker fields. */
  mainBreaker: string | null
  header: {
    location: string | null
    fedFrom: string | null
    earthLeakageMa: number | null
  }
  circuits: LegendCardCircuit[]
  /** Pre-formatted date string (route supplies it — keeps the renderer pure). */
  generatedAt: string
}

interface Geometry {
  w: number
  h: number
  margin: number
  titleSize: number
  metaSize: number
  cellSize: number
  rowH: number
  headerRowH: number
}

const GEOMETRY: Record<LegendCardSize, Geometry> = {
  A4: { w: 595.28, h: 841.89, margin: 40, titleSize: 13, metaSize: 8.5, cellSize: 8.5, rowH: 17, headerRowH: 18 },
  A5: { w: 419.53, h: 595.28, margin: 26, titleSize: 11, metaSize: 7, cellSize: 7, rowH: 13.5, headerRowH: 15 },
}

// Column widths as fractions of the content width.
const COLS: Array<{ key: string; label: string; frac: number }> = [
  { key: 'cct', label: 'CCT', frac: 0.08 },
  { key: 'phase', label: 'PHASE', frac: 0.09 },
  { key: 'description', label: 'DESCRIPTION', frac: 0.38 },
  { key: 'cb', label: 'CB (A)', frac: 0.1 },
  { key: 'poles', label: 'POLES', frac: 0.09 },
  { key: 'curve', label: 'CURVE', frac: 0.09 },
  { key: 'cable', label: 'CABLE', frac: 0.17 },
]

const INK = rgb(0.11, 0.11, 0.11)
const MID = rgb(0.35, 0.35, 0.35)
const DIM = rgb(0.55, 0.55, 0.55)
const LINE = rgb(0.75, 0.75, 0.75)

export async function renderLegendCardPdf(
  payload: LegendCardPayload,
  size: LegendCardSize,
): Promise<Uint8Array> {
  const g = GEOMETRY[size]
  const pdf = await PDFDocument.create()
  const helv = await pdf.embedFont(StandardFonts.Helvetica)
  const helvB = await pdf.embedFont(StandardFonts.HelveticaBold)

  const contentW = g.w - g.margin * 2
  const colX: number[] = []
  let acc = g.margin
  for (const c of COLS) {
    colX.push(acc)
    acc += c.frac * contentW
  }

  let page = pdf.addPage([g.w, g.h])
  let y = drawCardHeader(page, payload, g, helv, helvB)
  y = drawTableHeader(page, g, colX, helvB, y)

  if (payload.circuits.length === 0) {
    page.drawText('No circuits captured yet.', {
      x: g.margin,
      y: y - g.rowH,
      size: g.cellSize,
      font: helv,
      color: DIM,
    })
  }

  for (const circuit of payload.circuits) {
    if (y - g.rowH < g.margin + 18) {
      drawFooter(page, payload, g, helv)
      page = pdf.addPage([g.w, g.h])
      y = drawContinuationHeader(page, payload, g, helv, helvB)
      y = drawTableHeader(page, g, colX, helvB, y)
    }
    y = drawCircuitRow(page, circuit, g, colX, helv, helvB, y)
  }

  drawFooter(page, payload, g, helv)

  pdf.setTitle(`DB Legend Card — ${payload.dbCode} — ${payload.projectName}`)
  pdf.setProducer('E-Site v2')
  pdf.setCreationDate(new Date())
  return await pdf.save()
}

/** Full first-page header. Returns the y where the table starts. */
function drawCardHeader(
  page: PDFPage,
  p: LegendCardPayload,
  g: Geometry,
  helv: PDFFont,
  helvB: PDFFont,
): number {
  let y = g.h - g.margin

  page.drawText('DISTRIBUTION BOARD LEGEND', {
    x: g.margin, y: y - g.titleSize, size: g.titleSize, font: helvB, color: INK,
  })
  y -= g.titleSize + 6

  const shop = [p.shopNumber, p.shopName].filter(Boolean).join(' — ')
  page.drawText(`${p.projectName}${shop ? `  ·  ${shop}` : ''}`, {
    x: g.margin, y: y - g.metaSize, size: g.metaSize, font: helv, color: MID,
  })
  y -= g.metaSize + 10

  const meta: Array<[string, string]> = [
    ['BOARD', p.dbCode],
    ['LOCATION', p.header.location ?? '—'],
    ['FED FROM', p.header.fedFrom ?? '—'],
    ['MAIN BREAKER', p.mainBreaker ?? '—'],
    ['EARTH LEAKAGE', p.header.earthLeakageMa != null ? `${p.header.earthLeakageMa} mA` : '—'],
  ]
  const labelW = 0.28 * (g.w - g.margin * 2) * 0.5
  const half = Math.ceil(meta.length / 2)
  const colW = (g.w - g.margin * 2) / 2
  meta.forEach(([label, value], i) => {
    const cx = g.margin + (i < half ? 0 : colW)
    const cy = y - (i % half) * (g.metaSize + 6) - g.metaSize
    page.drawText(label, { x: cx, y: cy, size: g.metaSize - 1, font: helvB, color: DIM })
    page.drawText(value, { x: cx + labelW, y: cy, size: g.metaSize, font: helv, color: INK })
  })
  y -= half * (g.metaSize + 6) + 8

  page.drawLine({
    start: { x: g.margin, y }, end: { x: g.w - g.margin, y }, thickness: 0.8, color: INK,
  })
  return y - 4
}

/** Compact continuation header for pages 2+. */
function drawContinuationHeader(
  page: PDFPage,
  p: LegendCardPayload,
  g: Geometry,
  helv: PDFFont,
  helvB: PDFFont,
): number {
  let y = g.h - g.margin
  page.drawText(`DISTRIBUTION BOARD LEGEND — ${p.dbCode} (continued)`, {
    x: g.margin, y: y - g.metaSize - 2, size: g.metaSize + 1, font: helvB, color: INK,
  })
  y -= g.metaSize + 10
  page.drawLine({
    start: { x: g.margin, y }, end: { x: g.w - g.margin, y }, thickness: 0.8, color: INK,
  })
  return y - 4
}

function drawTableHeader(page: PDFPage, g: Geometry, colX: number[], helvB: PDFFont, y: number): number {
  const rowY = y - g.headerRowH
  COLS.forEach((c, i) => {
    page.drawText(c.label, { x: colX[i] + 2, y: rowY + 4, size: g.cellSize - 0.5, font: helvB, color: DIM })
  })
  page.drawLine({
    start: { x: g.margin, y: rowY }, end: { x: g.w - g.margin, y: rowY }, thickness: 0.5, color: LINE,
  })
  return rowY
}

function drawCircuitRow(
  page: PDFPage,
  c: LegendCardCircuit,
  g: Geometry,
  colX: number[],
  helv: PDFFont,
  helvB: PDFFont,
  y: number,
): number {
  const rowY = y - g.rowH
  const spare = c.is_spare
  const color = spare ? DIM : INK
  const description = spare ? 'SPARE' : (c.description ?? '—')
  const cells = [
    c.circuit_no,
    c.phase ?? '—',
    description,
    c.breaker_rating_a != null ? String(c.breaker_rating_a) : '—',
    c.poles != null ? String(c.poles) : '—',
    c.curve ?? '—',
    c.cable_size ?? '—',
  ]
  cells.forEach((text, i) => {
    // Clip long text to the column (rough clip: shave chars until it fits).
    const colW = COLS[i].frac * (g.w - g.margin * 2) - 4
    let t = text
    const font = spare && i === 2 ? helvB : helv
    while (t.length > 1 && font.widthOfTextAtSize(t, g.cellSize) > colW) t = t.slice(0, -2) + '…'
    page.drawText(t, { x: colX[i] + 2, y: rowY + 4, size: g.cellSize, font, color })
  })
  page.drawLine({
    start: { x: g.margin, y: rowY }, end: { x: g.w - g.margin, y: rowY }, thickness: 0.4, color: LINE,
  })
  return rowY
}

function drawFooter(page: PDFPage, p: LegendCardPayload, g: Geometry, helv: PDFFont) {
  page.drawText(`${p.projectName} · Generated ${p.generatedAt} · E-Site`, {
    x: g.margin, y: g.margin - 12 < 6 ? 6 : g.margin - 12, size: g.metaSize - 1, font: helv, color: DIM,
  })
}
