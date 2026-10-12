// @vitest-environment node
// pdf.js legacy build + pdf-lib bytes: jsdom's Uint8Array is a different realm.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import { detectBlocks } from '@esite/shared/status-plans'
import { extractPageText, IMAGE_SPACE_SCALE, type PdfjsModule } from './extract-page-text'

const legacy = async () => (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsModule

const LABELS = ['NO:', 'NAME:', 'AREA:', 'RATING:', 'CABLE:', 'SERIAL:', 'CT:']
// Invented values (public repo).
const VALUES = ['DB-77', 'TEST STORE', '120m2', '100A TP', '4C 25mm2 CU', 'QA-0007', '100/5A']

/**
 * A 600×400 pt page with /Rotate 90. On the scale-2 raster of such a page,
 * raster x = 2·userY and raster baseline = 2·userX, and a run reads upright
 * when drawn turned +90° in user space. Text size 5 pt → 10 px on the raster.
 */
async function rotatedSheet(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([600, 400])
  page.setRotation(degrees(90))
  const put = (s: string, rasterX: number, rasterBaseline: number) =>
    page.drawText(s, { x: rasterBaseline / 2, y: rasterX / 2, size: 5, font, rotate: degrees(90) })
  LABELS.forEach((label, row) => {
    const baseline = 200 + row * 16
    put(label, 100, baseline)
    put(VALUES[row]!, 150, baseline)
  })
  return doc.save()
}

async function blankSheet(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([600, 400])
  page.drawRectangle({ x: 50, y: 50, width: 100, height: 60, borderColor: rgb(0, 0, 0), borderWidth: 1 })
  return doc.save()
}

describe('extractPageText', () => {
  it('uses the same scale as use-sheet-image (image space is defined there)', () => {
    expect(IMAGE_SPACE_SCALE).toBe(2)
  })

  it('/Rotate 90: real pdf.js puts the NO: run on the predicted raster pixel', async () => {
    const res = await extractPageText({ data: await rotatedSheet() }, 1, legacy)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.width).toBe(800) // 400 pt × 2, rotated
    expect(res.height).toBe(1200) // 600 pt × 2, rotated
    // pdf.js may report "NO:" alone or merged with its value; either starts with "NO:".
    const no = res.items.find((i) => i.str.startsWith('NO:'))!
    expect(no).toBeDefined()
    expect(no.x).toBeCloseTo(100, 0)
    expect(no.baseline).toBeCloseTo(200, 0)
    expect(no.height).toBeCloseTo(10, 0)
  })

  it('/Rotate 90: the extracted page reads as one block', async () => {
    const res = await extractPageText({ data: await rotatedSheet() }, 1, legacy)
    if (!res.ok) throw new Error(res.error)
    const r = detectBlocks(res.items)
    expect(r.blocks.map((b) => [b.tag, b.name, b.fields.CT])).toEqual([['DB-77', 'TEST STORE', '100/5A']])
  })

  it('a page with no text layer returns no items (the panel turns that into a sentence)', async () => {
    const res = await extractPageText({ data: await blankSheet() }, 1, legacy)
    expect(res).toMatchObject({ ok: true, items: [] })
  })

  it('a page beyond the document is refused with a sentence', async () => {
    const res = await extractPageText({ data: await blankSheet() }, 3, legacy)
    expect(res).toEqual({ ok: false, error: 'This drawing has 1 page; page 3 does not exist.' })
  })
})

describe('image space contract', () => {
  it('use-sheet-image still rasterises at the extractor scale', () => {
    const src = readFileSync(join(__dirname, '../sheet/use-sheet-image.ts'), 'utf8')
    expect(src).toContain(`getViewport({ scale: ${IMAGE_SPACE_SCALE} })`)
  })
})
