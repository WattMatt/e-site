/**
 * The Solar layout sheet (functional spec §6.3 "Export layout sheet"): drawing
 * crop with arrays and string colours (rasterised by the browser — the same
 * reason as exportRouteSheetAction: one renderer, not two), plus a vector
 * legend, north arrow, scale bar and title block computed here from the
 * database. Every string goes through winAnsiSafe: pdf-lib standard fonts throw
 * on Ω / ≤ / → (PR #154).
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { winAnsiSafe } from '@/lib/pdf/winansi'

export const A3_LANDSCAPE: [number, number] = [1190.55, 841.89]

export interface LayoutSheetInput {
  jpegBase64: string
  imageWidthPx: number
  imageHeightPx: number
  /** Metres per IMAGE pixel of the crop (1 / sheet px-per-m); null → no scale bar. */
  metresPerImagePx: number | null
  northBearingDeg: number | null
  projectName: string
  layoutName: string
  sourceLabel: string
  version: number
  dateIso: string
  summaryLines: string[]
  legend: Array<{ colour: string; label: string }>
  attribution: string | null
  warnings: string[]
}

export function niceScaleBar(metresPerPt: number, maxWidthPt: number): { metres: number; widthPt: number } {
  const steps = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5]
  for (const m of steps) {
    const w = m / metresPerPt
    if (w <= maxWidthPt) return { metres: m, widthPt: Math.round(w * 1000) / 1000 }
  }
  return { metres: 0.5, widthPt: 0.5 / metresPerPt }
}

function hex(c: string) {
  const n = parseInt(c.replace('#', ''), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

export async function renderLayoutSheetPdf(i: LayoutSheetInput): Promise<Uint8Array> {
  const T = (s: string) => winAnsiSafe(s)
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const jpg = await doc.embedJpg(i.jpegBase64) // base64, not a Buffer (jsdom realm)
  const [W, H] = A3_LANDSCAPE
  const page = doc.addPage(A3_LANDSCAPE)
  const m = 28
  const panel = 260
  const box = { x: m, y: m + 40, w: W - 2 * m - panel - 12, h: H - 2 * m - 40 }
  const s = Math.min(box.w / i.imageWidthPx, box.h / i.imageHeightPx)
  const dw = i.imageWidthPx * s
  const dh = i.imageHeightPx * s
  const ix = box.x + (box.w - dw) / 2
  const iy = box.y + (box.h - dh) / 2
  page.drawImage(jpg, { x: ix, y: iy, width: dw, height: dh })
  page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5 })

  if (i.metresPerImagePx) {
    const bar = niceScaleBar(i.metresPerImagePx / s, box.w / 4)
    page.drawRectangle({ x: box.x, y: m + 16, width: bar.widthPt, height: 5, color: rgb(0, 0, 0) })
    page.drawText(T(`${bar.metres} m`), { x: box.x + bar.widthPt + 6, y: m + 15, size: 9, font })
  }
  if (i.northBearingDeg !== null) {
    const cx = box.x + box.w - 30
    const cy = box.y + box.h - 40
    const r = (i.northBearingDeg * Math.PI) / 180
    const tip = { x: cx + Math.sin(r) * 20, y: cy + Math.cos(r) * 20 }
    const back = { x: cx - Math.sin(r) * 14, y: cy - Math.cos(r) * 14 }
    page.drawLine({ start: back, end: tip, thickness: 2, color: rgb(0, 0, 0) })
    page.drawCircle({ x: tip.x, y: tip.y, size: 3, color: rgb(0, 0, 0) })
    page.drawText('N', { x: tip.x + Math.sin(r) * 8 - 3, y: tip.y + Math.cos(r) * 8 - 3, size: 11, font: bold })
  }

  const px = W - m - panel
  let y = H - m - 14
  const line = (t: string, size = 9, f = font) => { page.drawText(T(t), { x: px, y, size, font: f, maxWidth: panel }); y -= size + 5 }
  line('PV layout sheet', 14, bold)
  line(i.projectName, 10, bold)
  line(`Layout: ${i.layoutName}`)
  line(`Sheet: ${i.sourceLabel}`)
  line(`Version ${i.version} · ${i.dateIso}`)
  y -= 6
  for (const s2 of i.summaryLines) line(s2)
  y -= 6
  if (i.legend.length) line('Strings', 10, bold)
  for (const l of i.legend.slice(0, 40)) {
    page.drawRectangle({ x: px, y: y - 1, width: 10, height: 8, color: hex(l.colour) })
    page.drawText(T(l.label), { x: px + 14, y, size: 8, font, maxWidth: panel - 14 })
    y -= 12
  }
  if (i.legend.length > 40) line(`… and ${i.legend.length - 40} more strings`)
  for (const w of i.warnings) { y -= 4; page.drawText(T(w), { x: px, y, size: 8, font, color: rgb(0.7, 0.35, 0), maxWidth: panel }); y -= 12 }
  if (i.attribution) page.drawText(T(i.attribution), { x: px, y: m, size: 7, font, color: rgb(0.4, 0.4, 0.4) })
  page.drawText(T('Positions are image pixels of the sheet at its recorded scale. Not for construction without verification.'),
    { x: m, y: m, size: 7, font, color: rgb(0.4, 0.4, 0.4) })
  return doc.save()
}
