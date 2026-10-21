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
const ROTATED_LABEL = 'SHOP 7'

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
  // A label turned -90° on the raster (reads bottom to top): drawn turned 180° in
  // user space on this /Rotate 90 page. Its run starts at raster (500, 700) and
  // climbs; the box is x 490..500 and y 700 − 2·advance..700.
  page.drawText(ROTATED_LABEL, { x: 700 / 2, y: 500 / 2, size: 5, font, rotate: degrees(180) })
  return doc.save()
}

/** Helvetica advance of `s` at 5 pt, in user space (what pdf.js reports as width). */
async function helveticaAdvance(s: string): Promise<number> {
  const doc = await PDFDocument.create()
  return (await doc.embedFont(StandardFonts.Helvetica)).widthOfTextAtSize(s, 5)
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

  it('/Rotate 90: allItems holds every run, the -90° label included; items does not', async () => {
    const res = await extractPageText({ data: await rotatedSheet() }, 1, legacy)
    if (!res.ok) throw new Error(res.error)
    expect(res.allItems.length).toBeGreaterThanOrEqual(res.items.length)
    // Every upright run is in allItems unchanged.
    for (const item of res.items) expect(res.allItems).toContainEqual(item)
    expect(res.items.find((i) => i.str === ROTATED_LABEL)).toBeUndefined()
    const shop = res.allItems.find((i) => i.str === ROTATED_LABEL)!
    expect(shop).toBeDefined()
    // pdf.js reports width = advance (user space) and height = font size; on the
    // scale-2 raster the turned box is font-height wide and advance tall.
    const advance = 2 * (await helveticaAdvance(ROTATED_LABEL))
    expect(shop.x).toBeCloseTo(490, 1)
    expect(shop.width).toBeCloseTo(10, 1)
    expect(shop.baseline).toBeCloseTo(700, 1)
    expect(shop.height).toBeCloseTo(advance, 1)
    expect(shop.top).toBeCloseTo(700 - advance, 1)
  })

  it('a page with no text layer returns no items (the panel turns that into a sentence)', async () => {
    const res = await extractPageText({ data: await blankSheet() }, 1, legacy)
    expect(res).toMatchObject({ ok: true, items: [], allItems: [] })
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
