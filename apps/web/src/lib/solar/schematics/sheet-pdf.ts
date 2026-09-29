// apps/web/src/lib/solar/schematics/sheet-pdf.ts
/**
 * Schematic sheet (functional spec §13.2 "Export → PDF sheet"): the browser's raster of the drawing +
 * cards + lines, and a vector legend / title block computed on the server from the database. Every
 * string through winAnsiSafe (pdf-lib standard fonts throw on Ω, ≤, →).
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { winAnsiSafe } from '@/lib/pdf/winansi'

export const A3_LANDSCAPE: [number, number] = [1190.55, 841.89]
const MAX_LEGEND = 40

export interface SchematicSheetInput {
  jpegBase64: string
  imageWidthPx: number
  imageHeightPx: number
  projectName: string
  schematicName: string
  sourceLabel: string
  version: number
  dateIso: string
  legend: Array<{ label: string; kind: string; tenant: string | null; included: boolean | null }>
  connections: number
  warnings: string[]
}

export async function renderSchematicSheetPdf(i: SchematicSheetInput): Promise<Uint8Array> {
  const T = (s: string) => winAnsiSafe(s)
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const jpg = await doc.embedJpg(i.jpegBase64)
  const [W, H] = A3_LANDSCAPE
  const page = doc.addPage(A3_LANDSCAPE)
  const m = 28
  const panel = 280
  const box = { x: m, y: m + 20, w: W - 2 * m - panel - 12, h: H - 2 * m - 20 }
  const s = Math.min(box.w / i.imageWidthPx, box.h / i.imageHeightPx)
  const dw = i.imageWidthPx * s
  const dh = i.imageHeightPx * s
  page.drawImage(jpg, { x: box.x + (box.w - dw) / 2, y: box.y + (box.h - dh) / 2, width: dw, height: dh })
  page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5 })

  const px = W - m - panel
  let y = H - m - 14
  const line = (t: string, size = 9, f = font) => { page.drawText(T(t), { x: px, y, size, font: f, maxWidth: panel }); y -= size + 5 }
  line('Metering schematic', 14, bold)
  line(i.projectName, 10, bold)
  line(`Schematic: ${i.schematicName}`)
  line(`Sheet: ${i.sourceLabel}`)
  line(`Version ${i.version} - ${i.dateIso}`)
  line(`${i.legend.length} meters - ${i.connections} connections`)
  y -= 6
  line('Meters', 10, bold)
  for (const l of i.legend.slice(0, MAX_LEGEND)) {
    const inc = l.included === null ? '' : l.included ? ' - in load' : ' - excluded'
    line(`${l.label} (${l.kind})${l.tenant ? ` - ${l.tenant}` : ''}${inc}`, 8)
  }
  if (i.legend.length > MAX_LEGEND) line(`... and ${i.legend.length - MAX_LEGEND} more meters`, 8)
  line('Solid amber = supply; dashed grey = check meter; dashed card = excluded from load.', 7)
  for (const w of i.warnings) { y -= 4; page.drawText(T(w), { x: px, y, size: 8, font, color: rgb(0.7, 0.35, 0), maxWidth: panel }); y -= 12 }
  page.drawText(T('Positions are image pixels of the drawing page. Not for construction without verification.'), { x: m, y: m, size: 7, font, color: rgb(0.4, 0.4, 0.4) })
  return doc.save()
}
